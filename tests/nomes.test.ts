import { describe, expect, it } from "vitest";
import { trocarNome } from "@/src/lib/regras/nomes";

describe("trocarNome", () => {
  it("troca #nome, #nomecompleto e #sobrenome", () => {
    expect(trocarNome("Oi #nome, tudo bem #nomecompleto? #sobrenome", "Ana Maria Souza")).toBe("Oi Ana, tudo bem Ana Maria Souza? Maria Souza");
  });
  it("nome de uma palavra: sobrenome vazio", () => {
    expect(trocarNome("#nome #sobrenome!", "Ana")).toBe("Ana !");
  });
  it("nome com $ não deve ser interpretado como referência de regex no replace", () => {
    expect(trocarNome("Oi #nome!", "Ana$' X")).toBe("Oi Ana$'!");
    expect(trocarNome("Oi #nomecompleto!", "Ana$' X")).toBe("Oi Ana$' X!");
  });
});
