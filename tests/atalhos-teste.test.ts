import { describe, expect, it } from "vitest";
import { momentosDoTeste } from "@/app/s/[slug]/sala/_sala/AtalhosTeste";

describe("momentosDoTeste", () => {
  it("início, pitch e oferta; sorteio só quando ligado", () => {
    const base = { pitchSeg: 3515, apareceSeg: 4636, sorteioLigado: false, sorteioSeg: 285 };
    expect(momentosDoTeste(base).map((m) => m.rotulo)).toEqual(["Início do webinar", "Início do pitch", "Oferta"]);
    expect(momentosDoTeste({ ...base, sorteioLigado: true }).map((m) => m.rotulo)).toEqual(["Início do webinar", "Início do pitch", "Oferta", "Sorteio"]);
  });
  it("sem pitch marcado não mostra o botão do pitch; sem oferta só o início", () => {
    expect(momentosDoTeste({ pitchSeg: null, apareceSeg: 100, sorteioLigado: false, sorteioSeg: null }).map((m) => m.rotulo)).toEqual(["Início do webinar", "Oferta"]);
    expect(momentosDoTeste(null).map((m) => m.rotulo)).toEqual(["Início do webinar"]);
  });
});
