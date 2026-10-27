import type { BlocoVw, TipoPagina } from "./paginas";

// Regras do editor de páginas que o navegador também usa (sem `sanitize-html`, para não ir no pacote do cliente):
// rótulos e prévias dos blocos dinâmicos, Ajustes (`paginas.config`), fontes, vídeo incorporado e o documento da
// pré-visualização.

export const ROTULO_TIPO_PAGINA: Record<TipoPagina, string> = {
  registro_jit: "Página de registro - Just in time",
  espera_jit: "Página de espera - Just in time",
  espera_unica: "Página de espera - Webinar único",
};

/** Onde a página entra no webinar (aviso de exclusão e "Webinars vinculados"). */
export const ROTULO_LUGAR: Record<TipoPagina, string> = {
  registro_jit: "Página de registro (just in time)",
  espera_jit: "Página de espera (just in time)",
  espera_unica: "Página de espera (sessão única/recorrente)",
};

/** Rótulo de cada bloco dinâmico (`data-vw`), na ordem de `BLOCOS_VW`. */
export const ROTULO_BLOCO: Record<BlocoVw, string> = {
  titulo: "Título do webinar",
  apresentador: "Nome do apresentador",
  "foto-apresentador": "Foto do apresentador",
  "data-sessao": "Data da sessão",
  contagem: "Contagem regressiva",
  formulario: "Formulário de inscrição",
  horarios: "Lista de horários",
  vagas: "Barra de vagas",
};

/** Prévia estática (HTML fixo, sem dado do webinar) que o editor mostra dentro da caixa do bloco. Não é salva: o
 *  HTML publicado tem só o marcador vazio. */
export const PREVIA_BLOCO: Record<BlocoVw, string> = {
  titulo: "Título do webinar",
  apresentador: "Nome do apresentador",
  "foto-apresentador": "👤",
  "data-sessao": "Quinta, 20 de novembro, às 20h",
  contagem: "00 : 12 : 34 : 56",
  formulario: "Nome · E-mail · Telefone · [Quero participar]",
  horarios: "20h · 21h · 22h",
  vagas: "▰▰▰▰▰▰▰▱▱▱ 72% das vagas preenchidas",
};

export const FONTES_PAGINA = ["Inter", "Poppins", "Montserrat", "Roboto", "Open Sans"] as const;
export type FontePagina = (typeof FONTES_PAGINA)[number];

/** Google Fonts com as fontes do editor (pesos 400 a 800). */
export function urlFontes(fontes: readonly string[] = FONTES_PAGINA): string {
  const familias = fontes.map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700;800`).join("&");
  return `https://fonts.googleapis.com/css2?${familias}&display=swap`;
}

/** Ajustes da página (`paginas.config`). `css_personalizado` é o textarea "CSS personalizado": guardado como o
 *  usuário escreveu e somado (já limpo) ao CSS publicado no salvar. */
export type ConfigPagina = {
  cor_fundo: string;
  titulo: string;
  descricao: string;
  fonte: FontePagina;
  css_personalizado: string;
};

export const MAX_TITULO_ABA = 120;
export const MAX_DESCRICAO_PAGINA = 300;
export const MAX_CSS_PERSONALIZADO = 100 * 1024;
/** Teto do projeto do GrapesJS (`paginas.componentes`) em bytes de JSON. */
export const MAX_PROJETO_PAGINA = 1024 * 1024;

const COR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function configPadrao(titulo = ""): ConfigPagina {
  return { cor_fundo: "#000000", titulo: titulo.slice(0, MAX_TITULO_ABA), descricao: "", fonte: "Inter", css_personalizado: "" };
}

/** `paginas.config` do banco (pode vir vazio, `{}`, de outra versão) → Ajustes completos, com padrão no que faltar
 *  ou estiver fora da regra. */
