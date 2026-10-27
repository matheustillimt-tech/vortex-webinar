import "server-only";
import { formatarDuracao, lerDuracao } from "../../regras/video";
import { dbAdmin } from "../../supabase/admin";
import { ehUuid } from "../comum";

/** Peças comuns das ferramentas de conteúdo (agente, chatbot, chat e vendas simulados). */

type Db = ReturnType<typeof dbAdmin>;

/** Ids por `.in()` num delete: mantém a URL do PostgREST curta. */
export const LOTE_IDS = 200;
/** Máximo de linhas por chamada de adicionar_* (2000 = 4 lotes). */
export const MAX_LOTE = 2000;
export const MAX_ERROS_EXIBIDOS = 20;

/** Momento no vídeo como o painel aceita: texto "h:mm:ss"/"m:ss" ou número de segundos. */
export const MOMENTO = {
  momento: { type: "string", description: 'Momento no vídeo, "h:mm:ss" ou "m:ss" (ex.: "0:12:30" ou "12:30"). Ou use `segundo`.' },
  segundo: { type: "integer", minimum: 0, description: "Momento no vídeo em segundos (ex.: 750 = 12:30). Alternativa a `momento`." },
} as const;

export const INTERVALO = {
  de_segundo: {
    type: ["integer", "string"],
    description: 'Início do intervalo (inclusive): segundos (ex.: 600) ou "h:mm:ss".',
  },
  ate_segundo: {
    type: ["integer", "string"],
    description: 'Fim do intervalo (inclusive): segundos (ex.: 1200) ou "h:mm:ss".',
  },
} as const;

/** `momento`/`segundo` dos args → texto que `validarMensagemSimulada`/`validarVendaSimulada` leem em `momento`.
 *  Sem nenhum dos dois, devolve `padrao` (no editar, o momento atual). */
export function momentoDeArgs(a: Record<string, unknown>, padrao = ""): string {
  if (typeof a.segundo === "number" && Number.isInteger(a.segundo) && a.segundo >= 0) return formatarDuracao(a.segundo);
  if (typeof a.momento === "string" && a.momento.trim()) return a.momento.trim();
  if (typeof a.segundo === "string" && a.segundo.trim()) return a.segundo.trim();
  return padrao;
}

/** Segundo de um filtro: número inteiro ≥ 0, texto só com dígitos ou "h:mm:ss". `undefined` = sem filtro;
 *  `null` = valor inválido. */
export function segundoDoFiltro(v: unknown): number | null | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d+$/.test(s)) return Number(s);
    return lerDuracao(s);
  }
  return null;
}

/** Lê `de_segundo`/`ate_segundo`. */
export function intervaloDeArgs(a: Record<string, unknown>): { erro: string } | { de?: number; ate?: number } {
  const de = segundoDoFiltro(a.de_segundo);
  const ate = segundoDoFiltro(a.ate_segundo);
  if (de === null) return { erro: 'de_segundo inválido: use segundos (ex.: 600) ou "h:mm:ss".' };
  if (ate === null) return { erro: 'ate_segundo inválido: use segundos (ex.: 1200) ou "h:mm:ss".' };
  if (de !== undefined && ate !== undefined && de > ate) return { erro: "de_segundo não pode passar de ate_segundo." };
  return { de, ate };
}

export async function webinarExiste(db: Db, webinarId: unknown): Promise<boolean> {
  if (typeof webinarId !== "string") return false;
  const { data } = await db.from("webinars").select("id").eq("id", webinarId).maybeSingle();
  return !!data;
}

/** Texto do arg pra mesclar com o atual: string → ela mesma; `null` → "" (limpa); ausente → o atual. */
export function textoOuAtual(a: Record<string, unknown>, chave: string, atual: string | null | undefined): string {
  if (a[chave] === null) return "";
  if (typeof a[chave] === "string") return a[chave] as string;
  if (typeof a[chave] === "number") return String(a[chave]);
  return atual ?? "";
}

/** Booleano do arg (ausente → atual), no formato de checkbox ("on"/"") que os validadores esperam. */
export function checkboxOuAtual(a: Record<string, unknown>, chave: string, atual: boolean | null | undefined): string {
  const v = typeof a[chave] === "boolean" ? (a[chave] as boolean) : !!atual;
  return v ? "on" : "";
}

