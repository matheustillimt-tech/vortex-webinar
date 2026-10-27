import "server-only";
import { PLATAFORMAS, plataformaDe, ROTULO_RESULTADO, type ResultadoLog } from "../../../../app/(painel)/configuracoes/dados";
import { segredoAleatorio } from "../../crypto";
import { env } from "../../env";
import type { Plataforma } from "../../regras/checkout";
import { formatarReais, mascararEmail } from "../../regras/metricas";
import { dbAdmin } from "../../supabase/admin";
import { APAGA, auditar, CRIA, ehUuid, erro, inteiro, linkPainel, SO_LEITURA, texto, UUID, WEBINAR, type Ferramenta } from "../comum";
import { nomeDoWebinar } from "./integracoes-regras";

/** Checkouts (Configurações → Checkouts), com a mesma lógica de `app/(painel)/configuracoes/actions.ts`. O segredo
 *  de cada plataforma nunca sai (só "tem_segredo") e não tem ferramenta pra trocá-lo: isso fica só no painel. A URL
 *  de recebimento de cada webhook aparece porque o painel também mostra (é ela que vai na plataforma). */

const PLATAFORMA = {
  type: "string",
  enum: PLATAFORMAS.map((p) => p.valor),
  description: "Plataforma do checkout: vortexpay, kiwify, hotmart, eduzz, hubla ou themembers.",
} as const;

const urlRecebimento = (plataforma: string, token: string) => `${env("NEXT_PUBLIC_PAINEL_URL").replace(/\/$/, "")}/api/checkout/${plataforma}/${token}`;

type WebhookBanco = { id: string; webinar_id: string; token: string; filtro_src: string | null; checkout_id: string };

const listarCheckouts: Ferramenta = {
  name: "listar_checkouts",
  title: "Listar checkouts",
  description:
    "Lista as plataformas de checkout (Configurações): se está ligada, se já tem segredo salvo (o segredo nunca aparece), o evento de venda e os webhooks por webinar com a URL de recebimento que vai na plataforma e o filtro de src.",
  inputSchema: {
    type: "object",
    properties: { plataforma: { ...PLATAFORMA, description: "Só esta plataforma (opcional)." } },
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    if (args.plataforma !== undefined && !plataformaDe(String(args.plataforma))) return erro("Plataforma inválida.");
    const db = dbAdmin();
    const [{ data: checkoutsData, error: e1 }, { data: webhooksData, error: e2 }, { data: webinarsData }] = await Promise.all([
      db.from("checkouts").select("id, plataforma, ligado, segredo_enc"),
      db.from("checkout_webhooks").select("id, webinar_id, token, filtro_src, checkout_id").order("created_at").limit(1000),
      db.from("webinars").select("id, nome").limit(1000),
    ]);
    if (e1 || e2) return erro("Não deu para ler os checkouts.");
    const checkouts = (checkoutsData ?? []) as { id: string; plataforma: Plataforma; ligado: boolean; segredo_enc: string | null }[];
    const webhooks = (webhooksData ?? []) as WebhookBanco[];
    const nomeWebinar = new Map(((webinarsData ?? []) as { id: string; nome: string }[]).map((w) => [w.id, w.nome]));

    const lista = PLATAFORMAS.filter((p) => !args.plataforma || p.valor === args.plataforma).map((p) => {
      const c = checkouts.find((x) => x.plataforma === p.valor);
      return {
        plataforma: p.valor,
        nome: p.rotulo,
        configurado: !!c,
        ligado: c?.ligado ?? false,
        tem_segredo: !!c?.segredo_enc,
        evento_de_venda: p.evento,
        onde_fica_o_segredo: p.ondeFicaSegredo,
        webhooks: c
          ? webhooks
              .filter((w) => w.checkout_id === c.id)
              .map((w) => ({ id: w.id, webinar_id: w.webinar_id, webinar: nomeWebinar.get(w.webinar_id) ?? "—", filtro_src: w.filtro_src, url: urlRecebimento(p.valor, w.token) }))
          : [],
        painel: linkPainel(`/configuracoes/checkouts/${p.valor}`),
      };
    });
    return texto({ checkouts: lista });
  },
};

