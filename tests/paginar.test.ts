import { describe, expect, it } from "vitest";
import { lerTudo } from "../src/lib/supabase/paginar";

/** Fábrica de um builder falso: cada chamada devolve um objeto com `.range(desde, ate)` que lê de `todas`. */
function construtorFalso<T>(todas: T[], opts: { falharNaPagina?: number } = {}) {
  let chamadas = 0;
  const construir = () => ({
    range: async (desde: number, ate: number) => {
      const pagina = chamadas;
      chamadas++;
      if (opts.falharNaPagina === pagina) return { data: null, error: { message: "falhou" } };
      return { data: todas.slice(desde, ate + 1), error: null };
    },
  });
  return { construir, chamadasFeitas: () => chamadas };
}

describe("lerTudo", () => {
  it("menos de 1000 linhas: uma página só", async () => {
    const todas = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const { construir, chamadasFeitas } = construtorFalso(todas);

    const r = await lerTudo(construir);

    expect(r).toEqual({ data: todas, error: null });
    expect(chamadasFeitas()).toBe(1);
  });

  it("exatamente 1000 linhas: pede uma segunda página vazia pra confirmar o fim", async () => {
    const todas = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const { construir, chamadasFeitas } = construtorFalso(todas);

    const r = await lerTudo(construir);

    expect(r.data).toHaveLength(1000);
    expect(r.error).toBeNull();
    expect(chamadasFeitas()).toBe(2);
  });

  it("mais de 1000 linhas (ex.: 2500): pagina em lotes de 1000 até sobrar menos de 1000", async () => {
    const todas = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const { construir, chamadasFeitas } = construtorFalso(todas);

    const r = await lerTudo(construir);

    expect(r.data).toHaveLength(2500);
    expect(r.data).toEqual(todas);
    expect(chamadasFeitas()).toBe(3); // 1000 + 1000 + 500
  });

  it("erro no meio: devolve o que já tinha lido e o erro, sem continuar", async () => {
    const todas = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const { construir, chamadasFeitas } = construtorFalso(todas, { falharNaPagina: 1 });

    const r = await lerTudo(construir);

    expect(r.data).toHaveLength(1000);
    expect(r.error).toEqual({ message: "falhou" });
    expect(chamadasFeitas()).toBe(2);
  });

  it("nenhuma linha: devolve lista vazia", async () => {
    const { construir } = construtorFalso<{ id: number }>([]);
    const r = await lerTudo(construir);
    expect(r).toEqual({ data: [], error: null });
  });
});