/** Exclusão em massa de uma tabela de linha do tempo (`mensagens_simuladas` / `vendas_simuladas`), por ids, por
 *  intervalo de segundos ou tudo (exige `confirmar: true`). Exatamente um critério por chamada. Devolve quantas
 *  linhas saíram e a descrição do critério pra auditoria. */
export async function excluirDaLinhaDoTempo(
  db: Db,
  tabela: "mensagens_simuladas" | "vendas_simuladas",
  webinarId: string,
  a: Record<string, unknown>,
): Promise<{ erro: string } | { excluidas: number; criterio: "ids" | "intervalo" | "tudo"; de?: number; ate?: number }> {
  const temIds = Array.isArray(a.ids) && a.ids.length > 0;
  const temIntervalo = a.de_segundo !== undefined || a.ate_segundo !== undefined;
  const tudo = a.tudo === true;
  const criterios = [temIds, temIntervalo, tudo].filter(Boolean).length;
  if (criterios === 0) return { erro: "Diga o que excluir: `ids`, um intervalo (`de_segundo`/`ate_segundo`) ou `tudo: true`." };
  if (criterios > 1) return { erro: "Use só um critério por vez: `ids`, intervalo ou `tudo`." };

  if (tudo) {
    if (a.confirmar !== true) return { erro: "Apagar tudo não tem volta: mande também `confirmar: true`." };
    const { count, error } = await db.from(tabela).delete({ count: "exact" }).eq("webinar_id", webinarId);
    if (error) return { erro: "Não deu para excluir." };
    return { excluidas: count ?? 0, criterio: "tudo" };
  }

  if (temIds) {
    const ids = a.ids as unknown[];
    if (ids.length > MAX_LOTE) return { erro: `No máximo ${MAX_LOTE} ids por chamada.` };
    if (!ids.every(ehUuid)) return { erro: "Algum id não é um UUID válido." };
    let excluidas = 0;
    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      const { count, error } = await db
        .from(tabela)
        .delete({ count: "exact" })
        .eq("webinar_id", webinarId)
        .in("id", ids.slice(i, i + LOTE_IDS) as string[]);
      if (error) return { erro: i > 0 ? `A exclusão parou no meio: ${excluidas} já saíram. Confira a lista.` : "Não deu para excluir." };
      excluidas += count ?? 0;
    }
    return { excluidas, criterio: "ids" };
  }

  const intervalo = intervaloDeArgs(a);
  if ("erro" in intervalo) return intervalo;
  let q = db.from(tabela).delete({ count: "exact" }).eq("webinar_id", webinarId);
  if (intervalo.de !== undefined) q = q.gte("segundo", intervalo.de);
  if (intervalo.ate !== undefined) q = q.lte("segundo", intervalo.ate);
  const { count, error } = await q;
  if (error) return { erro: "Não deu para excluir." };
  return { excluidas: count ?? 0, criterio: "intervalo", de: intervalo.de, ate: intervalo.ate };
}

/** Grava tudo num insert só: o PostgREST roda um `INSERT` único (uma transação), então ou entram todas as linhas
 *  ou nenhuma — o "tudo ou nada" de verdade, sem o erro parcial que os lotes de 500 da importação de planilha podem
 *  deixar. Até `MAX_LOTE` (2000) linhas curtas cabem folgado num corpo de requisição. */
export async function inserirTudoOuNada(
  db: Db,
  tabela: "mensagens_simuladas" | "vendas_simuladas",
  linhas: Record<string, unknown>[],
  nomePlural: string,
): Promise<{ erro: string } | { ok: true }> {
  const { error } = await db.from(tabela).insert(linhas);
  if (error) return { erro: `Não deu para adicionar as ${nomePlural}. Nada foi gravado.` };
  return { ok: true };
}

/** Descrição de um intervalo de segundos pra auditoria/saída ("de 10:00 a 20:00"). */
export function descreverIntervalo(de?: number, ate?: number): string {
  if (de !== undefined && ate !== undefined) return `de ${formatarDuracao(de)} a ${formatarDuracao(ate)}`;
  if (de !== undefined) return `a partir de ${formatarDuracao(de)}`;
  if (ate !== undefined) return `até ${formatarDuracao(ate)}`;
  return "do vídeo inteiro";
}