const adicionarWebhookCheckout: Ferramenta = {
  name: "adicionar_webhook_checkout",
  title: "Adicionar webhook de checkout",
  description:
    "Cria a URL de webhook de uma plataforma de checkout para um webinar (as vendas aprovadas recebidas nela entram nas métricas do webinar). A plataforma precisa estar configurada no painel antes. Devolve a URL pra cadastrar na plataforma.",
  inputSchema: {
    type: "object",
    properties: {
      plataforma: PLATAFORMA,
      webinar_id: WEBINAR,
      filtro_src: { type: "string", description: "Opcional: só aceita vendas com este src (ex.: o src do link do checkout deste webinar)." },
    },
    required: ["plataforma", "webinar_id"],
    additionalProperties: false,
  },
  annotations: CRIA,
  escrita: true,
  async executar(chave, args) {
    const plataforma = String(args.plataforma ?? "");
    if (!plataformaDe(plataforma)) return erro("Plataforma inválida.");
    if (!args.webinar_id) return erro("Escolha o webinar.");
    const db = dbAdmin();
    if (!(await nomeDoWebinar(db, args.webinar_id))) return erro("Webinar não encontrado.");
    const webinarId = args.webinar_id as string;

    const { data: checkout } = await db.from("checkouts").select("id").eq("plataforma", plataforma).maybeSingle();
    if (!checkout) return erro("Configure essa plataforma antes de adicionar um webhook.");

    const filtro = typeof args.filtro_src === "string" && args.filtro_src.trim() ? args.filtro_src.trim() : null;
    const token = segredoAleatorio();
    const { data, error } = await db
      .from("checkout_webhooks")
      .insert({ checkout_id: (checkout as { id: string }).id, webinar_id: webinarId, token, filtro_src: filtro })
      .select("id")
      .single();
    if (error || !data) return erro("Não deu para adicionar o webhook.");

    await auditar(chave, { webinarId, acao: "criou", descricao: `Adicionou um webhook de ${plataforma}`, ...(filtro ? { depois: { filtro_src: filtro } } : {}) });
    return texto({ ok: true, id: (data as { id: string }).id, url: urlRecebimento(plataforma, token), filtro_src: filtro });
  },
};

const removerWebhookCheckout: Ferramenta = {
  name: "remover_webhook_checkout",
  title: "Remover webhook de checkout",
  description: "Remove uma URL de webhook de checkout (veja os ids em listar_checkouts). Vendas mandadas pra ela depois disso são recusadas.",
  inputSchema: {
    type: "object",
    properties: { webhook_id: { ...UUID, description: "Id do webhook (listar_checkouts)." } },
    required: ["webhook_id"],
    additionalProperties: false,
  },
  annotations: APAGA,
  escrita: true,
  async executar(chave, args) {
    if (!ehUuid(args.webhook_id)) return erro("Webhook não encontrado.");
    const db = dbAdmin();
    const { data: atual } = await db.from("checkout_webhooks").select("id, webinar_id").eq("id", args.webhook_id).maybeSingle();
    if (!atual) return erro("Webhook não encontrado.");
    const { error } = await db.from("checkout_webhooks").delete().eq("id", args.webhook_id);
    if (error) return erro("Não deu para remover o webhook.");
    await auditar(chave, { webinarId: (atual as { webinar_id: string }).webinar_id, acao: "excluiu", descricao: "Removeu um webhook de checkout" });
    return texto({ ok: true });
  },
};

const RESULTADOS: ResultadoLog[] = ["aceita", "ignorada", "nao_autorizada", "erro"];
const POR_PAGINA_LOGS = 20;

