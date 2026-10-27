export type StatusFiltro = "ativos" | "arquivados" | "todos";
export type TipoFiltro = "todos" | "unica" | "recorrente" | "jit";
export type FiltrosLista = { busca: string; status: StatusFiltro; tipo: TipoFiltro };

/** Formato que o Next entrega em `searchParams` (um valor, vários, ou nada). */
export type SearchParamsEntrada = Record<string, string | string[] | undefined>;

const STATUS_VALIDOS: StatusFiltro[] = ["ativos", "arquivados", "todos"];
const TIPO_VALIDOS: TipoFiltro[] = ["todos", "unica", "recorrente", "jit"];

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Normaliza os `searchParams` da lista de webinars: busca (texto livre), status e tipo (um valor válido, com
 *  padrão quando faltar ou vier algo desconhecido). */
export function filtrosDaLista(searchParams: SearchParamsEntrada): FiltrosLista {
  const busca = primeiro(searchParams.busca).trim();
  const statusBruto = primeiro(searchParams.status);
  const tipoBruto = primeiro(searchParams.tipo);
  const status = (STATUS_VALIDOS as string[]).includes(statusBruto) ? (statusBruto as StatusFiltro) : "ativos";
  const tipo = (TIPO_VALIDOS as string[]).includes(tipoBruto) ? (tipoBruto as TipoFiltro) : "todos";
  return { busca, status, tipo };
}

/** Escapa os operadores do `ilike` (`%`, `_`) e a própria barra de escape, pra buscar o texto digitado ao pé
 *  da letra. */
export function escaparIlike(texto: string): string {
  return texto.replace(/\\/g, "\\\\").replace(/[%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Ordenação, período e paginação da lista (barra de filtros)
// ---------------------------------------------------------------------------------------------------------------

export type OrdemLista = "recentes" | "antigos";
/** Ordenação, período (`de`/`até` em `AAAA-MM-DD`, pela data de criação) e página (começa em 1). */
export type NavegacaoLista = { ordem: OrdemLista; de: string; ate: string; pagina: number };

export const POR_PAGINA_WEBINARS = 10;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(v: string): string {
  if (!DATA.test(v)) return "";
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? "" : v;
}

/** Normaliza ordem, período e página. Período invertido (de > até) troca as pontas. */
export function navegacaoDaLista(searchParams: SearchParamsEntrada): NavegacaoLista {
  const ordem: OrdemLista = primeiro(searchParams.ordem) === "antigos" ? "antigos" : "recentes";
  let de = dataValida(primeiro(searchParams.de).trim());
  let ate = dataValida(primeiro(searchParams.ate).trim());
  if (de && ate && de > ate) [de, ate] = [ate, de];
  const n = Number(primeiro(searchParams.pagina));
  const pagina = Number.isInteger(n) && n >= 1 ? Math.min(n, 100000) : 1;
  return { ordem, de, ate, pagina };
}

/** Início e fim (inclusive) do `.range()` do Supabase pra página pedida. */
export function faixaDaPagina(pagina: number, porPagina = POR_PAGINA_WEBINARS): [number, number] {
  const inicio = (Math.max(1, pagina) - 1) * porPagina;
  return [inicio, inicio + porPagina - 1];
}

/** Período em instantes UTC, contando o dia inteiro no horário de Brasília (UTC−3): `de` 00:00 até o fim de `até`. */
export function periodoEmUtc(de: string, ate: string): { desde: string | null; ateAntes: string | null } {
  const desde = de ? new Date(`${de}T00:00:00-03:00`).toISOString() : null;
  const ateAntes = ate ? new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + 86_400_000).toISOString() : null;
  return { desde, ateAntes };
}

/** Link da lista com os filtros atuais trocando só o que vier em `mudar` (sem os valores padrão, pra URL curta). */
export function hrefDaLista(filtros: FiltrosLista, nav: NavegacaoLista, mudar: Partial<FiltrosLista & NavegacaoLista> = {}): string {
  const t = { ...filtros, ...nav, ...mudar };
  const p = new URLSearchParams();
  if (t.busca) p.set("busca", t.busca);
  if (t.status !== "ativos") p.set("status", t.status);
  if (t.tipo !== "todos") p.set("tipo", t.tipo);
  if (t.ordem !== "recentes") p.set("ordem", t.ordem);
  if (t.de) p.set("de", t.de);
  if (t.ate) p.set("ate", t.ate);
  if (t.pagina > 1) p.set("pagina", String(t.pagina));
  const q = p.toString();
  return q ? `/webinars?${q}` : "/webinars";
}
