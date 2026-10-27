import sanitizeHtml from "sanitize-html";

// Páginas do editor (GrapesJS): validação, limpeza do HTML/CSS publicado e quebra nos blocos dinâmicos da sala.

export type TipoPagina = "registro_jit" | "espera_jit" | "espera_unica";
export const TIPOS_PAGINA: readonly TipoPagina[] = ["registro_jit", "espera_jit", "espera_unica"];

export type ModeloPagina = "registro_botao" | "registro_form" | "espera_jit" | "espera_unica";
export const MODELOS_POR_TIPO: Record<TipoPagina, readonly ModeloPagina[]> = {
  registro_jit: ["registro_botao", "registro_form"],
  espera_jit: ["espera_jit"],
  espera_unica: ["espera_unica"],
};

/** Blocos dinâmicos: no HTML são marcadores `<div data-vw="..."></div>`; na sala viram componentes React. */
export const BLOCOS_VW = [
  "titulo",
  "apresentador",
  "foto-apresentador",
  "data-sessao",
  "contagem",
  "formulario",
  "horarios",
  "vagas",
] as const;
export type BlocoVw = (typeof BLOCOS_VW)[number];

export const MAX_NOME_PAGINA = 120;
export const MAX_HTML_PAGINA = 300 * 1024;
export const MAX_CSS_PAGINA = 100 * 1024;
/** Classe do contêiner da página na sala; todo o CSS do usuário é escopado nele. */
export const ESCOPO_PAGINA = "vw-pagina";

function ehBloco(v: unknown): v is BlocoVw {
  return typeof v === "string" && (BLOCOS_VW as readonly string[]).includes(v);
}

// Validação --------------------------------------------------------------------------------------------------------

export function validarNomePagina(nome: string | null | undefined): string | null {
  const n = (nome ?? "").trim();
  if (!n) return "Informe o nome da página.";
  if (n.length > MAX_NOME_PAGINA) return `Use até ${MAX_NOME_PAGINA} caracteres no nome.`;
  return null;
}

export type DadosPagina = { nome: string; tipo: TipoPagina; modelo: ModeloPagina };

/** Criação: nome, tipo e modelo de partida (o modelo precisa ser do tipo escolhido). */
export function validarPagina(c: {
  nome?: string | null;
  tipo?: string | null;
  modelo?: string | null;
}): { erro: string } | { dados: DadosPagina } {
  const erroNome = validarNomePagina(c.nome);
  if (erroNome) return { erro: erroNome };
  const tipo = c.tipo as TipoPagina;
  if (!TIPOS_PAGINA.includes(tipo)) return { erro: "Escolha o tipo da página." };
  const modelo = c.modelo as ModeloPagina;
  if (!MODELOS_POR_TIPO[tipo].includes(modelo)) return { erro: "Escolha um modelo deste tipo de página." };
  return { dados: { nome: (c.nome ?? "").trim(), tipo, modelo } };
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Salvar no editor: limite de tamanho do HTML/CSS publicados (em bytes, idêntico ao check do banco). */
export function validarConteudoPagina(c: { html: string; css: string }): string | null {
  if (bytes(c.html) > MAX_HTML_PAGINA) return "A página ficou grande demais (máximo de 300 KB de HTML).";
  if (bytes(c.css) > MAX_CSS_PAGINA) return "O CSS ficou grande demais (máximo de 100 KB).";
  return null;
}

/** Vincular a um webinar: a página precisa ser do tipo do lugar e, se for de registro, ter o bloco `formulario`. */
export function validarVinculoPagina(pagina: { tipo: string; html: string }, lugar: TipoPagina): string | null {
  if (pagina.tipo !== lugar) return "Esta página não é do tipo certo para este lugar.";
  if (lugar === "registro_jit" && !temFormulario(pagina.html)) return "A página de registro precisa ter o formulário.";
  return null;
}

// CSS: declarações -------------------------------------------------------------------------------------------------

/** Desfaz escapes de CSS (`\78` → `x`, `\:` → `:`), tira comentários/espaços e põe em minúsculas: a forma usada só
 *  para decidir se uma declaração é perigosa (nunca para a saída). */
function normalizarParaChecar(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h: string) => {
      const n = parseInt(h, 16);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, "")
    .toLowerCase();
}

const URL_CSS = /url\(([^)]*)\)/g;
const DATA_IMAGEM = /^data:image\/(png|jpe?g|gif|webp)[;,]/;
const ESQUEMA = /^[a-z][a-z0-9+.-]*:/;

