import "server-only";
import { dbAdmin } from "./supabase/admin";
import { decifrar } from "./crypto";
import { gatilhosDoEvento, montarRequisicao, esperaTentativa, rotuloGatilho, urlWebhookPermitida, type Gatilho } from "./regras/regras-webhook";

type Db = ReturnType<typeof dbAdmin>;

const TIMEOUT_MS = 10_000;
const MAX_RESPOSTA = 2000;
const CINCO_MINUTOS_MS = 5 * 60_000;
/** Inscrição do just in time que nunca mandou sinal: só conta como "não veio" 2 h depois do horário escolhido (a
 *  sessão nasce na inscrição, às vezes dias antes, e quem chega atrasado ainda pode entrar). */
const ESPERA_SEM_SINAL_JIT_MS = 2 * 60 * 60_000;

function headersDecifrados(headersEnc: string | null): [string, string][] {
  if (!headersEnc) return [];
  try {
    const d = JSON.parse(decifrar(headersEnc));
    return Array.isArray(d) ? (d as [string, string][]) : [];
  } catch {
    return [];
  }
}

function paramsComoPares(params: unknown): [string, string][] {
  if (!params || typeof params !== "object") return [];
  return Object.entries(params as Record<string, string>);
}

function conflito(erro: unknown): boolean {
  return !!erro && typeof erro === "object" && (erro as { code?: string }).code === "23505";
}

/** Insere os disparos ignorando quem já existe (`unique (regra_id, sessao_id)`): um upsert sem efeito no
 *  conflito, em vez de um insert simples (que falharia a linha toda se algum par já existisse). */
async function enfileirarRegras(db: Db, regraIds: string[], sessaoId: string): Promise<void> {
  if (regraIds.length === 0) return;
  const linhas = regraIds.map((regraId) => ({ regra_id: regraId, sessao_id: sessaoId }));
  const { error } = await db.from("disparos").upsert(linhas, { onConflict: "regra_id,sessao_id", ignoreDuplicates: true });
  if (error && !conflito(error)) throw new Error("Não deu para enfileirar o disparo.");
}

/** Eventos que disparam webhook também no link de teste (sala teste do Pronto), pra conferir a integração da oferta
 *  na mão. Os outros eventos não disparam em teste. */
export const EVENTOS_COM_WEBHOOK_NO_TESTE = ["oferta", "clicou_oferta"] as const;

export function eventoDisparaNoTeste(tipoEvento: string): boolean {
  return (EVENTOS_COM_WEBHOOK_NO_TESTE as readonly string[]).includes(tipoEvento);
}

/** Enfileira (uma vez por regra e sessão) as regras ativas do webinar cujo gatilho responde a esse tipo de
 *  evento da sala (`gatilhosDoEvento`). Modo teste só enfileira os eventos da oferta (`eventoDisparaNoTeste`) — a
 *  sessão é confirmada no banco. */
export async function enfileirarPorEvento(sessaoId: string, webinarId: string, tipoEvento: string): Promise<void> {
  const gatilhos = gatilhosDoEvento(tipoEvento);
  if (gatilhos.length === 0) return;
  const db = dbAdmin();

  const { data: sessao } = await db.from("sessoes").select("modo").eq("id", sessaoId).maybeSingle();
  if (!sessao) return;
  if ((sessao as { modo: string }).modo === "teste" && !eventoDisparaNoTeste(tipoEvento)) return;

  const { data: regras } = await db.from("regras").select("id").eq("webinar_id", webinarId).eq("ativa", true).in("gatilho", gatilhos);
  await enfileirarRegras(db, ((regras ?? []) as { id: string }[]).map((r) => r.id), sessaoId);
}

export type SessaoParaFila = { sessaoId: string; webinarId: string; modo: string };

