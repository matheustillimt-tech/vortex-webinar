import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KeyRound, ScrollText, Webhook } from "lucide-react";
import { env } from "@/src/lib/env";
import type { Plataforma } from "@/src/lib/regras/checkout";
import { hrefCom, intervaloDaPagina, opcaoDe, paginaDe, POR_PAGINA_LISTA, type ParametrosUrl } from "@/src/lib/regras/filtros-lista";
import { formatarReais, mascararEmail } from "@/src/lib/regras/metricas";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Paginacao } from "../../../_componentes/paginacao";
import { Cartao, estiloCelula, Pagina, Selo, Tabela, type CorSelo } from "../../../_componentes/ui";
import { SegmentosLink } from "../../../_componentes/barra-filtros";
import { plataformaDe, ROTULO_RESULTADO, type ItemLog, type ItemWebhook, type ResultadoLog } from "../../dados";
import { FormularioCheckout, ListaWebhooks } from "../../formulario";

export const metadata: Metadata = { title: `Checkout · Configurações · ${NOME_SISTEMA}` };

const FILTROS_LOG: { valor: "todos" | ResultadoLog; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "aceita", rotulo: "Venda" },
  { valor: "ignorada", rotulo: "Ignorado" },
  { valor: "nao_autorizada", rotulo: "Não autorizado" },
  { valor: "erro", rotulo: "Erro" },
];
const COR_RESULTADO: Record<ResultadoLog, CorSelo> = { aceita: "ok", ignorada: "neutro", nao_autorizada: "aviso", erro: "erro" };

/** Página de um checkout (`configuracoes/checkouts/<plataforma>`): segredo, URLs de webhook por sala e o
 *  log das chamadas desses webhooks, com filtro por resultado e paginado no servidor. */
