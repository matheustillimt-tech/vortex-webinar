import { describe, expect, it } from "vitest";
import { validarPessoa } from "@/src/lib/regras/equipe";

const ok = { nome: "Clara", email: "clara@exemplo.com.br", senha: "Senha#2026", papel: "atendente" };

describe("validarPessoa", () => {
  it("aceita cadastro completo", () => {
    expect(validarPessoa(ok)).toBeNull();
  });
  it.each([
    [{ ...ok, nome: " " }, "Informe o nome."],
    [{ ...ok, email: "carla" }, "E-mail inválido."],
    [{ ...ok, senha: "curta1!" }, "A senha precisa ter pelo menos 8 caracteres, com letra e número."],
    [{ ...ok, senha: "somenteletras" }, "A senha precisa ter pelo menos 8 caracteres, com letra e número."],
    [{ ...ok, papel: "dono" }, "Papel inválido."],
  ])("recusa %#", (d, msg) => {
    expect(validarPessoa(d)).toBe(msg);
  });
});