/** Regras `permaneceu` cujo `valor_seg` já foi alcançado (chamada pelo `/api/sala/sinal` a cada posição nova). */
export async function enfileirarPermaneceu(sessao: SessaoParaFila, segundo: number): Promise<void> {
  if (sessao.modo === "teste") return;
  const db = dbAdmin();
  const { data: regras } = await db
    .from("regras")
    .select("id")
    .eq("webinar_id", sessao.webinarId)
    .eq("gatilho", "permaneceu")
    .eq("ativa", true)
    .lte("valor_seg", segundo);
  await enfileirarRegras(db, ((regras ?? []) as { id: string }[]).map((r) => r.id), sessao.sessaoId);
}

type LinhaRegraDetalhe = {
  gatilho: Gatilho;
  url: string;
  metodo: string;
  headers_enc: string | null;
  params: unknown;
  corpo: string | null;
  ativa: boolean;
} | null;

type LinhaSessaoDetalhe = {
  webinar_id: string;
  max_segundo: number;
  utms: Record<string, string> | null;
  participantes: { nome: string; email: string | null; telefone_e164: string | null } | null;
  webinars: { nome: string } | null;
} | null;

type LinhaDisparoDetalhe = { id: string; tentativas: number; regras: LinhaRegraDetalhe; sessoes: LinhaSessaoDetalhe };

type FetchFn = typeof fetch;

/** Header que identifica o disparo pro receptor (idempotência: a mesma tentativa pode chegar duas vezes se o
 *  cron morrer depois de enviar e antes de gravar o resultado). */
export const HEADER_DISPARO = "X-VortexWebinar-Disparo";

/** Lê no máximo `max` bytes do corpo da resposta (stream) e cancela o resto — uma resposta gigante não fica
 *  inteira na memória nem segura a função. Corpo vazio (ou sem corpo) devolve "". */
export async function lerCorpoLimitado(resposta: Response, max: number): Promise<string> {
  if (!resposta.body) return "";
  const leitor = resposta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await leitor.read();
      if (done) break;
      const pedaco = value.byteLength > max - total ? value.subarray(0, max - total) : value;
      partes.push(pedaco);
      total += pedaco.byteLength;
    }
  } finally {
    leitor.cancel().catch(() => {});
  }
  const junto = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    junto.set(p, pos);
    pos += p.byteLength;
  }
  return new TextDecoder().decode(junto);
}

/** Headers finais: os do usuário; o nosso `content-type` só entra se ele não mandou um (sem diferenciar
 *  maiúsculas); e o id do disparo, quando há. */
function headersDoEnvio(req: { headers: [string, string][]; contentType: string | null }, idDisparo: string | null): Record<string, string> {
  const headers: Record<string, string> = Object.fromEntries(req.headers);
  const usuarioTemContentType = req.headers.some(([chave]) => chave.toLowerCase() === "content-type");
  if (req.contentType && !usuarioTemContentType) headers["content-type"] = req.contentType;
  if (idDisparo) headers[HEADER_DISPARO] = idDisparo;
  return headers;
}

/** Envia um disparo já montado, com timeout de 10 s (que vale também pra ler a resposta) e sem seguir
 *  redirecionamento; devolve o status HTTP (ou `null` se nem respondeu) e a mensagem de erro (`null` quando deu
 *  2xx). */
async function enviarComTimeout(
  fetchFn: FetchFn,
  req: { url: string; metodo: string; headers: [string, string][]; corpo: string | null; contentType: "application/json" | "text/plain" | null },
  idDisparo: string | null,
): Promise<{ status: number | null; corpoResposta: string | null; erro: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetchFn(req.url, {
      method: req.metodo,
      headers: headersDoEnvio(req, idDisparo),
      body: req.metodo === "GET" || req.corpo === null ? undefined : req.corpo,
      redirect: "manual",
      signal: controller.signal,
    });
    let corpoResposta: string | null = null;
    try {
      corpoResposta = await lerCorpoLimitado(resposta, MAX_RESPOSTA);
    } catch {
      corpoResposta = null;
    }
    if (resposta.status >= 300 && resposta.status < 400) return { status: resposta.status, corpoResposta, erro: "Redirecionamento não seguido." };
    if (resposta.status < 200 || resposta.status >= 300) return { status: resposta.status, corpoResposta, erro: `Resposta HTTP ${resposta.status}.` };
    return { status: resposta.status, corpoResposta, erro: null };
  } catch {
    return { status: null, corpoResposta: null, erro: controller.signal.aborted ? "Tempo esgotado." : "Não deu para conectar." };
  } finally {
    clearTimeout(timer);
  }
}

