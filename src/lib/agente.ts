import "server-only";
import { dbAdmin } from "./supabase/admin";
import { iaConfig } from "./env";
import { completarJson } from "./ia/openrouter";
import {
  RESPOSTA_ANTES_DA_OFERTA,
  antesDaOferta,
  falaDoValor,
  lerRespostaAgente,
  momentoAoVivo,
  promptAgente,
  removerLinksNaoAutorizados,
  temLink,
  type CfgAgente,
  type MensagemHistorico,
} from "./regras/ia";
import { transmissaoEncerrada } from "./regras/relogio";

type Db = ReturnType<typeof dbAdmin>;

const LIMITE_RESPOSTAS_POR_HORA = 20;
/** Teto de chamadas ao modelo por sessão/hora, contando as mensagens do participante processadas (sejam
 *  respondidas ou não) — consulta barata (só conta `mensagens_suporte`), evita um teto mais caro de contar as
 *  chamadas ao modelo em si. */
const LIMITE_PROCESSADAS_POR_HORA = 30;
/** Teto de segurança por webinar/minuto (IA + processadas recentes), pra um pico de tráfego nunca estourar o
 *  custo de um webinar só. */
const LIMITE_POR_WEBINAR_MINUTO = 120;
const TAMANHO_MINIMO_SEM_PERGUNTA = 8;
const HISTORICO_MAX = 6;
const MAX_TOKENS_RESPOSTA = 400;

export type ParametrosResposta = {
  sessaoId: string;
  webinarId: string;
  texto: string;
  /** Id da mensagem do participante que disparou esta chamada — exclui ela mesma do histórico que vai pro
   *  modelo (já foi gravada antes de `responderComAgente` ser chamada). */
  mensagemId?: string;
};

type Deps = { db?: Db; completarJson?: typeof completarJson };

type LinhaSessao = {
  modo: string;
  status_atendimento: string;
  inicio_sessao: string;
  max_segundo: number | null;
  participantes: { temporario: boolean } | null;
};
type LinhaDuracaoVideo = { videos: { duracao_seg: number | null } | null };

async function duracaoDoVideo(db: Db, webinarId: string): Promise<number> {
  const { data } = await db.from("webinar_video").select("videos(duracao_seg)").eq("webinar_id", webinarId).maybeSingle();
  return (data as LinhaDuracaoVideo | null)?.videos?.duracao_seg ?? 0;
}

/** Depois de uma mensagem nova do participante na sala, decide se o agente de IA responde: agente ligado, IA
 *  configurada, sessão `ao_vivo` (nunca teste, replay ou depois do fim da transmissão) e não provisória, ninguém
 *  do atendimento humano conversando agora (`status_atendimento !== "atendendo"`), mensagem com conteúdo que pareça pergunta (pula texto curto sem "?" sem nem consultar o
 *  banco), e dentro dos tetos de custo: no máximo 20 respostas da IA por sessão/hora, no máximo 30 mensagens
 *  processadas pela IA por sessão/hora, e no máximo 120 por webinar/minuto (IA + processadas). Chamada via
 *  `after()` depois que a mensagem do participante já foi gravada — nunca lança, qualquer problema só vira log. */
