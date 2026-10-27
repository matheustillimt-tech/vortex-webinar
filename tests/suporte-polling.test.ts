import { describe, expect, it } from "vitest";
import { acumularRecebidas, maisRecente } from "@/src/lib/regras/suporte";

const m = (id: string, atualizadaEm: string, texto = id) => ({ id, atualizadaEm, texto });

describe("acumularRecebidas", () => {
  it("dedupe por id: a versão nova (editada/apagada) substitui a antiga, sem duplicar", () => {
    const r = acumularRecebidas([m("a", "2026-10-20T10:00:00Z"), m("b", "2026-10-20T10:00:01Z")], [m("a", "2026-10-20T10:00:05Z", "editada")], 200);
    expect(r.map((x) => x.id)).toEqual(["b", "a"]);
    expect(r.find((x) => x.id === "a")!.texto).toBe("editada");
  });

  it("mantém só as últimas `limite`", () => {
    const atual = Array.from({ length: 5 }, (_, i) => m(`m${i}`, `2026-10-20T10:00:0${i}Z`));
    const r = acumularRecebidas(atual, [m("novo", "2026-10-20T10:00:09Z")], 3);
    expect(r.map((x) => x.id)).toEqual(["m3", "m4", "novo"]);
  });
});

describe("maisRecente", () => {
  it("compara com microssegundos (o Date só guarda milissegundos)", () => {
    expect(maisRecente("2026-10-20T10:00:00.123+00:00", "2026-10-20T10:00:00.123456+00:00")).toBe("2026-10-20T10:00:00.123456+00:00");
    expect(maisRecente("2026-10-20T10:00:00.123456+00:00", "2026-10-20T10:00:00.1234+00:00")).toBe("2026-10-20T10:00:00.123456+00:00");
  });
  it("sem atual: o candidato; fuso diferente conta pelo instante", () => {
    expect(maisRecente(null, "2026-10-20T10:00:00Z")).toBe("2026-10-20T10:00:00Z");
    expect(maisRecente("2026-10-20T10:00:00-03:00", "2026-10-20T12:00:00Z")).toBe("2026-10-20T10:00:00-03:00");
  });
});