export default async function CheckoutPlataforma({ params, searchParams }: { params: Promise<{ plataforma: string }>; searchParams: Promise<ParametrosUrl> }) {
  await exigirAdmin();
  const { plataforma } = await params;
  const dados = plataformaDe(plataforma);
  if (!dados) notFound();
  const sp = await searchParams;
  const resultado = opcaoDe(sp, "resultado", FILTROS_LOG.map((f) => f.valor), "todos");
  const pagina = paginaDe(sp);
  const db = await dbUsuario();

  const [{ data: checkout }, { data: webinarsData }] = await Promise.all([
    db.from("checkouts").select("id, ligado, segredo_enc").eq("plataforma", dados.valor).maybeSingle(),
    db.from("webinars").select("id, nome").order("nome").limit(1000),
  ]);
  const c = checkout as { id: string; ligado: boolean; segredo_enc: string | null } | null;
  const { data: webhooksData } = c
    ? await db.from("checkout_webhooks").select("id, webinar_id, token, filtro_src").eq("checkout_id", c.id).order("created_at").limit(1000)
    : { data: [] };
  const webinars = (webinarsData ?? []) as { id: string; nome: string }[];
  const nomeWebinar = new Map(webinars.map((w) => [w.id, w.nome]));
  const webhooks: ItemWebhook[] = ((webhooksData ?? []) as unknown as { id: string; webinar_id: string; token: string; filtro_src: string | null }[]).map((w) => ({
    id: w.id,
    plataforma: dados.valor as Plataforma,
    webinarId: w.webinar_id,
    webinarNome: nomeWebinar.get(w.webinar_id) ?? "—",
    token: w.token,
    filtroSrc: w.filtro_src,
  }));
  const salaDoWebhook = new Map(webhooks.map((w) => [w.id, w.webinarNome]));

  // Logs só dos webhooks desta plataforma (um log de webhook já removido fica sem dono e sai daqui).
  let logs: ItemLog[] = [];
  let totalLogs = 0;
  let erroLogs = false;
  if (webhooks.length) {
    let consulta = db
      .from("checkout_logs")
      .select("id, resultado, evento, created_at, bruto, webhook_id", { count: "exact" })
      .in("webhook_id", webhooks.map((w) => w.id))
      .order("created_at", { ascending: false })
      .order("id");
    if (resultado !== "todos") consulta = consulta.eq("resultado", resultado);
    const { desde, ate } = intervaloDaPagina(pagina, POR_PAGINA_LISTA);
    const { data, count, error } = await consulta.range(desde, ate);
    erroLogs = !!error;
    totalLogs = count ?? 0;
    logs = ((data ?? []) as { id: string; resultado: ResultadoLog; evento: string | null; created_at: string; bruto: unknown; webhook_id: string | null }[]).map((l) => {
      const venda = (l.bruto as { venda?: { email?: string | null; valorCentavos?: number | null } } | null)?.venda ?? null;
      return {
        id: l.id,
        resultado: l.resultado,
        evento: l.evento,
        createdAt: l.created_at,
        webinarNome: l.webhook_id ? (salaDoWebhook.get(l.webhook_id) ?? null) : null,
        compradorMascarado: venda?.email ? mascararEmail(venda.email) : null,
        valorCentavos: venda?.valorCentavos ?? null,
      };
    });
  }

  const base = `/configuracoes/checkouts/${dados.valor}`;
  const atuais = { resultado: resultado === "todos" ? "" : resultado };

  return (
    <Pagina titulo={dados.rotulo} trilha={[{ rotulo: "Configurações", href: "/configuracoes" }]} contador={<Selo cor={c?.ligado ? "ok" : "neutro"}>{c?.ligado ? "Conectado" : "Desconectado"}</Selo>}>
      <Cartao titulo="Conexão" icone={KeyRound} ajuda="O segredo confirma que a venda veio mesmo da plataforma. Ele fica cifrado e nunca aparece de novo.">
        <FormularioCheckout dados={dados} item={{ plataforma: dados.valor, ligado: c?.ligado ?? false, temSegredo: !!c?.segredo_enc }} />
      </Cartao>

      <Cartao titulo="Webhooks por sala" icone={Webhook} ajuda="Uma URL por webinar. Cadastre a URL na plataforma, com o evento de venda aprovada.">
        <ListaWebhooks plataforma={dados.valor} webinars={webinars} itens={webhooks} painelUrl={env("NEXT_PUBLIC_PAINEL_URL")} />
      </Cartao>

      <Cartao titulo="Logs dos webhooks" icone={ScrollText} ajuda="Cada chamada recebida nas URLs desta plataforma e o que aconteceu com ela.">
        <div className="space-y-4">
          <SegmentosLink rotulo="Resultado" opcoes={FILTROS_LOG.map((f) => ({ rotulo: f.rotulo, ativo: f.valor === resultado, href: hrefCom(base, atuais, { resultado: f.valor === "todos" ? null : f.valor }) }))} />
          {erroLogs && <p role="alert" className="rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro">Não deu para carregar os logs. Tente de novo.</p>}
          <Tabela
            colunas={["Data", "Resultado", "Evento", "Sala", "Comprador", "Valor"]}
            vazio={logs.length === 0 ? "Sem resultados." : undefined}
            vazioDetalhe={logs.length === 0 && resultado === "todos" ? "Nenhuma chamada recebida ainda." : undefined}
            rodape={<Paginacao total={totalLogs} pagina={pagina} porPagina={POR_PAGINA_LISTA} href={(p) => hrefCom(base, atuais, { pagina: String(p) })} />}
          >
            {logs.map((l) => (
              <tr key={l.id}>
                <td className={`${estiloCelula} whitespace-nowrap py-3`}>{new Date(l.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td className={estiloCelula}>
                  <Selo cor={COR_RESULTADO[l.resultado]}>{ROTULO_RESULTADO[l.resultado]}</Selo>
                </td>
                <td className={`${estiloCelula} text-texto-2`}>{l.evento ?? "—"}</td>
                <td className={`${estiloCelula} max-w-[200px] truncate text-texto-2`}>{l.webinarNome ?? "—"}</td>
                <td className={`${estiloCelula} text-texto-2`}>{l.compradorMascarado ?? "—"}</td>
                <td className={`${estiloCelula} whitespace-nowrap tabular-nums text-texto-2`}>{l.valorCentavos !== null ? formatarReais(l.valorCentavos) : "—"}</td>
              </tr>
            ))}
          </Tabela>
        </div>
      </Cartao>
    </Pagina>
  );
}