export async function responderComAgente(p: ParametrosResposta, deps: Deps = {}): Promise<void> {
  try {
    const texto = p.texto.trim();
    if (!texto) return;
    if (texto.length < TAMANHO_MINIMO_SEM_PERGUNTA && !texto.includes("?")) return;

    const cfg = iaConfig();
    if (!cfg) return;

    const db = deps.db ?? dbAdmin();
    const completarJsonFn = deps.completarJson ?? completarJson;

    const { data: sessaoData } = await db
      .from("sessoes")
      .select("modo, status_atendimento, inicio_sessao, max_segundo, participantes(temporario)")
      .eq("id", p.sessaoId)
      .maybeSingle();
    const sessao = sessaoData as LinhaSessao | null;
    if (!sessao || sessao.modo !== "ao_vivo") return;
    if (sessao.participantes?.temporario) return;
    if (sessao.status_atendimento === "atendendo") return;

    const duracaoSeg = await duracaoDoVideo(db, p.webinarId);
    const encerrada = transmissaoEncerrada({
      modo: "ao_vivo",
      inicioSessaoMs: new Date(sessao.inicio_sessao).getTime(),
      agoraServidorMs: Date.now(),
      duracaoSeg,
      segundoVideo: 0,
    });
    if (encerrada) return;

    const { data: agenteData } = await db
      .from("agentes_ia")
      .select("ligado, nome, instrucoes, contexto, faq")
      .eq("webinar_id", p.webinarId)
      .maybeSingle();
    const agente = agenteData as (CfgAgente & { ligado: boolean }) | null;
    if (!agente || !agente.ligado) return;

    const umaHoraAtras = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count: respostasNaHora } = await db
      .from("mensagens_suporte")
      .select("id", { count: "exact", head: true })
      .eq("sessao_id", p.sessaoId)
      .eq("autor", "ia")
      .gte("created_at", umaHoraAtras);
    if ((respostasNaHora ?? 0) >= LIMITE_RESPOSTAS_POR_HORA) return;

    const { count: processadasNaHora } = await db
      .from("mensagens_suporte")
      .select("id", { count: "exact", head: true })
      .eq("sessao_id", p.sessaoId)
      .eq("autor", "participante")
      .gte("created_at", umaHoraAtras);
    if ((processadasNaHora ?? 0) >= LIMITE_PROCESSADAS_POR_HORA) return;

    const umMinutoAtras = new Date(Date.now() - 60_000).toISOString();
    const { count: noWebinarNoMinuto } = await db
      .from("mensagens_suporte")
      .select("id", { count: "exact", head: true })
      .eq("webinar_id", p.webinarId)
      .in("autor", ["ia", "participante"])
      .gte("created_at", umMinutoAtras);
    if ((noWebinarNoMinuto ?? 0) >= LIMITE_POR_WEBINAR_MINUTO) return;

    let historicoQuery = db
      .from("mensagens_suporte")
      .select("autor, texto")
      .eq("sessao_id", p.sessaoId)
      .order("created_at", { ascending: false })
      .limit(HISTORICO_MAX);
    if (p.mensagemId) historicoQuery = historicoQuery.neq("id", p.mensagemId);
    const { data: historicoData } = await historicoQuery;
    const historico: MensagemHistorico[] = ((historicoData ?? []) as { autor: string; texto: string | null }[])
      .reverse()
      .map((m) => ({ autor: m.autor, texto: m.texto ?? "" }));

    const momentoSeg = momentoAoVivo({
      inicioSessaoMs: new Date(sessao.inicio_sessao).getTime(),
      agoraMs: Date.now(),
      maxSegundo: sessao.max_segundo,
      duracaoSeg,
    });
    const { data: ofertaData } = await db
      .from("ofertas")
      .select("ligada, aparece_seg, preco_original, preco_oferta")
      .eq("webinar_id", p.webinarId)
      .maybeSingle();
    const linhaOferta = ofertaData as { ligada: boolean; aparece_seg: number; preco_original: string | null; preco_oferta: string | null } | null;
    const oferta = linhaOferta ? { ligada: linhaOferta.ligada, apareceSeg: linhaOferta.aparece_seg } : null;
    const precos = [linhaOferta?.preco_original, linhaOferta?.preco_oferta];

    const { sistema, usuario } = promptAgente(agente, texto, historico, momentoSeg);
    const json = await completarJsonFn({ sistema, usuario, maxTokens: MAX_TOKENS_RESPOSTA }, { openrouterKey: cfg.openrouterKey, modelo: cfg.modelo });
    const resposta = lerRespostaAgente(json);
    if (!resposta.responder) return;

    // Trava no código, não só no prompt: antes da oferta aparecer, resposta com link ou com o valor (preço, parcelas)
    // vira o "fica até o final" — falar o preço antes do pitch afasta a pessoa.
    const respostaFiltrada = antesDaOferta(momentoSeg, oferta) && (temLink(resposta.resposta) || falaDoValor(resposta.resposta, precos))
      ? RESPOSTA_ANTES_DA_OFERTA
      : removerLinksNaoAutorizados(resposta.resposta, agente);
    if (!respostaFiltrada) return;

    await db.from("mensagens_suporte").insert({ sessao_id: p.sessaoId, webinar_id: p.webinarId, autor: "ia", texto: respostaFiltrada });
  } catch (e) {
    console.error("[agente] falhou:", e);
  }
}

/** Playground do passo Agente de IA: testa a mesma decisão/resposta do modelo com a configuração ainda não
 *  salva, sem histórico real e sem gravar nada. IA desligada ou o modelo decidindo não responder: `resposta: null`,
 *  sem `erro` (não é falha, é o resultado esperado). Qualquer falha de verdade do cliente de IA (chave errada, IA
 *  fora do ar) devolve o erro amigável de verdade em `erro`, pra o admin perceber que é a configuração que está
 *  quebrada — nunca escondida atrás de "não respondida". */
export async function testarAgente(
  cfg: CfgAgente,
  pergunta: string,
  deps: { completarJson?: typeof completarJson; momentoSeg?: number | null } = {},
): Promise<{ resposta: string | null; erro?: string }> {
  const iaCfg = iaConfig();
  if (!iaCfg) return { resposta: null, erro: "A IA está desligada. Configure as chaves de IA." };
  const completarJsonFn = deps.completarJson ?? completarJson;

  const { sistema, usuario } = promptAgente(cfg, pergunta, [], deps.momentoSeg);
  try {
    const json = await completarJsonFn({ sistema, usuario, maxTokens: MAX_TOKENS_RESPOSTA }, { openrouterKey: iaCfg.openrouterKey, modelo: iaCfg.modelo });
    const r = lerRespostaAgente(json);
    if (!r.responder) return { resposta: null };
    return { resposta: removerLinksNaoAutorizados(r.resposta, cfg) || null };
  } catch (e) {
    return { resposta: null, erro: e instanceof Error ? e.message : "A IA não respondeu." };
  }
}
