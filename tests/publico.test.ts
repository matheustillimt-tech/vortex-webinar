import { describe, expect, it } from "vitest";
import { alvoPublico, intervaloPublicoMs, passoPublico, type Audiencia } from "@/src/lib/regras/publico";

const din: Audiencia = { modo: "dinamico", minimo: 80, maximo: 150 };
const fixo = (v: number) => () => v;

describe("alvoPublico", () => {
  it.each([
    [0, 80],
    [0.0625, 115],
    [0.125, 150],
    [0.5, 150],
    [0.625, 129],
    [1, 80],
    [1.5, 80],
  ])("fração %s → %s", (f, alvo) => expect(alvoPublico(din, f)).toBe(alvo));
  it("fixo mostra o máximo", () => expect(alvoPublico({ ...din, modo: "fixo" }, 0.9)).toBe(150));
  it("oculto não mostra número", () => expect(alvoPublico({ ...din, modo: "oculto" }, 0.5)).toBeNull());
});

describe("passoPublico", () => {
  it("anda até 8 pessoas quando longe", () => expect(passoPublico(80, 150, fixo(0.5))).toBe(85));
  it("longe do alvo: fica parado só 10% das vezes", () => expect(passoPublico(80, 150, fixo(0.05))).toBe(80));
  it("perto do alvo: fica parado 28% das vezes", () => expect(passoPublico(140, 150, fixo(0.2))).toBe(140));
  it("desce quando o alvo é menor", () => expect(passoPublico(150, 140, fixo(0.9))).toBe(142));
  it("não passa do alvo", () => expect(passoPublico(148, 150, fixo(0.99))).toBe(150));
  it("no alvo não muda", () => expect(passoPublico(150, 150, fixo(0.9))).toBe(150));
});

describe("intervaloPublicoMs", () => {
  it("entre 1,5 e 3,5 s", () => {
    expect(intervaloPublicoMs(fixo(0))).toBe(1500);
    expect(intervaloPublicoMs(fixo(0.999))).toBe(3498);
  });
});