const verLogsCheckout: Ferramenta = {
  name: "ver_logs_checkout",
  title: "Ver logs do checkout",
  description:
    "Chamadas recebidas nas URLs de webhook de uma plataforma de checkout, mais recente primeiro: resultado (aceita = venda, ignorada, nao_autorizada, erro), evento, webinar, comprador (e-mail mascarado), valor e o motivo quando foi ignorada. Paginado (20 por página).",
  inputSchema: {
    type: "object",
    properties: {
      plataforma: PLATAFORMA,
      resultado: { type: "string", enum: ["todos", ...RESULTADOS], description: "Filtro de resultado (padrão todos)." },
      webinar_id: { ...UUID, description: "Só os webhooks deste webinar (opcional)." },
      pagina: { type: "integer", minimum: 1, description: "Página (padrão 1)." },
    },
    required: ["plataforma"],
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const dados = plataformaDe(String(args.plataforma ?? ""));
    if (!dados) return erro("Plataforma inválida.");
    if (args.webinar_id !== undefined && !ehUuid(args.webinar_id)) return erro("Webinar não encontrado.");
    const db = dbAdmin();
    const pagina = inteiro(args.pagina, 1, 1, 100000);

    const { data: checkout } = await db.from("checkouts").select("id").eq("plataforma", dados.valor).maybeSingle();
    if (!checkout) return texto({ total: 0, pagina, logs: [], aviso: "Plataforma ainda não configurada." });
    let qw = db.from("checkout_webhooks").select("id, webinar_id").eq("checkout_id", (checkout as { id: string }).id).limit(1000);
    if (args.webinar_id) qw = qw.eq("webinar_id", args.webinar_id as string);
    const { data: webhooksData } = await qw;
    const webhooks = (webhooksData ?? []) as { id: string; webinar_id: string }[];
    if (!webhooks.length) return texto({ total: 0, pagina, logs: [] });

    const ids = [...new Set(webhooks.map((w) => w.webinar_id))];
    const { data: webinarsData } = await db.from("webinars").select("id, nome").in("id", ids);
    const nomeWebinar = new Map(((webinarsData ?? []) as { id: string; nome: string }[]).map((w) => [w.id, w.nome]));
    const salaDoWebhook = new Map(webhooks.map((w) => [w.id, nomeWebinar.get(w.webinar_id) ?? null]));

    let consulta = db
      .from("checkout_logs")
      .select("id, resultado, evento, created_at, bruto, webhook_id", { count: "exact" })
      .in("webhook_id", webhooks.map((w) => w.id))
      .order("created_at", { ascending: false })
      .order("id");
    const resultado = String(args.resultado ?? "todos");
    if ((RESULTADOS as string[]).includes(resultado)) consulta = consulta.eq("resultado", resultado);
    const desde = (pagina - 1) * POR_PAGINA_LOGS;
    const { data, count, error } = await consulta.range(desde, desde + POR_PAGINA_LOGS - 1);
    if (error) return erro("Não deu para carregar os logs. Tente de novo.");

    const logs = ((data ?? []) as { id: string; resultado: ResultadoLog; evento: string | null; created_at: string; bruto: unknown; webhook_id: string | null }[]).map((l) => {
      const b = (l.bruto ?? null) as { venda?: { email?: string | null; valorCentavos?: number | null } | null; motivo?: string } | null;
      const venda = b?.venda ?? null;
      return {
        data: l.created_at,
        resultado: l.resultado,
        resultado_rotulo: ROTULO_RESULTADO[l.resultado],
        evento: l.evento,
        webinar: l.webhook_id ? (salaDoWebhook.get(l.webhook_id) ?? null) : null,
        comprador: venda?.email ? mascararEmail(venda.email) : null,
        valor: typeof venda?.valorCentavos === "number" ? formatarReais(venda.valorCentavos) : null,
        ...(b?.motivo ? { motivo: b.motivo } : {}),
      };
    });
    return texto({ total: count ?? 0, pagina, por_pagina: POR_PAGINA_LOGS, logs });
  },
};

export const FERRAMENTAS_CHECKOUTS: Ferramenta[] = [listarCheckouts, adicionarWebhookCheckout, removerWebhookCheckout, verLogsCheckout];