async function erroFinal(db: Db, id: string, erro: string): Promise<void> {
  await db.from("disparos").update({ status: "erro", erro }).eq("id", id);
}

async function processarUmDisparo(db: Db, linha: LinhaDisparoDetalhe, agora: Date, fetchFn: FetchFn): Promise<void> {
  if (!linha.regras || !linha.sessoes) return erroFinal(db, linha.id, "Regra ou sessão não encontrada.");

  const regra = linha.regras;
  const sessao = linha.sessoes;
  // Conferido de novo na hora do envio: a regra pode ter sido desligada (ou a URL trocada por uma que não passa
  // mais na validação) depois de o disparo entrar na fila.
  if (!regra.ativa) return erroFinal(db, linha.id, "Regra desativada.");
  if (!urlWebhookPermitida(regra.url)) return erroFinal(db, linha.id, "Use um endereço https público.");

  const req = montarRequisicao(
    { url: regra.url, metodo: regra.metodo, headers: headersDecifrados(regra.headers_enc), params: paramsComoPares(regra.params), corpo: regra.corpo },
    {
      nome: sessao.participantes?.nome ?? "",
      email: sessao.participantes?.email ?? null,
      telefone: sessao.participantes?.telefone_e164 ?? null,
      tag: rotuloGatilho(regra.gatilho),
      dataIso: agora.toISOString(),
      utms: sessao.utms ?? {},
      tempoSeg: sessao.max_segundo,
      webinarNome: sessao.webinars?.nome ?? "",
    },
  );

  const { status, corpoResposta, erro } = await enviarComTimeout(fetchFn, req, linha.id);

  const requisicaoLog = { url: req.url, metodo: req.metodo, headers: req.headers.map(([chave]) => chave), corpo: req.corpo };
  const respostaLog = status !== null ? { status, corpo: corpoResposta } : null;

  // Cada gravação abaixo sobrescreve status/enviar_apos da reserva feita pelo `pegar_disparos`.
  if (!erro) {
    await db.from("disparos").update({ status: "ok", requisicao: requisicaoLog, resposta: respostaLog, erro: null }).eq("id", linha.id);
    return;
  }

  const espera = esperaTentativa(linha.tentativas);
  if (espera === null) {
    await db.from("disparos").update({ status: "erro", requisicao: requisicaoLog, resposta: respostaLog, erro }).eq("id", linha.id);
  } else {
    await db
      .from("disparos")
      .update({ status: "fila", requisicao: requisicaoLog, resposta: respostaLog, erro, enviar_apos: new Date(agora.getTime() + espera).toISOString() })
      .eq("id", linha.id);
  }
}

export type OpcoesFila = {
  /** Instante (ms, no relógio de `relogio`) depois do qual nenhum envio novo começa. */
  prazo?: number;
  relogio?: () => number;
  /** Quantos envios ao mesmo tempo (padrão 10). */
  concorrencia?: number;
};

/** Processa até `limite` disparos da fila (`pegar_disparos`, que já reserva por 3 min e incrementa as
 *  tentativas), com até `concorrencia` envios ao mesmo tempo. Passado o `prazo`, não começa envio novo: os que
 *  sobraram são devolvidos à fila na hora (tentativa desfeita), pro próximo cron. `fetchFn` e o relógio são
 *  injetáveis pros testes. */
