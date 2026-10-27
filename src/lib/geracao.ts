import "server-only";
import { dbAdmin } from "./supabase/admin";
import { bunnyConfig, iaConfig } from "./env";
import { completarJson, type CfgOpenRouter } from "./ia/openrouter";
import { transcrever, type CfgElevenLabs } from "./ia/elevenlabs";
import {
  blocosDaTranscricao,
  fonteDeAudio,
  mensagensPorMinuto,
  promptGeracao,
  validarMensagensGeradas,
  type Bloco,
  type OpcoesGeracao,
  type VideoParaAudio,
} from "./regras/ia";

type Db = ReturnType<typeof dbAdmin>;

const EM_ANDAMENTO = ["fila", "transcrevendo", "gerando"] as const;
const LEASE_MS = 5 * 60_000;
const ORCAMENTO_GERACAO_MS = 40_000;
const LIMITE_TENTATIVAS = 3;
const MAX_TOKENS_GERACAO = 4000;
const SEGUNDOS_POR_MSG_TOKENS = 60;
const ERRO_NAO_TERMINOU = "A geração não terminou. Tente de novo.";
const ERRO_GENERICO = "A geração falhou. Tente de novo.";

export type StatusGeracao = "fila" | "transcrevendo" | "gerando" | "pronto" | "erro";

export type Geracao = {
  id: string;
  webinarId: string;
  status: StatusGeracao;
  idioma: OpcoesGeracao["idioma"];
  tom: OpcoesGeracao["tom"];
  intensidade: OpcoesGeracao["intensidade"];
  instrucoes: string | null;
  fonteUrl: string | null;
  blocos: Bloco[] | null;
  blocoAtual: number;
  mensagensGeradas: number;
  erro: string | null;
};

type LinhaGeracao = {
  id: string;
  webinar_id: string;
  status: StatusGeracao;
  idioma: OpcoesGeracao["idioma"];
  tom: OpcoesGeracao["tom"];
  intensidade: OpcoesGeracao["intensidade"];
  instrucoes: string | null;
  fonte_url: string | null;
  blocos: Bloco[] | null;
  bloco_atual: number;
  mensagens_geradas: number;
  erro: string | null;
  trabalhando_ate: string | null;
  tentativas: number;
};

const SELECT_GERACAO =
  "id, webinar_id, status, idioma, tom, intensidade, instrucoes, fonte_url, blocos, bloco_atual, mensagens_geradas, erro, trabalhando_ate, tentativas";

function linhaParaGeracao(l: LinhaGeracao): Geracao {
  return {
    id: l.id,
    webinarId: l.webinar_id,
    status: l.status,
    idioma: l.idioma,
    tom: l.tom,
    intensidade: l.intensidade,
    instrucoes: l.instrucoes,
    fonteUrl: l.fonte_url,
    blocos: l.blocos,
    blocoAtual: l.bloco_atual,
    mensagensGeradas: l.mensagens_geradas,
    erro: l.erro,
  };
}

/** Admin pede uma geração nova de chat por IA pro webinar: precisa da IA configurada (OpenRouter + modelo +
 *  ElevenLabs — sem transcrição não dá para gerar), de um vídeo escolhido no passo Vídeo com fonte válida pra
 *  transcrever (`fonteDeAudio`), e de não ter outra geração em andamento (`fila|transcrevendo|gerando`) pro
 *  mesmo webinar (também garantido no banco por um índice único parcial). Insere a geração em `fila` já com
 *  `fonte_url` resolvida — o cron nunca recalcula a fonte. */
export async function iniciarGeracao(
  webinarId: string,
  opcoes: OpcoesGeracao,
  deps: { db?: Db } = {},
): Promise<{ erro: string } | { ok: true }> {
  const cfg = iaConfig();
  if (!cfg || !cfg.elevenlabsKey) return { erro: "A geração de chat por IA está desligada. Configure as chaves de IA." };

  const db = deps.db ?? dbAdmin();

  const { data: emAndamento } = await db
    .from("geracoes_chat")
    .select("id")
    .eq("webinar_id", webinarId)
    .in("status", EM_ANDAMENTO)
    .limit(1)
    .maybeSingle();
  if (emAndamento) return { erro: "Já tem uma geração em andamento para este webinar." };

  const { data: wvData } = await db.from("webinar_video").select("video_id").eq("webinar_id", webinarId).maybeSingle();
  const videoId = (wvData as { video_id: string } | null)?.video_id;
  if (!videoId) return { erro: "Escolha um vídeo no passo Vídeo antes de gerar o chat." };

  const { data: videoData } = await db.from("videos").select("origem, bunny_guid, hls_url").eq("id", videoId).maybeSingle();
  const video = videoData as VideoParaAudio | null;
  if (!video) return { erro: "Vídeo não encontrado." };

  const cfgBunny = bunnyConfig();
  if (video.origem === "bunny" && !cfgBunny) return { erro: "O Bunny não está configurado." };

  const fonte = fonteDeAudio(video, cfgBunny ?? { libraryId: "", apiKey: "", cdnHost: "" });
  if ("erro" in fonte) return { erro: fonte.erro };

  const { error } = await db.from("geracoes_chat").insert({
    webinar_id: webinarId,
    status: "fila",
    idioma: opcoes.idioma,
    tom: opcoes.tom,
    intensidade: opcoes.intensidade,
    instrucoes: opcoes.instrucoes ?? null,
    fonte_url: fonte.url,
  });
  if (error) return { erro: ehConflitoUnico(error) ? "Já tem uma geração em andamento para este webinar." : "Não deu para iniciar a geração." };

  return { ok: true };
}

