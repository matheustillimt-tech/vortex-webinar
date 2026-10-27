import "server-only";
import { dbAdmin } from "./supabase/admin";
import { decifrar } from "./crypto";
import { ehConflito } from "./sala/sessao";
import { normalizarVenda, passaFiltroSrc, semSegredos, type Consulta, type Plataforma, type Venda } from "./regras/checkout";

type Db = ReturnType<typeof dbAdmin>;

export type ResultadoRecebimento = { tipo: "nao_encontrado" } | { tipo: "nao_autorizada" } | { tipo: "ignorada" } | { tipo: "aceita" } | { tipo: "erro" };

type LinhaWebhook = {
  id: string;
  webinar_id: string;
  filtro_src: string | null;
  checkouts: { plataforma: Plataforma; segredo_enc: string | null; ligado: boolean } | null;
};

/** Corpo como vai pro log e pra `vendas.bruto`: JSON sem os campos de segredo (`semSegredos`); texto que não é
 *  JSON vai cortado. */
function corpoParaLog(corpoBruto: string): unknown {
  try {
    return semSegredos(JSON.parse(corpoBruto));
  } catch {
    return { texto: corpoBruto.slice(0, 4000) };
  }
}

async function gravarLog(
  db: Db,
  webhookId: string,
  resultado: "aceita" | "ignorada" | "nao_autorizada" | "erro",
  evento: string | null,
  corpoBruto: string,
  venda: Venda | null,
  motivo: string | null = null,
): Promise<void> {
  const bruto = {
    corpo: corpoParaLog(corpoBruto),
    venda: venda ? { email: venda.email, valorCentavos: venda.valorCentavos } : null,
    ...(motivo ? { motivo } : {}),
  };
  await db.from("checkout_logs").insert({ webhook_id: webhookId, resultado, evento, bruto });
}

/** Ids dos participantes do webinar com esse e-mail ou esse telefone E.164 — duas consultas com igualdade exata
 *  (nada de `ilike`/`.or` montado com texto da plataforma: `_` e `%` seriam curingas). O e-mail vai minúsculo,
 *  como o cadastro e `criarSessao` gravam. */
async function participantesDoComprador(
  db: Db,
  webinarId: string,
  email: string | null,
  telefone: string | null,
  telefoneDigitos: string | null = null,
): Promise<string[]> {
  const ids = new Set<string>();
  if (email) {
    const { data } = await db.from("participantes").select("id").eq("webinar_id", webinarId).eq("email", email.trim().toLowerCase());
    for (const p of (data ?? []) as { id: string }[]) ids.add(p.id);
  }
  if (telefone) {
    const { data } = await db.from("participantes").select("id").eq("webinar_id", webinarId).eq("telefone_e164", telefone);
    for (const p of (data ?? []) as { id: string }[]) ids.add(p.id);
  }
  // Sem casar: comprador de fora (a Pay manda o número sem o código do país e `paraE164` assume Brasil, ex.:
  // "0430780810" de +61 430 780 810). Casa pelo final do número cadastrado — só dígitos, então o `like` não tem
  // curinga vindo da plataforma; 8+ dígitos pra não casar por acaso.
  if (ids.size === 0 && telefoneDigitos && /^\d{8,15}$/.test(telefoneDigitos)) {
    const { data } = await db.from("participantes").select("id").eq("webinar_id", webinarId).like("telefone_e164", `%${telefoneDigitos}`);
    for (const p of (data ?? []) as { id: string }[]) ids.add(p.id);
  }
  return [...ids];
}

/** Sessão mais recente (por `entrou_em`) do webinar entre os participantes que casaram por e-mail ou telefone —
 *  `null` sem nenhum dos dois ou sem casar com ninguém. */
