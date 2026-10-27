import { describe, expect, it } from "vitest";
import { dataCurta, hrefCom, intervaloDaPagina, opcaoDe, ordemDe, paginaDe, textoDe, ultimaPagina } from "@/src/lib/regras/filtros-lista";

describe("filtros das listas", () => {
  it("lê texto, opção válida e ordem com padrão", () => {
    expect(textoDe({ busca: ["  oi ", "x"] }, "busca")).toBe("oi");
    expect(textoDe({}, "busca")).toBe("");
    expect(opcaoDe({ status: "arquivados" }, "status", ["todos", "arquivados"] as const, "todos")).toBe("arquivados");
    expect(opcaoDe({ status: "lixo" }, "status", ["todos", "arquivados"] as const, "todos")).toBe("todos");
    expect(ordemDe({})).toBe("recentes");
    expect(ordemDe({ ordem: "antigos" })).toBe("antigos");
  });

  it("página começa em 1 e ignora lixo", () => {
    expect(paginaDe({})).toBe(1);
    expect(paginaDe({ pagina: "3" })).toBe(3);
    expect(paginaDe({ pagina: "0" })).toBe(1);
    expect(paginaDe({ pagina: "-2" })).toBe(1);
    expect(paginaDe({ pagina: "abc" })).toBe(1);
    expect(paginaDe({ pagina: "2.7" })).toBe(2);
  });

  it("intervalo do range e última página", () => {
    expect(intervaloDaPagina(1)).toEqual({ desde: 0, ate: 9 });
    expect(intervaloDaPagina(3, 10)).toEqual({ desde: 20, ate: 29 });
    expect(intervaloDaPagina(2, 50)).toEqual({ desde: 50, ate: 99 });
    expect(ultimaPagina(0)).toBe(1);
    expect(ultimaPagina(10)).toBe(1);
    expect(ultimaPagina(11)).toBe(2);
  });

  it("monta o link trocando filtros e voltando para a página 1", () => {
    expect(hrefCom("/paginas", { tipo: "espera_jit", pagina: "3" }, { busca: "aula" })).toBe("/paginas?tipo=espera_jit&busca=aula");
    expect(hrefCom("/paginas", { tipo: "espera_jit" }, { tipo: null })).toBe("/paginas");
    expect(hrefCom("/paginas", { tipo: "x" }, { pagina: "2" })).toBe("/paginas?tipo=x&pagina=2");
    expect(hrefCom("/paginas", { tipo: "x", pagina: "2" }, { pagina: "1" })).toBe("/paginas?tipo=x");
    expect(hrefCom("/paginas", { busca: "" }, {})).toBe("/paginas");
  });

  it("data curta para o botão de período", () => {
    expect(dataCurta("2026-10-01")).toBe("01/10/2026");
    expect(dataCurta("")).toBe("");
    expect(dataCurta("01/10/2026")).toBe("");
  });
});
