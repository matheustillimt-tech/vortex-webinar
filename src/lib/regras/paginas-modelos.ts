import type { ModeloPagina, TipoPagina } from "./paginas";

// Modelos de partida do editor de páginas. Cada um traz o HTML/CSS iniciais (o que a sala mostra se a página for
// salva sem mexer) e o mesmo conteúdo como projeto do GrapesJS, no formato aceito por `editor.loadProjectData`
// (`{ pages: [{ component: <html> }], styles: <css> }`: o GrapesJS monta a árvore de componentes a partir do HTML).
// Visual escuro, coerente com a sala (fundo preto, texto branco, cartões translúcidos). Os blocos dinâmicos são os
// marcadores `<div data-vw="..."></div>` (ver BLOCOS_VW em ./paginas). O HTML não tem espaço entre tags e não usa
// `style` inline, então passa por `limparHtmlPagina` sem mudar.

export type ProjetoGrapes = { pages: { component: string }[]; styles: string };

export type ModeloDePagina = {
  id: ModeloPagina;
  tipo: TipoPagina;
  nome: string;
  descricao: string;
  html: string;
  css: string;
  projeto: ProjetoGrapes;
};

const vw = (bloco: string) => `<div data-vw="${bloco}"></div>`;

const CSS_BASE = [
  "*{box-sizing:border-box}",
  "body{margin:0;background:#000;color:#fff;font-family:Inter,system-ui,-apple-system,sans-serif;line-height:1.5}",
  ".vw-container{max-width:1080px;margin:0 auto;padding:48px 20px}",
  ".vw-topo{display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px}",
  ".vw-selo{display:inline-block;padding:6px 14px;border:1px solid rgba(255,255,255,.15);border-radius:999px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.7)}",
  ".vw-titulo{font-size:40px;font-weight:800;line-height:1.15;margin:0}",
  ".vw-texto{font-size:18px;color:rgba(255,255,255,.7);margin:0;max-width:640px}",
  ".vw-apresentador{display:flex;align-items:center;gap:12px;color:rgba(255,255,255,.8)}",
  ".vw-cartao{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:28px}",
  ".vw-botao{display:inline-block;padding:16px 32px;border-radius:12px;background:#16a34a;color:#fff;font-weight:700;font-size:18px;text-decoration:none}",
  ".vw-rodape{padding:32px 20px;text-align:center;font-size:13px;color:rgba(255,255,255,.4);border-top:1px solid rgba(255,255,255,.1)}",
  "@media (max-width: 768px){.vw-titulo{font-size:30px}.vw-container{padding:32px 16px}}",
].join("");

const RODAPE = '<footer class="vw-rodape"><p>Todos os direitos reservados.</p></footer>';

const APRESENTADOR = `<div class="vw-apresentador">${vw("foto-apresentador")}${vw("apresentador")}</div>`;

const REGISTRO_BOTAO_HTML = [
  '<main class="vw-pagina-modelo">',
  '<section class="vw-container vw-topo">',
  '<span class="vw-selo">Aula gratuita e online</span>',
  `<h1 class="vw-titulo">${vw("titulo")}</h1>`,
  '<p class="vw-texto">Descreva aqui o que a pessoa vai aprender na aula e por que ela não pode perder.</p>',
  APRESENTADOR,
  vw("vagas"),
  '<a class="vw-botao" href="#inscricao">Quero garantir minha vaga</a>',
  "</section>",
  '<section id="inscricao" class="vw-container">',
  '<div class="vw-cartao vw-inscricao">',
  '<h2 class="vw-subtitulo">Escolha o melhor horário</h2>',
  vw("formulario"),
  "</div>",
  "</section>",
  "</main>",
  RODAPE,
].join("");

const REGISTRO_BOTAO_CSS =
  CSS_BASE +
  ".vw-inscricao{max-width:520px;margin:0 auto}" +
  ".vw-subtitulo{font-size:22px;font-weight:700;margin:0 0 16px;text-align:center}";

