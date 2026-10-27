import { describe, expect, it, vi } from "vitest";
import { cacheCurto } from "@/src/lib/cache-curto";

function relogio(inicio = 1_000) {
  let t = inicio;
  return { agora: () => t, andar: (ms: number) => (t += ms) };
}

describe("cacheCurto", () => {
  it("dentro do TTL devolve o valor guardado sem carregar de novo; depois do TTL carrega de novo", async () => {
    const r = relogio();
    const carregar = vi.fn(async (k: string) => `${k}-${carregar.mock.calls.length}`);
    const c = cacheCurto(carregar, { ttlMs: 10_000, agora: r.agora });
    await expect(c("a")).resolves.toBe("a-1");
    r.andar(9_999);
    await expect(c("a")).resolves.toBe("a-1");
    expect(carregar).toHaveBeenCalledTimes(1);
    r.andar(1);
    await expect(c("a")).resolves.toBe("a-2");
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("chaves diferentes não se misturam", async () => {
    const c = cacheCurto(async (k: string) => k.toUpperCase(), { ttlMs: 10_000 });
    await expect(c("a")).resolves.toBe("A");
    await expect(c("b")).resolves.toBe("B");
    expect(c.tamanho()).toBe(2);
  });

  it("chamadas simultâneas da mesma chave dividem uma carga só", async () => {
    let soltar: (v: string) => void = () => {};
    const carregar = vi.fn(() => new Promise<string>((res) => (soltar = res)));
    const c = cacheCurto(carregar, { ttlMs: 10_000 });
    const p1 = c("a");
    const p2 = c("a");
    soltar("ok");
    await expect(Promise.all([p1, p2])).resolves.toEqual(["ok", "ok"]);
    expect(carregar).toHaveBeenCalledTimes(1);
  });

  it("valor recusado por `guardar` não fica no cache", async () => {
    const carregar = vi.fn(async () => ({ completa: false }));
    const c = cacheCurto(carregar, { ttlMs: 10_000, guardar: (v) => v.completa });
    await c("a");
    await Promise.resolve();
    await c("a");
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("Promise rejeitada sai do cache: a próxima chamada tenta de novo", async () => {
    const carregar = vi.fn().mockRejectedValueOnce(new Error("caiu")).mockResolvedValueOnce("ok");
    const c = cacheCurto<string>(carregar, { ttlMs: 10_000 });
    await expect(c("a")).rejects.toThrow("caiu");
    await expect(c("a")).resolves.toBe("ok");
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("respeita maxChaves: tira as vencidas e, se precisar, a mais antiga", async () => {
    const r = relogio();
    const c = cacheCurto(async (k: string) => k, { ttlMs: 10_000, maxChaves: 2, agora: r.agora });
    await c("a");
    await c("b");
    await c("c");
    expect(c.tamanho()).toBe(2);
    r.andar(10_000);
    await c("d");
    expect(c.tamanho()).toBe(1);
  });

  it("limpar esvazia tudo", async () => {
    const carregar = vi.fn(async (k: string) => k);
    const c = cacheCurto(carregar, { ttlMs: 10_000 });
    await c("a");
    c.limpar();
    await c("a");
    expect(carregar).toHaveBeenCalledTimes(2);
  });
});