/** Conflito do índice único parcial (uma geração em andamento por webinar) — duplica a checagem de
 *  `sala/sessao.ts` (não importada aqui pra não puxar `next/headers` pra dentro do cron). */
function ehConflitoUnico(erro: unknown): boolean {
  return !!erro && typeof erro === "object" && (erro as { code?: string }).code === "23505";
}

async function marcarErro(db: Db, id: string, mensagem: string): Promise<void> {
  await db.from("geracoes_chat").update({ status: "erro", erro: mensagem }).eq("id", id);
}

/** Pega (uma por chamada) a geração em andamento mais antiga pro cron processar: `fila` sempre pode ser pega;
 *  `transcrevendo`/`gerando` só se o lease (`trabalhando_ate`) estiver livre (nulo ou vencido — execução anterior
 *  travou/caiu). Reivindica atomicamente (update condicionado ao mesmo lease livre) para duas execuções não
 *  pegarem a mesma, marcando `trabalhando_ate = agora + 5 min` e somando 1 em `tentativas`. Já reivindicada 3 vezes
 *  sem nunca terminar (travou/caiu 3 vezes seguidas): desiste, marca `erro` direto, sem reivindicar de novo. */
export async function reivindicarGeracao(db: Db = dbAdmin(), agora: Date = new Date()): Promise<Geracao | null> {
  const agoraIso = agora.toISOString();

  const { data } = await db
    .from("geracoes_chat")
    .select(SELECT_GERACAO)
    .in("status", EM_ANDAMENTO)
    .or(`trabalhando_ate.is.null,trabalhando_ate.lt.${agoraIso}`)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const linha = data as LinhaGeracao;

  if ((linha.tentativas ?? 0) >= LIMITE_TENTATIVAS) {
    await marcarErro(db, linha.id, ERRO_NAO_TERMINOU);
    return null;
  }

  const novoStatus: StatusGeracao = linha.status === "fila" ? "transcrevendo" : linha.status;
  const trabalhandoAte = new Date(agora.getTime() + LEASE_MS).toISOString();

  let query = db
    .from("geracoes_chat")
    .update({ status: novoStatus, trabalhando_ate: trabalhandoAte, tentativas: (linha.tentativas ?? 0) + 1 })
    .eq("id", linha.id)
    .in("status", EM_ANDAMENTO);
  query = linha.trabalhando_ate ? query.lt("trabalhando_ate", agoraIso) : query.is("trabalhando_ate", null);

  const { data: reivindicada } = await query.select(SELECT_GERACAO).maybeSingle();
  // Sem linha de volta: outra execução já reivindicou entre a leitura e aqui.
  if (!reivindicada) return null;

  return linhaParaGeracao(reivindicada as LinhaGeracao);
}

export type DepsAvancar = {
  db?: Db;
  transcrever?: typeof transcrever;
  completarJson?: typeof completarJson;
  cfg?: { openrouterKey: string; modelo: string; elevenlabsKey: string | null } | null;
};

/** Avança uma geração em uma etapa (chamada pelo cron, uma geração por execução, já reivindicada):
 *  - `fila`/`transcrevendo`: transcreve o áudio de `fonte_url`, agrupa em blocos de 5 min e passa para `gerando`
 *    (sem nenhum bloco — áudio sem fala — termina direto em `pronto`).
 *  - `gerando`: gera as mensagens bloco a bloco a partir de `bloco_atual`, até `ORCAMENTO_GERACAO_MS` de
 *    orçamento; grava cada bloco em `mensagens_simuladas` e avança `bloco_atual`/`mensagens_geradas` assim que
 *    aquele bloco termina (retomável); sem blocos restantes, termina em `pronto`.
 *  Qualquer erro do cliente de IA (OpenRouter/ElevenLabs) vira `erro` com a mensagem amigável que o próprio
 *  cliente devolveu — nunca o detalhe técnico. Sempre libera o lease (`trabalhando_ate = null`) ao sair, com
 *  sucesso ou erro — a próxima reivindicação não precisa esperar o lease vencer. */