async function sessaoMaisRecente(
  db: Db,
  webinarId: string,
  email: string | null,
  telefone: string | null,
  telefoneDigitos: string | null = null,
): Promise<string | null> {
  if (!email && !telefone && !telefoneDigitos) return null;
  const ids = await participantesDoComprador(db, webinarId, email, telefone, telefoneDigitos);
  if (ids.length === 0) return null;

  const { data: sessao } = await db
    .from("sessoes")
    .select("id")
    .eq("webinar_id", webinarId)
    .neq("modo", "teste")
    .in("participante_id", ids)
    .order("entrou_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (sessao as { id: string } | null)?.id ?? null;
}

/** Recebe uma venda de uma plataforma de checkout: acha o webhook pelo token, confere o checkout está ligado,
 *  normaliza e autentica a venda, grava o log (sempre) e, aceita, deduplica, insere a venda e casa com a sessão
 *  mais recente do mesmo e-mail/telefone no webinar — gravando `vendas.sessao_id` e o evento `comprou`. */
export async function receberVenda(
  plataforma: Plataforma,
  token: string,
  corpoBruto: string,
  headers: Record<string, string>,
  consulta: Consulta = {},
): Promise<ResultadoRecebimento> {
  const db = dbAdmin();

  const { data } = await db.from("checkout_webhooks").select("id, webinar_id, filtro_src, checkouts(plataforma, segredo_enc, ligado)").eq("token", token).maybeSingle();
  const webhook = data as unknown as LinhaWebhook | null;
  if (!webhook || !webhook.checkouts || webhook.checkouts.plataforma !== plataforma) return { tipo: "nao_encontrado" };

  if (!webhook.checkouts.ligado) {
    await gravarLog(db, webhook.id, "ignorada", null, corpoBruto, null);
    return { tipo: "ignorada" };
  }

  const segredo = webhook.checkouts.segredo_enc ? decifrar(webhook.checkouts.segredo_enc) : "";
  const resultado = normalizarVenda(plataforma, corpoBruto, headers, segredo, consulta);

  if (resultado.resultado === "nao_autorizada") {
    await gravarLog(db, webhook.id, "nao_autorizada", null, corpoBruto, null);
    return { tipo: "nao_autorizada" };
  }

  if (resultado.resultado === "ignorada") {
    await gravarLog(db, webhook.id, "ignorada", null, corpoBruto, null, resultado.motivo);
    return { tipo: "ignorada" };
  }

  const venda = resultado.venda;
  if (!passaFiltroSrc(venda, webhook.filtro_src)) {
    await gravarLog(db, webhook.id, "ignorada", venda.evento, corpoBruto, venda, "Fora do filtro de src.");
    return { tipo: "ignorada" };
  }

  const { error: erroInsercao } = await db.from("vendas").insert({
    webinar_id: webhook.webinar_id,
    plataforma: venda.evento,
    id_transacao: venda.idTransacao,
    valor_centavos: venda.valorCentavos,
    comprador_email: venda.email,
    comprador_telefone: venda.telefone,
    src: venda.src,
    utms: venda.utms,
    bruto: corpoParaLog(corpoBruto),
  });

  if (erroInsercao) {
    // Já recebida antes (conflito em plataforma+id_transacao): não é erro, só não casa/avisa de novo.
    if (ehConflito(erroInsercao)) {
      await gravarLog(db, webhook.id, "aceita", venda.evento, corpoBruto, venda);
      return { tipo: "aceita" };
    }
    // Erro de verdade (banco fora, etc.): 500 pra plataforma reenviar depois.
    await gravarLog(db, webhook.id, "erro", venda.evento, corpoBruto, venda, "Não deu para gravar a venda.");
    return { tipo: "erro" };
  }

  const sessaoId = await sessaoMaisRecente(db, webhook.webinar_id, venda.email, venda.telefone, venda.telefoneDigitos);
  if (sessaoId) {
    await db.from("vendas").update({ sessao_id: sessaoId }).eq("plataforma", venda.evento).eq("id_transacao", venda.idTransacao);
    const { error: erroEvento } = await db.from("eventos").insert({ sessao_id: sessaoId, webinar_id: webhook.webinar_id, tipo: "comprou" });
    if (erroEvento && !ehConflito(erroEvento)) console.error(`checkout: não deu para gravar o evento comprou da sessão ${sessaoId}: ${erroEvento}`);
  }

  await gravarLog(db, webhook.id, "aceita", venda.evento, corpoBruto, venda);
  return { tipo: "aceita" };
}
