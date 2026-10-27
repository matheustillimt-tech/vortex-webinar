// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";

vi.mock("@/app/s/[slug]/lp/actions", () => ({ inscrever: async () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { default: MontadorPagina } = await import("@/app/s/_paginas/montador");
const { CSS_BASE } = await import("@/app/s/_paginas/pagina-do-editor");
const { montarPagina } = await import("@/src/lib/sala/pagina-montagem");
const { MODELOS_PAGINA } = await import("@/src/lib/regras/paginas-modelos");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TELA = {
  placeholderNome: "Nome",
  placeholderEmail: "E-mail",
  placeholderTelefone: "WhatsApp",
  pedeEmail: true,
  emailObrigatorio: true,
  pedeTelefone: false,
  telefoneObrigatorio: false,
  botaoCor: "#16a34a",
  botaoCorTexto: "#fff",
} as never;
const OPCOES = ["2026-11-20T23:00:00.000Z", "2026-11-21T23:00:00.000Z"];
const P = {
  slug: "aulao",
  idioma: "pt-BR" as const,
  tela: TELA,
  horarios: [],
  config: { fuso: "America/Sao_Paulo", esconderDe: null, esconderAte: null, exibicao: "todos", fim: null } as never,
  iniciais: OPCOES,
  agoraServidor: Date.parse("2026-11-20T12:00:00.000Z"),
  utms: {},
  teste: null,
};

const ESTATICOS = {
  idioma: "pt-BR" as const,
  titulo: "Aula de teste",
  apresentador: "Apresentador Teste",
  fotoUrl: "https://cdn.exemplo.com/foto.jpg",
};

/** O que o navegador faz com o HTML: se o parser reorganiza algo (`<h1>` dentro de `<h1>`, `<div>` dentro de `<p>`),
 *  o DOM serializado deixa de ser igual à string do servidor. */
function reparsear(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.innerHTML;
}

const ANINHAMENTO_INVALIDO = ":is(h1,h2,h3,h4,h5,h6,p) :is(h1,h2,h3,h4,h5,h6,p,div,section,ul,ol,form,table)";

describe("montagem gera HTML válido (o navegador não reorganiza)", () => {
  // As páginas salvas no banco têm o HTML dos modelos como estava: `<h1 class="vw-titulo"><div data-vw="titulo">`.
  const casos = MODELOS_PAGINA.map((m) => ({
    nome: m.id,
    html: m.html,
    lugar: m.tipo === "registro_jit" ? ("registro" as const) : ("espera" as const),
  }));

  for (const c of casos) {
    for (const dataSessao of [null, "quinta-feira, 20/11 às 20:00"]) {
      it(`${c.nome} (data ${dataSessao ? "pronta" : "no cliente"})`, () => {
        const r = montarPagina({ html: c.html, css: "", config: {} }, { ...ESTATICOS, lugar: c.lugar, dataSessao })!;
        expect(r).not.toBeNull();
        expect(reparsear(r.html)).toBe(r.html);
        const d = document.createElement("div");
        d.innerHTML = r.html;
        expect(d.querySelector(ANINHAMENTO_INVALIDO)).toBeNull();
        expect(d.querySelectorAll("h1")).toHaveLength(1);
        expect(d.querySelector("h1.vw-titulo > span.vw-bloco.vw-titulo")?.textContent).toBe("Aula de teste");
        for (const el of d.querySelectorAll(".vw-bloco")) expect(["SPAN", "IMG"]).toContain(el.tagName);
      });
    }
  }

  it("blocos dentro de título/parágrafo (HTML do usuário): estáticos e pontos de montagem ficam lá dentro, válidos", () => {
    const r = montarPagina(
      {
        html:
          '<h2>Com <div data-vw="apresentador"></div> em <div data-vw="data-sessao"></div></h2>' +
          '<h3><div data-vw="formulario"></div></h3><p>Antes <div data-vw="vagas"></div> depois</p>',
        css: "",
        config: {},
      },
      { ...ESTATICOS, lugar: "registro", dataSessao: null },
    )!;
    expect(reparsear(r.html)).toBe(r.html);
    const d = document.createElement("div");
    d.innerHTML = r.html;
    expect(d.querySelector(ANINHAMENTO_INVALIDO)).toBeNull();
    expect(d.querySelector('h3 > span[data-vw-montar="formulario"]')).not.toBeNull();
    expect(d.querySelector('h2 > span[data-vw-montar="data-sessao"]')).not.toBeNull();
    expect(d.querySelector("h2 > span.vw-apresentador")?.textContent).toBe("Apresentador Teste");
    expect(d.querySelector(".vw-vagas .vw-vagas-barra")).not.toBeNull();
  });

  it("CSS base: blocos e pontos (span) viram bloco; título solto é grande e herda dentro de h1/p", () => {
    expect(CSS_BASE).toContain(":where(.vw-pagina) .vw-bloco,");
    expect(CSS_BASE).toMatch(/\.vw-vagas-texto\{display:block\}/);
    expect(CSS_BASE).toContain(".vw-bloco:where(.vw-titulo){font-size:2em");
    expect(CSS_BASE).toContain(":where(h1,h2,h3,h4,h5,h6,p)>.vw-bloco{font-size:inherit");
  });
});

describe("MontadorPagina hidratado", () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("monta o formulário no ponto que está NO documento, e ele continua lá depois de novos renders", async () => {
    const modelo = MODELOS_PAGINA.find((m) => m.id === "registro_form")!;
    const r = montarPagina({ html: modelo.html, css: "", config: {} }, { ...ESTATICOS, lugar: "registro", dataSessao: null })!;
    const props = (inscricao = P) => ({ html: r.html, blocos: { lugar: "registro" as const, inscricao, mostrarHorarios: true } });

    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(MontadorPagina, props()));
    document.body.appendChild(container);
    const pontoServidor = container.querySelector('[data-vw-montar="formulario"]')!;
    expect(pontoServidor).not.toBeNull();
    expect(pontoServidor.childNodes).toHaveLength(0);

    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root = hydrateRoot(container, createElement(MontadorPagina, props()));
    });

    const ponto = () => document.querySelector('[data-vw-montar="formulario"]')!;
    // O nó do servidor não foi recriado: o innerHTML não é reescrito quando o `setPontos` re-renderiza.
    expect(ponto()).toBe(pontoServidor);
    expect(ponto().querySelector("form")).not.toBeNull();
    expect(ponto().querySelector('input[type="submit"], button[type="submit"]')).not.toBeNull();

    // Novo render do pai (props novas, mesmo HTML): o formulário continua no documento.
    await act(async () => {
      root!.render(createElement(MontadorPagina, props({ ...P })));
    });
    expect(ponto()).toBe(pontoServidor);
    expect(ponto().querySelector("form")?.isConnected).toBe(true);
    expect(erros.mock.calls.filter((c) => /hydrat/i.test(String(c[0])))).toEqual([]);
    erros.mockRestore();
  });

  it("passa o MESMO objeto dangerouslySetInnerHTML entre renders (o React do Next reescreve o innerHTML se mudar)", async () => {
    // O React 19.3 do node_modules (usado aqui) compara o `__html`; o embutido no Next 15 (19.2 canary) compara o
    // objeto e reescreve o `innerHTML`, que foi o bug. Confere a prop que o React guardou no nó a cada commit.
    const html = '<section><span data-vw-montar="formulario"></span></section>';
    const props = (inscricao = P) => ({ html, blocos: { lugar: "registro" as const, inscricao, mostrarHorarios: true } });
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(MontadorPagina, props()));
    document.body.appendChild(container);
    await act(async () => {
      root = hydrateRoot(container, createElement(MontadorPagina, props()));
    });
    const div = container.querySelector(".vw-pagina")!;
    const chave = Object.keys(div).find((k) => k.startsWith("__reactProps"))!;
    const atual = () => (div as unknown as Record<string, { dangerouslySetInnerHTML: unknown }>)[chave].dangerouslySetInnerHTML;
    const antes = atual();
    await act(async () => {
      root!.render(createElement(MontadorPagina, props({ ...P })));
    });
    expect(atual()).toBe(antes);
  });

  it("se o conteúdo do contêiner for trocado por fora, procura os pontos de novo e remonta o formulário", async () => {
    const html = '<section><span data-vw-montar="formulario"></span></section>';
    const props = { html, blocos: { lugar: "registro" as const, inscricao: P, mostrarHorarios: true } };
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(MontadorPagina, props));
    document.body.appendChild(container);
    await act(async () => {
      root = hydrateRoot(container, createElement(MontadorPagina, props));
    });
    expect(container.querySelector("[data-vw-montar] form")).not.toBeNull();
    await act(async () => {
      container.querySelector(".vw-pagina")!.innerHTML = html; // o que o React do Next fazia
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector("[data-vw-montar] form")?.isConnected).toBe(true);
  });
});
