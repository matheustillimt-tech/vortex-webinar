import { describe, expect, it } from "vitest";
import { paraE164, telefoneLegivel } from "@/src/lib/regras/telefone";

describe("paraE164", () => {
  it("celular brasileiro com máscara", () => {
    expect(paraE164("(11) 98765-4321")).toBe("+5511987654321");
  });
  it("já com DDI", () => {
    expect(paraE164("+55 11 98765-4321")).toBe("+5511987654321");
  });
  it("outro país pelo código", () => {
    expect(paraE164("912 345 678", "PT")).toBe("+351912345678");
  });
  it("número inválido devolve null", () => {
    expect(paraE164("123")).toBeNull();
    expect(paraE164("")).toBeNull();
  });
});

describe("telefoneLegivel", () => {
  it("Brasil sem +55, fora no formato internacional, inválido como veio", () => {
    expect(telefoneLegivel("+5511900001234")).toBe("(11) 90000-1234");
    expect(telefoneLegivel("+14155552671")).toBe("+1 415 555 2671");
    expect(telefoneLegivel("abc")).toBe("abc");
  });
});