export async function processarFila(
  limite: number,
  agora: Date,
  fetchFn: FetchFn = fetch,
  opcoes: OpcoesFila = {},
): Promise<{ processados: number; adiados: number }> {
  const relogio = opcoes.relogio ?? Date.now;
  const prazo = opcoes.prazo ?? Number.POSITIVE_INFINITY;
  const concorrencia = Math.max(1, opcoes.concorrencia ?? 10);

  const db = dbAdmin();
  const { data: pegos, error: erroPegar } = await db.rpc("pegar_disparos", { p_limite: limite });
  if (erroPegar) throw new Error("Não deu para pegar a fila de disparos.");
  const disparos = (pegos ?? []) as { id: string; tentativas: number }[];
  if (disparos.length === 0) return { processados: 0, adiados: 0 };

  const { data: detalhes, error: erroDetalhes } = await db
    .from("disparos")
    .select(
      "id, tentativas, regras(gatilho, url, metodo, headers_enc, params, corpo, ativa), sessoes(webinar_id, max_segundo, utms, participantes(nome, email, telefone_e164), webinars!sessoes_webinar_id_fkey(nome))",
    )
    .in(
      "id",
      disparos.map((d) => d.id),
    );
  // Sem os detalhes, a reserva de 3 min expira sozinha e o próximo cron tenta de novo.
  if (erroDetalhes) throw new Error("Não deu para ler os disparos.");

  const linhas = (detalhes ?? []) as unknown as LinhaDisparoDetalhe[];
  let proximo = 0;
  let processados = 0;
  const sobras: LinhaDisparoDetalhe[] = [];

  async function trabalhador(): Promise<void> {
    while (proximo < linhas.length) {
      const linha = linhas[proximo++];
      if (relogio() >= prazo) {
        sobras.push(linha);
        continue;
      }
      try {
        await processarUmDisparo(db, linha, agora, fetchFn);
      } catch (e) {
        console.error(`disparos: falha ao processar o disparo ${linha.id}: ${e}`);
      }
      processados += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, linhas.length) }, () => trabalhador()));

  // Devolve à fila o que não deu tempo de enviar (desfaz a tentativa contada na reserva).
  for (const linha of sobras) {
    await db
      .from("disparos")
      .update({ tentativas: Math.max(0, linha.tentativas - 1), enviar_apos: agora.toISOString() })
      .eq("id", linha.id);
  }

  return { processados, adiados: sobras.length };
}

type LinhaSessaoFim = { id: string; webinar_id: string; max_segundo: number; modo: string };
type RegraFim = { id: string; gatilho: string; valor_seg: number | null };

/** Sessões encerradas e ainda não avaliadas — sem sinal há mais de 5 min, ou que nunca mandaram sinal e entraram
 *  há mais de 5 min (inscrição do JIT: 2 h depois do horário escolhido) — fora do modo teste: enfileira `abandonou` (quando `max_segundo` ficou abaixo do `valor_seg`
 *  da regra) e `nao_viu_oferta` (sem o evento `oferta`), e marca `avaliada_fim`. Qualquer erro de banco ao
 *  avaliar uma sessão pula a sessão sem marcar (o próximo cron tenta de novo) — nunca dispara `nao_viu_oferta`
 *  por não ter conseguido ler os eventos. As regras são lidas uma vez por webinar a cada execução. */
