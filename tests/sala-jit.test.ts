import { describe, expect, it } from "vitest";
import { estadoSalaJit, MINUTOS_ENTRADA_ANTES_JIT } from "@/src/lib/regras/sala";

const jit = new Date("2026-11-02T23:00:00Z");
const duracao = 3600;
const em = (min: number) => new Date(jit.getTime() + min * 60_000);

describe("estadoSalaJit", () => {
  it("janela é do horário escolhido até horário + duração do vídeo", () => {
    expect(estadoSalaJit(jit, duracao, em(0)).janela).toEqual({ inicio: jit, fim: em(60) });
  });

  it("mais de 10 min antes: espera, ainda sem poder entrar", () => {
    expect(MINUTOS_ENTRADA_ANTES_JIT).toBe(10);
    expect(estadoSalaJit(jit, duracao, em(-11))).toMatchObject({ estado: "espera", podeEntrar: false });
  });

  it("até 10 min antes: espera com contagem (pode entrar)", () => {
    expect(estadoSalaJit(jit, duracao, em(-10))).toMatchObject({ estado: "espera", podeEntrar: true });
    expect(estadoSalaJit(jit, duracao, em(-1))).toMatchObject({ estado: "espera", podeEntrar: true });
  });

  it("no horário e durante o vídeo: aberta", () => {
    expect(estadoSalaJit(jit, duracao, em(0))).toMatchObject({ estado: "aberta", podeEntrar: true });
    expect(estadoSalaJit(jit, duracao, em(59))).toMatchObject({ estado: "aberta", podeEntrar: true });
  });

  it("depois da duração: encerrada", () => {
    expect(estadoSalaJit(jit, duracao, em(60))).toMatchObject({ estado: "encerrada", podeEntrar: false });
    expect(estadoSalaJit(jit, duracao, em(600))).toMatchObject({ estado: "encerrada", podeEntrar: false });
  });

  it("duração desconhecida (null/0): usa 2 h", () => {
    expect(estadoSalaJit(jit, null, em(119)).estado).toBe("aberta");
    expect(estadoSalaJit(jit, 0, em(120)).estado).toBe("encerrada");
  });
});
