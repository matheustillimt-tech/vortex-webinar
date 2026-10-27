import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/s/[slug]/lp/actions", () => ({ inscrever: async () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { CamposInscricao, ListaHorarios } = await import("@/app/s/[slug]/lp/inscricao");
const { default: PaginaDoEditor } = await import("@/app/s/_paginas/pagina-do-editor");
const { montarPagina, formularioMostraHorarios } = await import("@/src/lib/sala/pagina-montagem");

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
  agoraServidor: 0,
  utms: {},
  teste: null,
};
const H = {
  opcoes: OPCOES,
  escolhido: OPCOES[1],
  setEscolhido: () => {},
  fusoNavegador: "",
  entrarDireto: false,
  rotulo: (iso: string) => `rotulo ${iso}`,
  horarioEnviado: OPCOES[1],
};

const radios = (html: string) => (html.match(/type="radio"/g) ?? []).length;

describe("formulário + horários na página do editor", () => {
  it("sem o bloco horarios: o formulário traz a lista", () => {
    const html = renderToStaticMarkup(createElement(CamposInscricao, { p: P, h: H, mostrarHorarios: true }));
    expect(radios(html)).toBe(2);
    expect(html).toContain('name="horario"');
  });

  it("com o bloco horarios: a lista aparece uma vez só (no bloco) e o formulário manda o escolhido oculto", () => {
    const form = renderToStaticMarkup(createElement(CamposInscricao, { p: P, h: H, mostrarHorarios: false }));
    const lista = renderToStaticMarkup(createElement(ListaHorarios, { h: H, idioma: "pt-BR" }));
    expect(radios(form)).toBe(0);
    expect(form).toContain(`<input type="hidden" name="horario" value="${OPCOES[1]}"/>`);
    expect(radios(lista)).toBe(2);
    expect(lista).not.toContain('name="horario"');
  });
});

describe("PaginaDoEditor (servidor)", () => {
  it("contêiner .vw-pagina com min-height, CSS escopado no <style>, fonte e pontos de montagem", () => {
    const montada = montarPagina(
      { html: '<section><div data-vw="horarios"></div><div data-vw="formulario"></div></section>', css: "h1{color:red}", config: { fonte: "Poppins" } },
      { lugar: "registro", idioma: "pt-BR", titulo: "T", apresentador: null, fotoUrl: null, dataSessao: null },
    )!;
    const html = renderToStaticMarkup(
      createElement(PaginaDoEditor, {
        montada,
        blocos: { lugar: "registro", inscricao: P, mostrarHorarios: formularioMostraHorarios(montada.montar) },
      }),
    );
    expect(html).toContain('<div class="vw-pagina" style="min-height:100vh"><section><span data-vw-montar="horarios"');
    expect(html).toContain(".vw-pagina h1{color:red}");
    expect(html).toContain("family=Poppins");
  });
});

describe("blocos data-sessao e contagem da /lp (página do editor)", () => {
  it("mostram o horário escolhido (o mesmo que o formulário envia), não sempre o primeiro", async () => {
    const { CtxRegistro, BlocoRegistro, horarioDosBlocos } = await import("@/app/s/_paginas/montador");
    expect(horarioDosBlocos(H)).toBe(OPCOES[1]);
    expect(horarioDosBlocos({ opcoes: OPCOES, horarioEnviado: "" })).toBe(OPCOES[0]);
    expect(horarioDosBlocos({ opcoes: OPCOES, horarioEnviado: "2026-01-01T00:00:00.000Z" })).toBe(OPCOES[0]);
    expect(horarioDosBlocos({ opcoes: [], horarioEnviado: "" })).toBeNull();

    const bloco = (b: string, p = P) =>
      renderToStaticMarkup(
        createElement(CtxRegistro.Provider, { value: { p, h: H, mostrarHorarios: false } }, createElement(BlocoRegistro, { bloco: b })),
      );
    expect(bloco("data-sessao")).toContain(`rotulo ${OPCOES[1]}`);
    // Relógio do servidor no primeiro horário: até o escolhido (o segundo) falta 1 dia.
    const contagem = bloco("contagem", { ...P, agoraServidor: Date.parse(OPCOES[0]) });
    expect(contagem).toMatch(/^<div[^>]*><div[^>]*><span[^>]*>01<\/span>/);
  });
});