export function configDeLinha(c: unknown): ConfigPagina {
  const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
  const p = configPadrao();
  const texto = (v: unknown, max: number, padrao: string) => (typeof v === "string" ? v.slice(0, max) : padrao);
  return {
    cor_fundo: typeof o.cor_fundo === "string" && COR.test(o.cor_fundo) ? o.cor_fundo : p.cor_fundo,
    titulo: texto(o.titulo, MAX_TITULO_ABA, p.titulo),
    descricao: texto(o.descricao, MAX_DESCRICAO_PAGINA, p.descricao),
    fonte: (FONTES_PAGINA as readonly string[]).includes(o.fonte as string) ? (o.fonte as FontePagina) : p.fonte,
    css_personalizado: typeof o.css_personalizado === "string" ? o.css_personalizado : "",
  };
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Ajustes vindos do editor (salvar). */
export function validarConfigPagina(c: unknown): { erro: string } | { dados: ConfigPagina } {
  const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const cor = str(o.cor_fundo).trim();
  if (!COR.test(cor)) return { erro: "Escolha uma cor de fundo válida (ex.: #000000)." };
  const titulo = str(o.titulo).trim();
  if (titulo.length > MAX_TITULO_ABA) return { erro: `Use até ${MAX_TITULO_ABA} caracteres no título da aba.` };
  const descricao = str(o.descricao).trim();
  if (descricao.length > MAX_DESCRICAO_PAGINA) return { erro: `Use até ${MAX_DESCRICAO_PAGINA} caracteres na descrição.` };
  const fonte = str(o.fonte);
  if (!(FONTES_PAGINA as readonly string[]).includes(fonte)) return { erro: "Escolha uma das fontes da lista." };
  const css = str(o.css_personalizado);
  if (bytes(css) > MAX_CSS_PERSONALIZADO) return { erro: "O CSS personalizado ficou grande demais (máximo de 100 KB)." };
  return { dados: { cor_fundo: cor, titulo, descricao, fonte: fonte as FontePagina, css_personalizado: css } };
}

/** CSS dos Ajustes (cor de fundo e fonte), somado depois do CSS do editor e antes do CSS personalizado. Escrito
 *  para `body`, que a limpeza troca pelo contêiner `.vw-pagina`. */
export function cssDosAjustes(c: Pick<ConfigPagina, "cor_fundo" | "fonte">): string {
  return `body{background-color:${c.cor_fundo};font-family:'${c.fonte}',system-ui,-apple-system,sans-serif}`;
}

/** CSS que vai para a limpeza no salvar: editor + Ajustes + personalizado. */
export function cssParaSalvar(cssEditor: string, c: ConfigPagina): string {
  return [cssEditor, cssDosAjustes(c), c.css_personalizado].filter((s) => s.trim()).join("\n");
}

// Vídeo -------------------------------------------------------------------------------------------------------------

/** Link de vídeo colado no bloco Vídeo → URL de incorporação (YouTube, Vimeo, Bunny Stream). `null` se não for de
 *  nenhum deles (a limpeza só aceita iframe desses hosts). */
export function urlEmbedVideo(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const partes = u.pathname.split("/").filter(Boolean);
  const idYt = /^[\w-]{6,20}$/;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    let id: string | null = null;
    if (partes[0] === "watch") id = u.searchParams.get("v");
    else if (["embed", "shorts", "live"].includes(partes[0])) id = partes[1] ?? null;
    return id && idYt.test(id) ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (host === "youtu.be") return partes[0] && idYt.test(partes[0]) ? `https://www.youtube.com/embed/${partes[0]}` : null;
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = partes.find((p) => /^\d+$/.test(p));
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  if (host === "iframe.mediadelivery.net" || host === "player.mediadelivery.net") {
    const [modo, biblioteca, video] = partes;
    if ((modo === "embed" || modo === "play") && /^\d+$/.test(biblioteca ?? "") && /^[0-9a-f-]{36}$/i.test(video ?? "")) {
      return `https://iframe.mediadelivery.net/embed/${biblioteca}/${video}`;
    }
  }
  return null;
}

// Pré-visualização ------------------------------------------------------------------------------------------------

const MARCADOR = /<div data-vw="([a-z-]+)"><\/div>/g;

function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CSS_PREVIA = [
  "html,body{margin:0}",
  ".vw-pagina{min-height:100vh}",
  ".vw-previa-bloco{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:10px 14px;margin:6px 0;",
  "border:1px dashed rgba(34,197,94,.7);border-radius:10px;background:rgba(34,197,94,.08);color:#86efac;",
  "font:600 13px/1.3 Inter,system-ui,sans-serif;text-align:center}",
  ".vw-previa-bloco small{font-weight:400;opacity:.75}",
].join("");

/** Documento HTML completo da pré-visualização: recebe o HTML e o CSS **já limpos** (`limparHtmlPagina` /
 *  `limparCssPagina`), troca cada marcador por uma caixa com o rótulo e a prévia do bloco e põe tudo no contêiner
 *  `.vw-pagina`. Vai num `<iframe sandbox>` (sem scripts). */
export function documentoDePrevia(htmlLimpo: string, cssLimpo: string, c: ConfigPagina): string {
  const corpo = htmlLimpo.replace(MARCADOR, (_, b: string) => {
    const bloco = b as BlocoVw;
    const rotulo = ROTULO_BLOCO[bloco];
    if (!rotulo) return "";
    return `<div class="vw-previa-bloco" data-vw-previa="${bloco}">${escaparHtml(rotulo)} <small>${escaparHtml(PREVIA_BLOCO[bloco])}</small></div>`;
  });
  return [
    "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\">",
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escaparHtml(c.titulo || "Pré-visualização")}</title>`,
    c.descricao ? `<meta name="description" content="${escaparHtml(c.descricao)}">` : "",
    `<link rel="stylesheet" href="${escaparHtml(urlFontes([c.fonte]))}">`,
    `<style>${CSS_PREVIA}${cssLimpo}</style>`,
    `</head><body><div class="vw-pagina">${corpo}</div></body></html>`,
  ].join("");
}
