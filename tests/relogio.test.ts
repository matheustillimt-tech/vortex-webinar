import { describe, expect, it } from "vitest";
import { inicioDaSessao, marcosDeTempo, posicaoVideo, precisaReposicionar } from "@/src/lib/regras/relogio";

const ini = new Date("2026-10-19T22:00:00Z");

describe("posicaoVideo", () => {
  it("antes do início", () => expect(posicaoVideo(ini, new Date("2026-10-19T21:59:00Z"), 3600)).toEqual({ estado: "antes", segundo: 0 }));
  it("rodando: agora menos o início", () => expect(posicaoVideo(ini, new Date("2026-10-19T22:05:30Z"), 3600)).toEqual({ estado: "rodando", segundo: 330 }));
  it("acabou", () => expect(posicaoVideo(ini, new Date("2026-10-19T23:00:00Z"), 3600)).toEqual({ estado: "fim", segundo: 3600 }));

  it("duração desconhecida (<=20s, ainda não chegou do banco): nunca retorna fim", () => {
    expect(posicaoVideo(ini, new Date("2026-10-19T23:00:00Z"), 0)).toEqual({ estado: "rodando", segundo: 3600 });
    expect(posicaoVideo(ini, new Date("2026-10-19T22:00:10Z"), 10)).toEqual({ estado: "rodando", segundo: 10 });
    expect(posicaoVideo(ini, new Date("2026-10-19T21:59:00Z"), 10)).toEqual({ estado: "antes", segundo: 0 });
  });
});

describe("inicioDaSessao", () => {
  const primeiroAcesso = new Date("2026-10-19T22:07:00Z");
  it("sincronizado: começa no horário da sessão", () => {
    expect(inicioDaSessao({ sincronizar: true, janelaInicio: ini, primeiroAcesso })).toEqual(ini);
  });
  it("sem sincronizar: cada um assiste do começo", () => {
    expect(inicioDaSessao({ sincronizar: false, janelaInicio: ini, primeiroAcesso })).toEqual(primeiroAcesso);
  });

  const jitEscolhido = new Date("2026-10-19T22:15:00Z");
  it("JIT escolhido vence mesmo sincronizado", () => {
    expect(inicioDaSessao({ sincronizar: true, janelaInicio: ini, primeiroAcesso, jitEscolhido })).toEqual(jitEscolhido);
  });
  it("JIT escolhido vence mesmo sem sincronizar", () => {
    expect(inicioDaSessao({ sincronizar: false, janelaInicio: ini, primeiroAcesso, jitEscolhido })).toEqual(jitEscolhido);
  });
  it("sem JIT escolhido (null), comportamento normal", () => {
    expect(inicioDaSessao({ sincronizar: true, janelaInicio: ini, primeiroAcesso, jitEscolhido: null })).toEqual(ini);
  });
});

describe("precisaReposicionar", () => {
  it.each([
    [100, 100, false],
    [99.5, 100, false],
    [99, 100, true],
    [101.4, 100, false],
    [101.5, 100, true],
  ])("atual %s, esperado %s → %s", (a, e, r) => expect(precisaReposicionar(a, e)).toBe(r));
});

describe("marcosDeTempo", () => {
  it("lista os marcos já alcançados", () => {
    expect(marcosDeTempo(899)).toEqual([]);
    expect(marcosDeTempo(900)).toEqual(["min_15"]);
    expect(marcosDeTempo(3600)).toEqual(["min_15", "min_30", "min_45", "min_60"]);
  });
});
