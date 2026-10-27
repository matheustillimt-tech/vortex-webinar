import { describe, expect, it } from "vitest";
import { gtmValido, noDominioDaSala, pixelMetaValido, pixelTiktokValido } from "@/src/lib/regras/pixels";

describe("pixelMetaValido", () => {
  it("aceita só dígitos", () => {
    expect(pixelMetaValido("1234567890")).toBe(true);
  });

  it("rejeita letras, vazio ou ausente", () => {
    expect(pixelMetaValido("abc123")).toBe(false);
    expect(pixelMetaValido("")).toBe(false);
    expect(pixelMetaValido(null)).toBe(false);
    expect(pixelMetaValido(undefined)).toBe(false);
  });
});

describe("pixelTiktokValido", () => {
  it("aceita letras maiúsculas e dígitos", () => {
    expect(pixelTiktokValido("C1A2B3C4D5")).toBe(true);
  });

  it("rejeita minúsculas, espaço ou vazio", () => {
    expect(pixelTiktokValido("c1a2b3")).toBe(false);
    expect(pixelTiktokValido("ABC 123")).toBe(false);
    expect(pixelTiktokValido("")).toBe(false);
  });
});

describe("gtmValido", () => {
  it("aceita o formato GTM-XXXX", () => {
    expect(gtmValido("GTM-ABC123")).toBe(true);
  });

  it("rejeita sem o prefixo ou em minúsculas", () => {
    expect(gtmValido("ABC123")).toBe(false);
    expect(gtmValido("gtm-abc123")).toBe(false);
    expect(gtmValido("GTM-")).toBe(false);
  });
});

describe("noDominioDaSala", () => {
  it("só no host da sala (com porta, sem diferenciar caixa)", () => {
    expect(noDominioDaSala("sala.exemplo.com.br", "https://sala.exemplo.com.br")).toBe(true);
    expect(noDominioDaSala("SALA.exemplo.com.br", "https://sala.exemplo.com.br")).toBe(true);
    expect(noDominioDaSala("sala.localhost:3130", "http://sala.localhost:3130")).toBe(true);
    expect(noDominioDaSala("painel.exemplo.com.br", "https://sala.exemplo.com.br")).toBe(false);
    expect(noDominioDaSala("localhost:3130", "http://sala.localhost:3130")).toBe(false);
  });

  it("sem a variável configurada (dev num host só): vale o host atual", () => {
    expect(noDominioDaSala("localhost:3000", undefined)).toBe(true);
    expect(noDominioDaSala("localhost:3000", "")).toBe(true);
  });
});