const REGISTRO_FORM_HTML = [
  '<main class="vw-pagina-modelo">',
  '<section class="vw-container vw-colunas">',
  '<div class="vw-coluna-texto">',
  '<span class="vw-selo">Aula gratuita e online</span>',
  `<h1 class="vw-titulo">${vw("titulo")}</h1>`,
  '<p class="vw-texto">Descreva aqui o que a pessoa vai aprender na aula e por que ela não pode perder.</p>',
  APRESENTADOR,
  vw("vagas"),
  "</div>",
  '<div class="vw-cartao vw-coluna-form">',
  '<h2 class="vw-subtitulo">Garanta sua vaga</h2>',
  vw("formulario"),
  "</div>",
  "</section>",
  "</main>",
  RODAPE,
].join("");

const REGISTRO_FORM_CSS =
  CSS_BASE +
  ".vw-colunas{display:grid;grid-template-columns:1.2fr 1fr;gap:40px;align-items:center}" +
  ".vw-coluna-texto{display:flex;flex-direction:column;gap:16px;align-items:flex-start}" +
  ".vw-subtitulo{font-size:22px;font-weight:700;margin:0 0 16px}" +
  "@media (max-width: 768px){.vw-colunas{grid-template-columns:1fr}}";

const espera = (selo: string, aviso: string) =>
  [
    '<main class="vw-pagina-modelo">',
    '<section class="vw-container vw-topo">',
    `<span class="vw-selo">${selo}</span>`,
    `<h1 class="vw-titulo">${vw("titulo")}</h1>`,
    APRESENTADOR,
    '<div class="vw-cartao vw-espera">',
    '<p class="vw-rotulo">A aula começa em</p>',
    vw("contagem"),
    vw("data-sessao"),
    "</div>",
    `<p class="vw-texto">${aviso}</p>`,
    "</section>",
    "</main>",
    RODAPE,
  ].join("");

const ESPERA_CSS =
  CSS_BASE +
  ".vw-espera{display:flex;flex-direction:column;align-items:center;gap:12px;min-width:min(100%,480px)}" +
  ".vw-rotulo{margin:0;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.6)}";

function modelo(m: Omit<ModeloDePagina, "projeto">): ModeloDePagina {
  return { ...m, projeto: { pages: [{ component: m.html }], styles: m.css } };
}

export const MODELOS_PAGINA: readonly ModeloDePagina[] = [
  modelo({
    id: "registro_botao",
    tipo: "registro_jit",
    nome: "Registro: botão + formulário",
    descricao: "Apresentação da aula com um botão que leva ao formulário de inscrição.",
    html: REGISTRO_BOTAO_HTML,
    css: REGISTRO_BOTAO_CSS,
  }),
  modelo({
    id: "registro_form",
    tipo: "registro_jit",
    nome: "Registro: formulário fixo",
    descricao: "Texto da aula de um lado e o formulário de inscrição sempre visível do outro.",
    html: REGISTRO_FORM_HTML,
    css: REGISTRO_FORM_CSS,
  }),
  modelo({
    id: "espera_jit",
    tipo: "espera_jit",
    nome: "Espera (just in time)",
    descricao: "Contagem até o horário escolhido; a sala abre sozinha na hora.",
    html: espera("Inscrição confirmada", "Deixe esta página aberta: a sala abre sozinha na hora marcada."),
    css: ESPERA_CSS,
  }),
  modelo({
    id: "espera_unica",
    tipo: "espera_unica",
    nome: "Espera (sessão única)",
    descricao: "Contagem até o início da sessão; a sala abre sozinha na hora.",
    html: espera("Aula ao vivo", "Fique por perto: quando a aula começar, esta página leva você direto para a sala."),
    css: ESPERA_CSS,
  }),
];

export function modeloPagina(id: string): ModeloDePagina | undefined {
  return MODELOS_PAGINA.find((m) => m.id === id);
}
