import { describe, expect, it } from "vitest";
import { chaveSorteio, duracaoSorteioMs, intervaloTrocaMs, numeroAleatorio, sorteioTerminou } from "@/src/lib/regras/sorteio";

describe("chaveSorteio", () => {
  it("uma chave por webinar", () => {
    expect(chaveSorteio("w1")).toBe("vw_sorteio_w1");
    expect(chaveSorteio("w2")).not.toBe(chaveSorteio("w1"));
  });
});

describe("sorteioTerminou", () => {
  it("falso antes da duração, verdadeiro a partir dela", () => {
    expect(sorteioTerminou(0)).toBe(false);
    expect(sorteioTerminou(3899)).toBe(false);
    expect(sorteioTerminou(3900)).toBe(true);
    expect(sorteioTerminou(10_000)).toBe(true);
  });

  it("aceita duração customizada", () => {
    expect(sorteioTerminou(100, 100)).toBe(true);
    expect(sorteioTerminou(99, 100)).toBe(false);
  });
});

describe("numeroAleatorio", () => {
  it("mesmo tamanho do número final", () => {
    expect(numeroAleatorio("0423", () => 0.5)).toHaveLength(4);
    expect(numeroAleatorio("7", () => 0.5)).toHaveLength(1);
  });

  it("usa a fonte de aleatoriedade recebida (determinístico em teste)", () => {
    expect(numeroAleatorio("000", () => 0)).toBe("000");
    expect(numeroAleatorio("000", () => 0.99)).toBe("999");
  });

  it("número final vazio não quebra (1 dígito)", () => {
    expect(numeroAleatorio("", () => 0)).toHaveLength(1);
  });
});

describe("constantes de tempo", () => {
  it("duração e intervalo são positivos", () => {
    expect(duracaoSorteioMs()).toBeGreaterThan(0);
    expect(intervaloTrocaMs()).toBeGreaterThan(0);
  });
});
