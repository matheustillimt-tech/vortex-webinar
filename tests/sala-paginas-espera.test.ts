import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// O atualizador não desenha nada: aqui ele vira um marcador para o teste ver se foi montado.
vi.mock("@/app/s/[slug]/espera/contagem", () => ({
  default: () => null,
  AtualizadorEspera: ({ inicioMs }: { inicioMs: number }) => createElement("i", { "data-atualizador": String(inicioMs) }),
}));

const { default: PaginaDoEditor } = await import("@/app/s/_paginas/pagina-do-editor");
const { montarPagina, precisaAtualizadorEspera } = await import("@/src/lib/sala/pagina-montagem");

const E = { lugar: "espera" as const, idioma: "pt-BR" as const, titulo: "T", apresentador: null, fotoUrl: null, dataSessao: "hoje" };
const blocos = { lugar: "espera" as const, idioma: "pt-BR" as const, inicioMs: 123, agoraServidor: 0, dataSessao: null };

describe("página de espera do editor abre a sala na hora", () => {
  it("precisaAtualizadorEspera: só na espera e só sem o bloco contagem", () => {
    expect(precisaAtualizadorEspera("espera", ["data-sessao"])).toBe(true);
    expect(precisaAtualizadorEspera("espera", ["contagem"])).toBe(false);
    expect(precisaAtualizadorEspera("registro", ["formulario"])).toBe(false);
  });

  it("sem o bloco contagem: monta o atualizador invisível", () => {
    const montada = montarPagina({ html: "<h1>Já já começa</h1>", css: "", config: {} }, E)!;
    expect(renderToStaticMarkup(createElement(PaginaDoEditor, { montada, blocos }))).toContain('data-atualizador="123"');
  });

  it("com o bloco contagem: a própria contagem atualiza (sem atualizador repetido)", () => {
    const montada = montarPagina({ html: '<h1>Já já</h1><div data-vw="contagem"></div>', css: "", config: {} }, E)!;
    expect(renderToStaticMarkup(createElement(PaginaDoEditor, { montada, blocos }))).not.toContain("data-atualizador");
  });
});
