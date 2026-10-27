import { describe, expect, it } from "vitest";
import { backoffMs, decidirLayoutSala, dentroDaCarencia, estadoConexao, seekForaDoLimite } from "@/src/lib/regras/player";

describe("seekForaDoLimite", () => {
  it("dentro do limiar não trava", () => {
    expect(seekForaDoLimite(10, 9, 1.5)).toBe(false);
    expect(seekForaDoLimite(10, 11.4, 1.5)).toBe(false);
  });

  it("além do limiar trava, pra frente ou pra trás", () => {
    expect(seekForaDoLimite(20, 10, 1.5)).toBe(true);
    expect(seekForaDoLimite(5, 10, 1.5)).toBe(true);
  });

  it("limiar padrão de 1,5 s", () => {
    expect(seekForaDoLimite(11.6, 10)).toBe(true);
    expect(seekForaDoLimite(11.4, 10)).toBe(false);
  });
});

describe("dentroDaCarencia", () => {
  it("logo depois de uma correção ainda está na carência", () => {
    expect(dentroDaCarencia(1000, 0, 3000)).toBe(true);
  });

  it("depois do prazo não está mais na carência", () => {
    expect(dentroDaCarencia(3001, 0, 3000)).toBe(false);
  });

  it("carência padrão de 3 s", () => {
    expect(dentroDaCarencia(2999, 0)).toBe(true);
    expect(dentroDaCarencia(3000, 0)).toBe(false);
  });
});

describe("backoffMs", () => {
  it("dobra a cada tentativa", () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    expect(backoffMs(4)).toBe(8000);
  });

  it("nunca passa do teto (padrão 15 s)", () => {
    expect(backoffMs(5)).toBe(15000);
    expect(backoffMs(10)).toBe(15000);
  });

  it("tentativa menor que 1 vira 1", () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(-3)).toBe(1000);
  });

  it("teto customizado", () => {
    expect(backoffMs(10, 5000)).toBe(5000);
  });
});

describe("estadoConexao", () => {
  it("normal até 5 s", () => {
    expect(estadoConexao(0)).toBe("normal");
    expect(estadoConexao(5000)).toBe("normal");
  });

  it("lenta entre 5 s e 12 s", () => {
    expect(estadoConexao(5001)).toBe("lenta");
    expect(estadoConexao(12000)).toBe("lenta");
  });

  it("recarregar depois de 12 s", () => {
    expect(estadoConexao(12001)).toBe("recarregar");
  });
});

describe("decidirLayoutSala", () => {
  it("vídeo horizontal sempre usa o layout horizontal", () => {
    expect(decidirLayoutSala("horizontal", 320)).toBe("horizontal");
    expect(decidirLayoutSala("horizontal", 1920)).toBe("horizontal");
  });

  it("vídeo vertical numa tela estreita usa o layout vertical", () => {
    expect(decidirLayoutSala("vertical", 400)).toBe("vertical");
    expect(decidirLayoutSala("vertical", 949)).toBe("vertical");
  });

  it("vídeo vertical numa tela larga usa o layout horizontal", () => {
    expect(decidirLayoutSala("vertical", 950)).toBe("horizontal");
    expect(decidirLayoutSala("vertical", 1920)).toBe("horizontal");
  });
});
