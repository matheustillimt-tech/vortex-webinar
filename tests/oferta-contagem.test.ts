import { describe, expect, it } from "vitest";
import { chaveContagemOferta, formatarRestante, inicioContagem, restanteContagem } from "@/src/lib/regras/oferta-contagem";

describe("chaveContagemOferta", () => {
  it("uma chave por webinar", () => {
    expect(chaveContagemOferta("w1")).toBe("vw_oferta_w1");
    expect(chaveContagemOferta("w2")).not.toBe(chaveContagemOferta("w1"));
  });
});

describe("inicioContagem", () => {
  it("usa o valor salvo quando existe e é válido", () => {
    expect(inicioContagem(10_000, 5_000)).toBe(5_000);
  });

  it("usa agora quando não há valor salvo", () => {
    expect(inicioContagem(10_000, null)).toBe(10_000);
  });

  it("ignora valor salvo inválido (futuro, zero, negativo, NaN)", () => {
    expect(inicioContagem(10_000, 20_000)).toBe(10_000);
    expect(inicioContagem(10_000, 0)).toBe(10_000);
    expect(inicioContagem(10_000, -5)).toBe(10_000);
    expect(inicioContagem(10_000, NaN)).toBe(10_000);
  });
});

describe("restanteContagem", () => {
  it("conta para baixo a partir do início", () => {
    expect(restanteContagem(60, 0, 0)).toBe(60);
    expect(restanteContagem(60, 0, 10_000)).toBe(50);
    expect(restanteContagem(60, 0, 60_000)).toBe(0);
  });

  it("nunca fica negativo", () => {
    expect(restanteContagem(60, 0, 120_000)).toBe(0);
  });

  it("relógio voltando (agora antes do início) não gera negativo nem conta a mais", () => {
    expect(restanteContagem(60, 10_000, 0)).toBe(60);
  });
});

describe("formatarRestante", () => {
  it("mm:ss com zero à esquerda", () => {
    expect(formatarRestante(0)).toBe("00:00");
    expect(formatarRestante(5)).toBe("00:05");
    expect(formatarRestante(65)).toBe("01:05");
    expect(formatarRestante(600)).toBe("10:00");
  });

  it("nunca fica negativo", () => {
    expect(formatarRestante(-5)).toBe("00:00");
  });
});
