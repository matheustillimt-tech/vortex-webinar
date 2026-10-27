import type { Metadata } from "next";
import { limparCssPagina, partesDaPagina, type BlocoVw } from "../regras/paginas";
import { configDeLinha, type ConfigPagina, type FontePagina } from "../regras/paginas-editor";
import { t, type Idioma } from "../regras/textos-sala";

// Página do editor na sala: o HTML vira UMA string (os pedaços de `partesDaPagina` podem ter tags abertas de um lado
// do bloco e fechadas do outro), com os blocos estáticos já prontos e escapados e os dinâmicos trocados por pontos
// de montagem `<span data-vw-montar="bloco">`, onde o cliente monta os componentes React com `createPortal`.
//
// Tudo o que a montagem insere é `<span>` (os blocos estáticos e os pontos de montagem; o CSS base da sala põe
// `display:block` neles): o marcador `<div data-vw>` costuma ficar dentro de `<h1>`/`<p>` (o próprio modelo tem
// `<h1 class="vw-titulo"><div data-vw="titulo"></div></h1>`, e as páginas já salvas continuam assim). `<h1>` dentro
// de `<h1>`, ou `<p>`/`<div>` dentro de `<p>`, é HTML inválido: o navegador reorganiza o DOM (fecha o `<h1>`/`<p>` de
// fora) e a página deixa de ser o que o servidor mandou. `<span>` é válido em qualquer contêiner.

/** Onde a página entra: `/lp` (registro do JIT) ou `/espera`. */
export type LugarPagina = "registro" | "espera";

/** Percentual fixo da barra de vagas (não há configuração por página). */
export const VAGAS_PAGINA = 87;

export type EstaticosPagina = {
  lugar: LugarPagina;
  idioma: Idioma;
  /** Título do webinar (ou o nome, se não houver título). */
  titulo: string | null;
  apresentador: string | null;
  fotoUrl: string | null;
  /** Data por extenso já pronta (sessão única/recorrente). `null` = calculada no cliente (JIT, por causa do fuso). */
  dataSessao: string | null;
};

export type PaginaMontada = {
  /** HTML limpo, com os blocos estáticos e os pontos de montagem. */
  html: string;
  /** CSS limpo, escopado em `.vw-pagina`. */
  css: string;
  fonte: FontePagina;
  config: ConfigPagina;
  /** Blocos dinâmicos presentes (sem repetição, na ordem em que aparecem). */
  montar: BlocoVw[];
};

export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ponto = (bloco: BlocoVw) => `<span data-vw-montar="${bloco}" class="vw-bloco vw-${bloco}"></span>`;

function urlSegura(u: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** HTML de um bloco, ou `null` quando é dinâmico (vira ponto de montagem). String vazia = o bloco some. */
function htmlDoBloco(bloco: BlocoVw, e: EstaticosPagina): string | null {
  switch (bloco) {
    case "titulo":
      return e.titulo ? `<span class="vw-bloco vw-titulo">${escaparHtml(e.titulo)}</span>` : "";
    case "apresentador":
      return e.apresentador ? `<span class="vw-bloco vw-apresentador">${escaparHtml(e.apresentador)}</span>` : "";
    case "foto-apresentador": {
      const src = urlSegura(e.fotoUrl);
      return src
        ? `<img class="vw-bloco vw-foto-apresentador" src="${escaparHtml(src)}" alt="${escaparHtml(e.apresentador ?? "")}">`
        : "";
    }
    case "data-sessao":
      return e.dataSessao === null ? null : `<span class="vw-bloco vw-data-sessao">${escaparHtml(e.dataSessao)}</span>`;
    case "vagas":
      return (
        `<span class="vw-bloco vw-vagas"><span class="vw-vagas-trilho">` +
        `<span class="vw-vagas-barra" style="width:${VAGAS_PAGINA}%"></span></span>` +
        `<span class="vw-vagas-texto">${escaparHtml(t(e.idioma, "vagas", { n: VAGAS_PAGINA }))}</span></span>`
      );
    case "contagem":
      return null;
    case "formulario":
    case "horarios":
      return e.lugar === "registro" ? null : "";
  }
}

/** Página salva → HTML pronto para a sala. `null` (= fica a tela atual) quando não há página, quando ela fica vazia
 *  depois da limpeza ou quando é de registro e não tem o formulário. Limpa HTML e CSS de novo (as duas limpezas são
 *  idempotentes): o que vai para a sala nunca depende só do que está no banco. */
export function montarPagina(
  pagina: { html: string; css: string; config: unknown } | null,
  e: EstaticosPagina,
): PaginaMontada | null {
  if (!pagina) return null;
  const partes = partesDaPagina(pagina.html ?? "");
  if (partes.length === 0) return null;
  if (e.lugar === "registro" && !partes.some((p) => p.tipo === "bloco" && p.bloco === "formulario")) return null;

  const montar: BlocoVw[] = [];
  let html = "";
  for (const p of partes) {
    if (p.tipo === "html") {
      html += p.html;
      continue;
    }
    const pronto = htmlDoBloco(p.bloco, e);
    if (pronto !== null) {
      html += pronto;
      continue;
    }
    html += ponto(p.bloco);
    if (!montar.includes(p.bloco)) montar.push(p.bloco);
  }
  if (!html.trim()) return null;

  const config = configDeLinha(pagina.config);
  return { html: html.trim(), css: limparCssPagina(pagina.css ?? ""), fonte: config.fonte, config, montar };
}

/** O formulário só mostra a lista de horários quando a página não tem o bloco `horarios` (os dois compartilham o
 *  horário escolhido). */
export function formularioMostraHorarios(montar: readonly BlocoVw[]): boolean {
  return !montar.includes("horarios");
}

/** Página de espera sem o bloco `contagem`: a sala ainda precisa conferir (a cada 15 s e na hora do início) se a
 *  sessão abriu, como a contagem faz, senão a pessoa fica parada na espera. */
export function precisaAtualizadorEspera(lugar: LugarPagina, montar: readonly BlocoVw[]): boolean {
  return lugar === "espera" && !montar.includes("contagem");
}

/** Título/descrição dos Ajustes da página por cima dos metadados da sala (cada um só quando preenchido). */
export function metadadosDaPagina(base: Metadata, config: ConfigPagina | null): Metadata {
  if (!config) return base;
  const titulo = config.titulo.trim();
  const descricao = config.descricao.trim();
  if (!titulo && !descricao) return base;
  const og = (base.openGraph ?? {}) as NonNullable<Metadata["openGraph"]>;
  return {
    ...base,
    ...(titulo ? { title: titulo } : {}),
    ...(descricao ? { description: descricao } : {}),
    openGraph: { ...og, ...(titulo ? { title: titulo } : {}), ...(descricao ? { description: descricao } : {}) },
  };
}

/** Ajustes da página quando ela vai mesmo aparecer (mesma regra de `montarPagina`); `null` = fica a tela atual. */
export function configDaPaginaUsada(
  pagina: { html: string; css: string; config: unknown } | null,
  lugar: LugarPagina,
): ConfigPagina | null {
  return montarPagina(pagina, { lugar, idioma: "pt-BR", titulo: null, apresentador: null, fotoUrl: null, dataSessao: null })?.config ?? null;
}
