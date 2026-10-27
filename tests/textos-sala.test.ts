import { describe, expect, it } from "vitest";
import { idiomaDoLang, t } from "@/src/lib/regras/textos-sala";

describe("t", () => {
  it("devolve o texto em pt-BR", () => {
    expect(t("pt-BR", "aoVivo")).toBe("Ao vivo");
  });

  it("devolve o texto em es", () => {
    expect(t("es", "aoVivo")).toBe("En vivo");
  });

  it("devolve o texto em en", () => {
    expect(t("en", "aoVivo")).toBe("Live");
  });

  it("substitui variáveis", () => {
    expect(t("pt-BR", "vagas", { n: 87 })).toBe("87% das vagas preenchidas...");
  });

  it("idioma desconhecido cai pro pt-BR", () => {
    // @ts-expect-error testando robustez em runtime
    expect(t("fr", "aoVivo")).toBe("Ao vivo");
  });

  it("valor com '$&' não é interpretado como padrão de substituição do replaceAll", () => {
    expect(t("pt-BR", "vagas", { n: "$&" })).toBe("$&% das vagas preenchidas...");
  });

  it("tem os textos da página de erro e da 404 da sala nos três idiomas", () => {
    expect(t("pt-BR", "paginaNaoEncontrada")).toBe("Esta página não existe.");
    expect(t("es", "tentarDeNovo")).toBe("Intentar de nuevo");
    expect(t("en", "erroInesperado")).toBe("Something went wrong loading this page.");
  });
});

describe("idiomaDoLang", () => {
  it("reconhece os idiomas da sala", () => {
    expect(idiomaDoLang("es")).toBe("es");
    expect(idiomaDoLang("en")).toBe("en");
    expect(idiomaDoLang("pt-BR")).toBe("pt-BR");
  });

  it("qualquer outra coisa cai no pt-BR", () => {
    expect(idiomaDoLang(null)).toBe("pt-BR");
    expect(idiomaDoLang("")).toBe("pt-BR");
    expect(idiomaDoLang("fr")).toBe("pt-BR");
  });
});