function urlCssPermitida(bruta: string): boolean {
  const u = bruta.replace(/^['"]|['"]$/g, "");
  if (!ESQUEMA.test(u)) return true; // relativa ou âncora
  return /^https?:/.test(u) || DATA_IMAGEM.test(u);
}

/** Declaração CSS perigosa: `expression()` (IE), `javascript:`/`vbscript:`, `behavior`, `-moz-binding`, `@import`
 *  ou `url()` com esquema que não seja http(s)/`data:image`. */
function declaracaoPerigosa(decl: string): boolean {
  const n = normalizarParaChecar(decl);
  if (/expression\(|javascript:|vbscript:|livescript:|behavior:|-moz-binding|@import|<\/?style/.test(n)) return true;
  for (const m of n.matchAll(URL_CSS)) if (!urlCssPermitida(m[1])) return true;
  return false;
}

/** Divide no separador `sep` fora de aspas, parênteses e chaves. */
function dividirNoTopo(s: string, sep: string): string[] {
  const partes: string[] = [];
  let atual = "";
  let profundidade = 0;
  let aspas: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (aspas) {
      atual += ch;
      if (ch === "\\" && i + 1 < s.length) atual += s[++i];
      else if (ch === aspas) aspas = null;
      continue;
    }
    if (ch === '"' || ch === "'") aspas = ch;
    else if (ch === "(" || ch === "{" || ch === "[") profundidade++;
    else if (ch === ")" || ch === "}" || ch === "]") profundidade = Math.max(0, profundidade - 1);
    else if (ch === sep && profundidade === 0) {
      partes.push(atual);
      atual = "";
      continue;
    }
    atual += ch;
  }
  partes.push(atual);
  return partes;
}

/** Lista de declarações (`a: b; c: d`) sem as perigosas, aparadas e unidas por `;`. */
function limparDeclaracoes(corpo: string): string {
  return dividirNoTopo(corpo, ";")
    .map((d) => d.trim())
    .filter((d) => d && d.includes(":") && !declaracaoPerigosa(d))
    .join(";");
}

/** `style="..."` inline: mesma regra das declarações do CSS. */
function limparEstiloInline(estilo: string): string {
  return limparDeclaracoes(estilo.replace(/\/\*[\s\S]*?\*\//g, ""));
}

// CSS: folha inteira -----------------------------------------------------------------------------------------------

/** Lê `prelúdio { corpo }` / `prelúdio;` a partir de `i`, respeitando aspas e chaves aninhadas. */
function proximaRegra(css: string, i: number): { preludio: string; corpo: string | null; fim: number } | null {
  while (i < css.length && /\s/.test(css[i])) i++;
  if (i >= css.length) return null;
  let aspas: string | null = null;
  let parenteses = 0;
  let j = i;
  for (; j < css.length; j++) {
    const ch = css[j];
    if (aspas) {
      if (ch === "\\") j++;
      else if (ch === aspas) aspas = null;
      continue;
    }
    if (ch === '"' || ch === "'") aspas = ch;
    else if (ch === "(") parenteses++;
    else if (ch === ")") parenteses = Math.max(0, parenteses - 1);
    else if (parenteses === 0 && (ch === "{" || ch === ";" || ch === "}")) break;
  }
  const preludio = css.slice(i, j).trim();
  if (j >= css.length || css[j] === ";" || css[j] === "}") return { preludio, corpo: null, fim: j + 1 };
  // Bloco: acha a chave que fecha.
  let nivel = 1;
  let k = j + 1;
  aspas = null;
  for (; k < css.length && nivel > 0; k++) {
    const ch = css[k];
    if (aspas) {
      if (ch === "\\") k++;
      else if (ch === aspas) aspas = null;
      continue;
    }
    if (ch === '"' || ch === "'") aspas = ch;
    else if (ch === "{") nivel++;
    else if (ch === "}") nivel--;
  }
  const corpo = css.slice(j + 1, nivel === 0 ? k - 1 : k);
  return { preludio, corpo, fim: k };
}

function escoparSeletor(sel: string): string {
  const s = sel.trim();
  if (!s) return "";
  // Já escopado (CSS salvo pelo editor passa por aqui de novo na sala): não escopa duas vezes.
  if (/^\.vw-pagina(?![\w-])/.test(s)) return s;
  const raiz = /^(html|body|:root)(?![\w-])/i.exec(s);
  if (raiz) return `.${ESCOPO_PAGINA}${s.slice(raiz[0].length)}`.replace(/^(\.vw-pagina)\s+(html|body)(?![\w-])/i, "$1");
  return `.${ESCOPO_PAGINA} ${s}`;
}

const AT_COM_REGRAS = new Set(["media", "supports", "container", "layer"]);
const AT_DECLARACOES = new Set(["font-face", "page", "property", "counter-style"]);
const AT_KEYFRAMES = /^(-webkit-|-moz-)?keyframes$/;

function processarRegras(css: string, escopar: boolean): string {
  let saida = "";
  let i = 0;
  for (let guarda = 0; guarda < 100000; guarda++) {
    const r = proximaRegra(css, i);
    if (!r) break;
    i = r.fim;
    if (r.corpo === null || !r.preludio) continue; // @import/@charset/@namespace e lixo solto caem aqui
    if (declaracaoPerigosa(r.preludio)) continue;
    if (r.preludio.startsWith("@")) {
      const nome = /^@([\w-]+)/.exec(r.preludio)?.[1]?.toLowerCase() ?? "";
      if (AT_COM_REGRAS.has(nome)) {
        const dentro = processarRegras(r.corpo, escopar);
        if (dentro) saida += `${r.preludio}{${dentro}}`;
      } else if (AT_KEYFRAMES.test(nome)) {
        const dentro = processarRegras(r.corpo, false);
        if (dentro) saida += `${r.preludio}{${dentro}}`;
      } else if (AT_DECLARACOES.has(nome)) {
        const decl = limparDeclaracoes(r.corpo);
        if (decl) saida += `${r.preludio}{${decl}}`;
      }
      continue; // at-rule desconhecida: descarta
    }
    const decl = limparDeclaracoes(r.corpo);
    if (!decl) continue;
    const seletor = escopar
      ? dividirNoTopo(r.preludio, ",").map(escoparSeletor).filter(Boolean).join(",")
      : dividirNoTopo(r.preludio, ",").map((s) => s.trim()).filter(Boolean).join(",");
    if (seletor) saida += `${seletor}{${decl}}`;
  }
  return saida;
}

/** CSS do usuário pronto para ir num `<style>` da sala: sem comentários, sem `@import`/`@charset`/`@namespace`, sem
 *  at-rule desconhecida, sem declarações perigosas (ver `declaracaoPerigosa`), com `<` escapado (nunca fecha o
 *  `<style>`) e com todo seletor escopado em `.vw-pagina` (`html`/`body`/`:root` viram o próprio contêiner; dentro
 *  de `@media`/`@supports` também; `@keyframes`/`@font-face` ficam sem escopo). Nunca lança: CSS quebrado sai pela
 *  metade ou vazio. Idempotente (seletor que já começa em `.vw-pagina` fica como está). */
export function limparCssPagina(css: string): string {
  const semComentarios = (css ?? "").replace(/\/\*[\s\S]*?(\*\/|$)/g, "");
  return processarRegras(semComentarios, true).replace(/</g, "\\3c ");
}

// HTML ---------------------------------------------------------------------------------------------------------------

const HOSTS_IFRAME = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
  "iframe.mediadelivery.net",
  "player.mediadelivery.net",
];

const OPCOES_HTML: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span", "section", "header", "footer", "main", "article", "aside",
    "nav", "br", "hr", "strong", "b", "em", "i", "u", "s", "small", "mark", "sub", "sup", "blockquote", "pre", "code",
    "ul", "ol", "li", "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "caption", "button", "label", "iframe", "video",
  ],
  allowedAttributes: {
    "*": ["class", "id", "style", "title"],
    div: ["data-vw"],
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height", "loading"],
    iframe: ["src", "width", "height", "allow", "allowfullscreen", "frameborder", "loading"],
    video: ["src", "poster", "controls", "autoplay", "muted", "loop", "playsinline", "width", "height"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"], iframe: ["https"], video: ["http", "https"] },
  allowProtocolRelative: false,
  allowedIframeHostnames: HOSTS_IFRAME,
  allowIframeRelativeUrls: false,
  disallowedTagsMode: "discard",
  // Conteúdo destes some junto com a tag (o padrão só cobre script/style/textarea/option).
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "select", "svg", "math", "template", "object", "iframe"],
  transformTags: {
    div: (tagName, attribs) => {
      const vw = attribs["data-vw"];
      if (vw === undefined) return { tagName, attribs };
      if (ehBloco(vw)) return { tagName, attribs: { "data-vw": vw } };
      const { "data-vw": _descartado, ...resto } = attribs;
      return { tagName, attribs: resto };
    },
    a: (tagName, attribs) =>
      attribs.target === "_blank" ? { tagName, attribs: { ...attribs, rel: "noopener noreferrer" } } : { tagName, attribs },
    img: (tagName, attribs) => {
      const src = (attribs.src ?? "").trim();
      if (/^data:/i.test(src) && !DATA_IMAGEM.test(src.toLowerCase())) {
        const { src: _descartado, ...resto } = attribs;
        return { tagName, attribs: resto };
      }
      return { tagName, attribs };
    },
    "*": (tagName, attribs) => {
      if (attribs.style === undefined) return { tagName, attribs };
      const estilo = limparEstiloInline(attribs.style);
      const { style: _antigo, ...resto } = attribs;
      return { tagName, attribs: estilo ? { ...resto, style: estilo } : resto };
    },
  },
  // Iframe sem `src` aceito (host fora da lista, http, javascript:) é descartado inteiro.
  exclusiveFilter: (frame) => frame.tag === "iframe" && !frame.attribs.src,
};

const VAZIOS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
const ABRE_MARCADOR = /^<div data-vw="([a-z-]+)">$/;

/** Esvazia os marcadores na saída do sanitize-html. A saída dele é bem formada e escapa `<`/`>`/`"` em texto e
 *  atributos (`<` e `>` só aparecem como delimitadores de tag), e o marcador já sai como `<div data-vw="x">` sem
 *  outros atributos (ver `transformTags.div`), então basta contar a profundidade das tags até o `</div>` que fecha
 *  o marcador e jogar fora tudo que está dentro (inclusive outros marcadores). */
function esvaziarMarcadores(html: string): string {
  let saida = "";
  let ultimo = 0;
  let dentro = 0; // > 0: dentro de um marcador, na profundidade indicada
  for (const m of html.matchAll(TAG)) {
    const [tag, fecha, nome, resto] = m;
    const inicio = m.index ?? 0;
    if (dentro === 0) {
      if (!fecha && ABRE_MARCADOR.test(tag)) {
        saida += html.slice(ultimo, inicio) + tag;
        dentro = 1;
        ultimo = inicio + tag.length;
      }
      continue;
    }
    const nomeMin = nome.toLowerCase();
    if (VAZIOS.has(nomeMin) || resto.trimEnd().endsWith("/")) continue;
    dentro += fecha ? -1 : 1;
    if (dentro === 0) {
      saida += "</div>";
      ultimo = inicio + tag.length;
    }
  }
  return saida + (dentro === 0 ? html.slice(ultimo) : "</div>");
}

/** HTML publicado pelo editor → HTML seguro para a sala. Lista branca de tags/atributos: sem `script`, `style`,
 *  `form`/`input`/`select`/`textarea`, `object`/`embed`, `svg`, atributos `on*`; links só `http(s)`/`mailto`/
 *  relativos/`#`; imagem `http(s)` ou `data:image/(png|jpeg|gif|webp)`; `iframe` só https de YouTube, Vimeo e Bunny;
 *  `style` inline sem declarações perigosas. Mantém `class`, `id`, `style`, `title` e os marcadores
 *  `<div data-vw="bloco">`, que saem sempre vazios e sem outros atributos (o conteúdo de prévia do editor some).
 *  Idempotente. */
export function limparHtmlPagina(html: string): string {
  return esvaziarMarcadores(sanitizeHtml(html ?? "", OPCOES_HTML)).trim();
}

export type ParteDaPagina = { tipo: "html"; html: string } | { tipo: "bloco"; bloco: BlocoVw };

const MARCADOR = /<div data-vw="([a-z-]+)"><\/div>/g;

/** Quebra a página nos blocos dinâmicos, na ordem do documento, em qualquer nível de aninhamento.
 *
 *  Abordagem: limpa primeiro (`limparHtmlPagina`) e procura só a forma canônica que a limpeza produz,
 *  `<div data-vw="bloco"></div>` (vazio, sem outros atributos), com uma expressão regular. Como a entrada já passou
 *  pela lista branca, as partes `html` são seguras para injetar; e como o regex só casa a forma canônica, nada que
 *  venha do usuário (texto, atributo, comentário) consegue se passar por marcador.
 *
 *  As partes `html` são pedaços contíguos de UM documento: quando o bloco está aninhado, a parte antes dele tem
 *  tags abertas e a parte depois tem os fechamentos (ex.: `<section><div>` · bloco · `</div></section>`). Quem
 *  renderiza precisa juntar as partes numa string só (trocando cada bloco pelo seu HTML/ponto de montagem) em vez de
 *  pôr cada parte num elemento separado. Partes `html` só com espaço em branco são omitidas. */
export function partesDaPagina(html: string): ParteDaPagina[] {
  const limpo = limparHtmlPagina(html);
  const partes: ParteDaPagina[] = [];
  const empurrarHtml = (trecho: string) => {
    if (trecho.trim()) partes.push({ tipo: "html", html: trecho });
  };
  let ultimo = 0;
  for (const m of limpo.matchAll(MARCADOR)) {
    const inicio = m.index ?? 0;
    empurrarHtml(limpo.slice(ultimo, inicio));
    if (ehBloco(m[1])) partes.push({ tipo: "bloco", bloco: m[1] });
    ultimo = inicio + m[0].length;
  }
  empurrarHtml(limpo.slice(ultimo));
  return partes;
}

/** A página (depois de limpa) tem o bloco `formulario`. */
export function temFormulario(html: string): boolean {
  return partesDaPagina(html).some((p) => p.tipo === "bloco" && p.bloco === "formulario");
}