export async function avaliarFimDeSessoes(limite: number, agora: Date): Promise<{ avaliadas: number }> {
  const db = dbAdmin();
  const limiar = new Date(agora.getTime() - CINCO_MINUTOS_MS).toISOString();
  const limiarJit = new Date(agora.getTime() - ESPERA_SEM_SINAL_JIT_MS).toISOString();
  const colunas = "id, webinar_id, max_segundo, modo";

  const { data: comSinal, error: erroComSinal } = await db
    .from("sessoes")
    .select(colunas)
    .eq("avaliada_fim", false)
    .neq("modo", "teste")
    .lt("ultimo_sinal_em", limiar)
    .limit(limite);
  if (erroComSinal) throw new Error("Não deu para buscar as sessões encerradas.");
  const { data: semSinal, error: erroSemSinal } = await db
    .from("sessoes")
    .select(colunas)
    .eq("avaliada_fim", false)
    .neq("modo", "teste")
    .is("ultimo_sinal_em", null)
    .lt("entrou_em", limiar)
    // JIT: `entrou_em` é a hora da inscrição, não da entrada. Sem isso, toda inscrição para um horário futuro
    // seria avaliada 5 min depois de feita (disparando `abandonou`/`nao_viu_oferta` e marcando `avaliada_fim`).
    .or(`jit_horario.is.null,jit_horario.lt."${limiarJit}"`)
    .limit(limite);
  if (erroSemSinal) throw new Error("Não deu para buscar as sessões encerradas.");

  const sessoes = [...((comSinal ?? []) as LinhaSessaoFim[]), ...((semSinal ?? []) as LinhaSessaoFim[])].slice(0, limite);
  const regrasPorWebinar = new Map<string, RegraFim[] | null>();

  async function regrasDoWebinar(webinarId: string): Promise<RegraFim[] | null> {
    if (regrasPorWebinar.has(webinarId)) return regrasPorWebinar.get(webinarId)!;
    const { data, error } = await db
      .from("regras")
      .select("id, gatilho, valor_seg")
      .eq("webinar_id", webinarId)
      .eq("ativa", true)
      .in("gatilho", ["abandonou", "nao_viu_oferta"]);
    // Erro não fica no cache como "sem regras": `null` faz as sessões deste webinar serem puladas.
    const regras = error ? null : ((data ?? []) as RegraFim[]);
    regrasPorWebinar.set(webinarId, regras);
    return regras;
  }

  let avaliadas = 0;
  for (const s of sessoes) {
    if (s.modo === "teste") continue; // defesa: a busca já tira o modo teste
    try {
      const regras = await regrasDoWebinar(s.webinar_id);
      if (regras === null) continue;

      const abandonou = regras.filter((r) => r.gatilho === "abandonou" && s.max_segundo < (r.valor_seg ?? 0));
      const naoViu = regras.filter((r) => r.gatilho === "nao_viu_oferta");

      const aEnfileirar = [...abandonou];
      if (naoViu.length > 0) {
        const { data: temOferta, error: erroEvento } = await db.from("eventos").select("id").eq("sessao_id", s.id).eq("tipo", "oferta").maybeSingle();
        if (erroEvento) continue;
        if (!temOferta) aEnfileirar.push(...naoViu);
      }
      await enfileirarRegras(db, aEnfileirar.map((r) => r.id), s.id);

      const { error: erroMarcar } = await db.from("sessoes").update({ avaliada_fim: true }).eq("id", s.id);
      if (!erroMarcar) avaliadas += 1;
    } catch (e) {
      console.error(`disparos: falha ao avaliar o fim da sessão ${s.id}: ${e}`);
    }
  }

  return { avaliadas };
}

/** Dispara uma regra com dados fictícios, sem gravar nada em `disparos` — usado pelo botão "Enviar teste" do
 *  painel. */
export async function enviarTeste(regraId: string): Promise<{ status: number; corpo: string } | { erro: string }> {
  const db = dbAdmin();
  const { data } = await db.from("regras").select("gatilho, url, metodo, headers_enc, params, corpo").eq("id", regraId).maybeSingle();
  if (!data) return { erro: "Regra não encontrada." };
  const regra = data as { gatilho: Gatilho; url: string; metodo: string; headers_enc: string | null; params: unknown; corpo: string | null };
  if (!urlWebhookPermitida(regra.url)) return { erro: "Use um endereço https público." };

  const req = montarRequisicao(
    { url: regra.url, metodo: regra.metodo, headers: headersDecifrados(regra.headers_enc), params: paramsComoPares(regra.params), corpo: regra.corpo },
    {
      nome: "Teste Vórtex Webinar",
      email: "teste@exemplo.com.br",
      telefone: null,
      tag: rotuloGatilho(regra.gatilho),
      dataIso: new Date().toISOString(),
      utms: {},
      tempoSeg: 0,
      webinarNome: "Teste Vórtex Webinar",
    },
  );

  const { status, corpoResposta, erro } = await enviarComTimeout(fetch, req, "teste");
  if (status === null) return { erro: erro ?? "Não deu para conectar." };
  return { status, corpo: corpoResposta ?? "" };
}
