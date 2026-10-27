import { describe, expect, it } from "vitest";
import { janelaParaSegundo, precisaBuscarProxima, precisaRecarregarJanela, proximaJanela } from "@/src/lib/regras/linha-do-tempo";

describe("janelaParaSegundo", () => {
  it("alinha em múltiplos de 300", () => {
    expect(janelaParaSegundo(0)).toEqual({ de: 0, ate: 300 });
    expect(janelaParaSegundo(299)).toEqual({ de: 0, ate: 300 });
    expect(janelaParaSegundo(300)).toEqual({ de: 300, ate: 600 });
    expect(janelaParaSegundo(610)).toEqual({ de: 600, ate: 900 });
  });

  it("nunca fica negativa", () => {
    expect(janelaParaSegundo(-10)).toEqual({ de: 0, ate: 300 });
  });

  it("aceita tamanho customizado", () => {
    expect(janelaParaSegundo(120, 60)).toEqual({ de: 120, ate: 180 });
  });
});

describe("proximaJanela", () => {
  it("emenda exatamente onde a anterior parou", () => {
    expect(proximaJanela(300)).toEqual({ de: 300, ate: 600 });
    expect(proximaJanela(0)).toEqual({ de: 0, ate: 300 });
  });
});

describe("precisaRecarregarJanela", () => {
  it("falso dentro da janela", () => {
    expect(precisaRecarregarJanela({ de: 0, ate: 300 }, 150)).toBe(false);
    expect(precisaRecarregarJanela({ de: 0, ate: 300 }, 0)).toBe(false);
    expect(precisaRecarregarJanela({ de: 0, ate: 300 }, 300)).toBe(false);
  });

  it("verdadeiro fora da janela (voltou ou avançou pra fora)", () => {
    expect(precisaRecarregarJanela({ de: 300, ate: 600 }, 10)).toBe(true);
    expect(precisaRecarregarJanela({ de: 0, ate: 300 }, 301)).toBe(true);
  });
});

describe("precisaBuscarProxima", () => {
  it("verdadeiro quando faltam <= margem segundos para o fim", () => {
    expect(precisaBuscarProxima(300, 240)).toBe(true);
    expect(precisaBuscarProxima(300, 239)).toBe(false);
  });

  it("aceita margem customizada", () => {
    expect(precisaBuscarProxima(300, 296, 5)).toBe(true);
    expect(precisaBuscarProxima(300, 100, 5)).toBe(false);
  });
});
