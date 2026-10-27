import { describe, expect, it } from "vitest";
import { contagemRestante, mensagensVisiveis, momentos, vendasEntre, type OfertaTempo } from "@/src/lib/regras/momentos";

const o: OfertaTempo = { ligada: true, apareceSeg: 120, someSeg: 1800, pitchSeg: 60, contagemSeg: 300, sorteioLigado: true, sorteioSeg: 90 };

describe("momentos", () => {
  it("nada no começo", () => expect(momentos(o, 30, false)).toEqual({ pitch: false, oferta: false, sorteio: false }));
  it("pitch e sorteio antes da oferta", () => expect(momentos(o, 95, false)).toEqual({ pitch: true, oferta: false, sorteio: true }));
  it("oferta no momento certo", () => expect(momentos(o, 120, false).oferta).toBe(true));
  it("oferta some no fim configurado", () => expect(momentos(o, 1800, false).oferta).toBe(false));
  it("some = 0: não some", () => expect(momentos({ ...o, someSeg: 0 }, 99999, false).oferta).toBe(true));
  it("fim do vídeo mostra a oferta", () => expect(momentos(o, 10, true).oferta).toBe(true));
  it("oferta desligada nunca aparece", () => expect(momentos({ ...o, ligada: false }, 500, true).oferta).toBe(false));
  it("sem oferta", () => expect(momentos(null, 500, true)).toEqual({ pitch: false, oferta: false, sorteio: false }));
});

describe("contagemRestante", () => {
  it("desce e para no zero", () => {
    expect(contagemRestante(300, 0)).toBe(300);
    expect(contagemRestante(300, 299)).toBe(1);
    expect(contagemRestante(300, 400)).toBe(0);
  });
});

describe("mensagens e vendas", () => {
  const lista = [{ segundo: 15, t: "c" }, { segundo: 5, t: "a" }, { segundo: 10, t: "b" }, { segundo: 10, t: "b2" }];
  it("mostra só as que já passaram, em ordem estável", () => {
    expect(mensagensVisiveis(lista, 10).map((m) => m.t)).toEqual(["a", "b", "b2"]);
  });
  it("venda entre (exclusivo, inclusivo]: inclui o segundo final e exclui o inicial", () => {
    expect(vendasEntre(lista, 5, 10).map((m) => m.t)).toEqual(["b", "b2"]);
  });
  it("salto grande: pega tudo que ficou pra trás", () => {
    const comSalto = [...lista, { segundo: 35, t: "d" }];
    expect(vendasEntre(comSalto, 10, 40).map((m) => m.t)).toEqual(["c", "d"]);
  });
  it("intervalo invertido não devolve nada", () => {
    expect(vendasEntre(lista, 40, 10)).toEqual([]);
  });
  it("resultado vem ordenado por segundo", () => {
    const foraDeOrdem = [{ segundo: 10, t: "b2" }, { segundo: 5, t: "a" }, { segundo: 10, t: "b" }];
    expect(vendasEntre(foraDeOrdem, 0, 10).map((m) => m.t)).toEqual(["a", "b2", "b"]);
  });
});
