/** Chave cuja parte (não precisa ser igual, basta conter) casa aqui nunca grava o valor real na auditoria
 *  (senha, corpo de login, segredos cifrados, tokens/headers de checkout, chaves de API, script): a chave
 *  continua em `antes`/`depois`, só que com o valor trocado por `"[removido]"` — dá para ver que o campo mudou
 *  sem expor o segredo. Casa por substring (ex.: "nova_senha", "api_key_extra", "headers_enc"), não pelo
 *  nome exato. */
const REGEX_CHAVE_SENSIVEL = /senha|password|token|segredo|secret|headers|api_?key|script/i;

/** Única exceção à regra acima: o script HTML da tela de rastreamento casa com `/script/i`, mas não é segredo —
 *  continua marcado como `"alterado"` (idêntico ao comportamento anterior), não removido. */
const CHAVE_SCRIPT_PERSONALIZADO = "script_personalizado";

/** Valor de texto maior que isto é cortado antes de gravar. */
const LIMITE_CARACTERES = 2000;

function cortarTexto(valor: string): string {
  return valor.length > LIMITE_CARACTERES ? `${valor.slice(0, LIMITE_CARACTERES)}…` : valor;
}

function limparValor(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(limparValor);
  if (valor && typeof valor === "object") return limparObjeto(valor as Record<string, unknown>);
  if (typeof valor === "string") return cortarTexto(valor);
  return valor;
}

function limparObjeto(obj: Record<string, unknown>): Record<string, unknown> {
  const limpo: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(obj)) {
    if (chave.toLowerCase() === CHAVE_SCRIPT_PERSONALIZADO) {
      limpo[chave] = "alterado";
    } else if (REGEX_CHAVE_SENSIVEL.test(chave)) {
      limpo[chave] = "[removido]";
    } else {
      limpo[chave] = limparValor(valor);
    }
  }
  return limpo;
}

/** Prepara um objeto (`antes`/`depois` da auditoria) pra gravar: troca os campos sensíveis (por substring da
 *  chave, recursivo — objetos aninhados também passam pela mesma regra) por `"[removido]"` e corta textos
 *  longos. `null`/`undefined` passam direto. */
export function limparParaAuditoria<T extends Record<string, unknown> | null | undefined>(obj: T): T {
  if (obj == null) return obj;
  return limparObjeto(obj) as T;
}

export type AcaoFiltro = "todas" | "criou" | "editou" | "excluiu";
export type FiltrosHistorico = { acao: AcaoFiltro; busca: string; de: string; ate: string; pagina: number };
/** Formato que o Next entrega em `searchParams` (um valor, vários, ou nada). */
export type SearchParamsEntrada = Record<string, string | string[] | undefined>;

export const ITENS_POR_PAGINA_HISTORICO = 50;

const ACOES_VALIDAS: AcaoFiltro[] = ["todas", "criou", "editou", "excluiu"];

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Normaliza os `searchParams` das telas de histórico: ação (uma das 3 válidas, ou "todas"), busca na descrição,
 *  período (`de`/`ate`, texto livre — a página só usa se vier algo) e a página (1 em diante). */
export function filtrosHistorico(searchParams: SearchParamsEntrada): FiltrosHistorico {
  const acaoBruta = primeiro(searchParams.acao);
  const acao = (ACOES_VALIDAS as string[]).includes(acaoBruta) ? (acaoBruta as AcaoFiltro) : "todas";
  const busca = primeiro(searchParams.busca).trim();
  const de = primeiro(searchParams.de).trim();
  const ate = primeiro(searchParams.ate).trim();
  const paginaBruta = Number(primeiro(searchParams.pagina));
  const pagina = Number.isFinite(paginaBruta) && paginaBruta > 1 ? Math.floor(paginaBruta) : 1;
  return { acao, busca, de, ate, pagina };
}

export type CampoAlterado = { campo: string; antes: unknown; depois: unknown };

/** Pros detalhes do histórico: só os campos que realmente mudaram entre `antes` e `depois` (união das duas
 *  chaves); campo presente só de um lado conta como alterado (de/para `undefined`). Compara por `JSON.stringify`
 *  (os valores aqui são sempre primitivos ou coisa simples vinda do banco). */
export function camposAlterados(antes: Record<string, unknown> | null, depois: Record<string, unknown> | null): CampoAlterado[] {
  const chaves = new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})]);
  const alterados: CampoAlterado[] = [];
  for (const campo of chaves) {
    const valorAntes = antes?.[campo];
    const valorDepois = depois?.[campo];
    if (JSON.stringify(valorAntes) !== JSON.stringify(valorDepois)) alterados.push({ campo, antes: valorAntes, depois: valorDepois });
  }
  return alterados;
}