export async function avancarGeracao(geracao: Geracao, deps: DepsAvancar = {}): Promise<void> {
  const db = deps.db ?? dbAdmin();
  const cfg = deps.cfg !== undefined ? deps.cfg : iaConfig();
  const transcreverFn = deps.transcrever ?? transcrever;
  const completarJsonFn = deps.completarJson ?? completarJson;

  try {
    if (!cfg) throw new Error("A IA foi desligada enquanto a geração estava em andamento.");

    if (geracao.status === "fila" || geracao.status === "transcrevendo") {
      if (!cfg.elevenlabsKey) throw new Error("A transcrição foi desligada enquanto a geração estava em andamento.");
      if (!geracao.fonteUrl) throw new Error("Geração sem fonte de áudio.");

      const cfgEleven: CfgElevenLabs = { elevenlabsKey: cfg.elevenlabsKey };
      const { palavras } = await transcreverFn(geracao.fonteUrl, geracao.idioma, cfgEleven);
      const blocos = blocosDaTranscricao(palavras);
      const transcricao = palavras.map((p) => p.texto).join(" ");

      if (blocos.length === 0) {
        const { error } = await db
          .from("geracoes_chat")
          .update({ status: "pronto", transcricao, blocos: [], bloco_atual: 0, total_blocos: 0 })
          .eq("id", geracao.id);
        if (error) throw new Error(ERRO_GENERICO);
        return;
      }
      const { error } = await db
        .from("geracoes_chat")
        .update({ status: "gerando", transcricao, blocos, bloco_atual: 0, total_blocos: blocos.length })
        .eq("id", geracao.id);
      if (error) throw new Error(ERRO_GENERICO);
      return;
    }

    if (geracao.status === "gerando") {
      const blocos = geracao.blocos ?? [];
      let indice = geracao.blocoAtual;
      let mensagensGeradas = geracao.mensagensGeradas;
      const prazo = Date.now() + ORCAMENTO_GERACAO_MS;

      while (indice < blocos.length && Date.now() < prazo) {
        const bloco = blocos[indice];
        const duracaoBloco = bloco.fim - bloco.inicio;
        const alvo = Math.max(1, Math.round((duracaoBloco / 60) * mensagensPorMinuto(geracao.intensidade)));
        const limite = alvo * 2;
        const maxTokens = Math.min(MAX_TOKENS_GERACAO, alvo * SEGUNDOS_POR_MSG_TOKENS);

        const { sistema, usuario } = promptGeracao(bloco, {
          idioma: geracao.idioma,
          tom: geracao.tom,
          intensidade: geracao.intensidade,
          instrucoes: geracao.instrucoes,
        });
        const cfgOpenRouter: CfgOpenRouter = { openrouterKey: cfg.openrouterKey, modelo: cfg.modelo };
        const json = await completarJsonFn({ sistema, usuario, maxTokens }, cfgOpenRouter);
        const mensagens = validarMensagensGeradas(json, bloco, limite);

        if (mensagens.length > 0) {
          const { error } = await db
            .from("mensagens_simuladas")
            .insert(mensagens.map((m) => ({ webinar_id: geracao.webinarId, segundo: m.segundo, nome: m.nome, texto: m.texto, suporte: m.suporte })));
          if (error) throw new Error("Não deu para gravar as mensagens geradas.");
        }

        indice += 1;
        mensagensGeradas += mensagens.length;
        const { error: erroAvanco } = await db
          .from("geracoes_chat")
          .update({ bloco_atual: indice, mensagens_geradas: mensagensGeradas })
          .eq("id", geracao.id);
        if (erroAvanco) throw new Error(ERRO_GENERICO);
      }

      if (indice >= blocos.length) {
        const { error } = await db.from("geracoes_chat").update({ status: "pronto" }).eq("id", geracao.id);
        if (error) throw new Error(ERRO_GENERICO);
      }
      return;
    }
  } catch (e) {
    await marcarErro(db, geracao.id, e instanceof Error && e.message ? e.message : ERRO_GENERICO);
  } finally {
    await db.from("geracoes_chat").update({ trabalhando_ate: null }).eq("id", geracao.id);
  }
}
