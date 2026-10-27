// Filtros e paginação das listas do painel (barra com Ordenar, Status e Período; rodapé com
// "Total de registros" e Anterior/Próximo). Tudo vem da URL (`searchParams`), e a página é cortada no servidor com
// `range()`, então nenhuma consulta passa do teto de 1000 linhas do PostgREST.

/** Formato que o Next entrega em `searchParams` (um valor, vários, ou nada). */
export type ParametrosUrl = Record<string, string | string[] | undefined>;

/** Linhas por página nas listas do painel. */
export const POR_PAGINA_LISTA = 10;

export type Ordem = "recentes" | "antigos";
export const OPCOES_ORDEM: { valor: Ordem; rotulo: string }[] = [
  { valor: "recentes", rotulo: "Mais recentes" },
  { valor: "antigos", rotulo: "Mais antigos" },
];

/** Primeiro valor do parâmetro, sem espaços nas pontas ("" quando não veio). */
export function textoDe(sp: ParametrosUrl, chave: string): string {
  const v = sp[chave];
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
}

/** Valor do parâmetro se estiver entre os `validos`; senão, o `padrao`. */
export function opcaoDe<T extends string>(sp: ParametrosUrl, chave: string, validos: readonly T[], padrao: T): T {
  const bruto = textoDe(sp, chave);
  return (validos as readonly string[]).includes(bruto) ? (bruto as T) : padrao;
}

/** `?ordem=` (padrão: mais recentes primeiro). */
export function ordemDe(sp: ParametrosUrl): Ordem {
  return opcaoDe(sp, "ordem", ["recentes", "antigos"] as const, "recentes");
}

/** `?pagina=` a partir de 1 (qualquer coisa inválida vira 1). */
export function paginaDe(sp: ParametrosUrl): number {
  const n = Number(textoDe(sp, "pagina"));
  return Number.isFinite(n) && n > 1 ? Math.floor(n) : 1;
}

/** Limites do `range()` do Supabase (inclusivos) para a página pedida. */
export function intervaloDaPagina(pagina: number, porPagina: number = POR_PAGINA_LISTA): { desde: number; ate: number } {
  const p = Math.max(1, Math.floor(pagina));
  const desde = (p - 1) * porPagina;
  return { desde, ate: desde + porPagina - 1 };
}

/** Última página que existe para `total` registros (no mínimo 1). */
export function ultimaPagina(total: number, porPagina: number = POR_PAGINA_LISTA): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / porPagina));
}

/**
 * Monta o link da lista com os filtros `atuais` trocados pelas `mudancas` (`null` ou "" apaga o parâmetro). Mudar
 * qualquer filtro volta para a página 1 (apaga `pagina`), a não ser que a própria mudança diga a página.
 */
export function hrefCom(base: string, atuais: Record<string, string | undefined>, mudancas: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(atuais)) if (v) p.set(k, v);
  if (!("pagina" in mudancas)) p.delete("pagina");
  for (const [k, v] of Object.entries(mudancas)) {
    if (v === null || v === undefined || v === "" || (k === "pagina" && v === "1")) p.delete(k);
    else p.set(k, v);
  }
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

/** "2026-10-01" → "01/10/2026" (texto do botão de período). Devolve "" se não for uma data `aaaa-mm-dd`. */
export function dataCurta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
