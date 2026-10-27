import { describe, expect, it } from "vitest";
import { gerarSlug, slugUnico, validarSlug } from "@/src/lib/regras/slug";

describe("validarSlug", () => {
  it("aceita slug simples", () => {
    expect(validarSlug("minha-aula-ia")).toBeNull();
  });
  it.each([
    ["ab", "Use de 3 a 60 caracteres."],
    ["a".repeat(61), "Use de 3 a 60 caracteres."],
    ["Nova", "Use só letras minúsculas, números e hífen."],
    ["nova_renda", "Use só letras minúsculas, números e hífen."],
    ["-nova", "Não comece nem termine com hífen."],
    ["nova-", "Não comece nem termine com hífen."],
    ["nova--renda", "Não use dois hífens seguidos."],
  ])("recusa %s", (s, msg) => {
    expect(validarSlug(s)).toBe(msg);
  });
});

describe("gerarSlug", () => {
  it("tira acento, espaço e símbolo", () => {
    expect(gerarSlug("  Aulão: Renda com I.A. 2026! ")).toBe("aulao-renda-com-i-a-2026");
  });
  it("corta em 60 sem terminar em hífen", () => {
    const s = gerarSlug("palavra ".repeat(20));
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("slugUnico", () => {
  it("devolve o próprio slug se livre", () => expect(slugUnico("aula", ["outra"])).toBe("aula"));
  it("acrescenta número quando ocupado", () => expect(slugUnico("aula", ["aula", "aula-2"])).toBe("aula-3"));
  it("não passa de 60 caracteres", () => {
    const base = "a".repeat(60);
    const r = slugUnico(base, [base]);
    expect(r.length).toBeLessThanOrEqual(60);
    expect(r.endsWith("-2")).toBe(true);
  });
});
