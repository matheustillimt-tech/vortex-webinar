import { beforeEach, describe, expect, it, vi } from "vitest";

const reivindicarGeracao = vi.fn();
const avancarGeracao = vi.fn();
const env = vi.fn();

vi.mock("@/src/lib/geracao", () => ({
  reivindicarGeracao: (...a: unknown[]) => reivindicarGeracao(...a),
  avancarGeracao: (...a: unknown[]) => avancarGeracao(...a),
}));
vi.mock("@/src/lib/env", () => ({ env: (...a: unknown[]) => env(...a) }));

beforeEach(() => {
  vi.resetModules();
  reivindicarGeracao.mockReset();
  avancarGeracao.mockReset();
  env.mockReset();
  env.mockReturnValue("segredo-do-cron");
});

function req(auth?: string): Request {
  const headers: Record<string, string> = auth ? { authorization: auth } : {};
  return new Request("https://painel.x.com/api/cron/ia", { headers });
}

describe("GET /api/cron/ia", () => {
  it("sem Authorization: 401, não reivindica nada", async () => {
    const { GET } = await import("../app/api/cron/ia/route");
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(reivindicarGeracao).not.toHaveBeenCalled();
  });

  it("Bearer errado: 401", async () => {
    const { GET } = await import("../app/api/cron/ia/route");
    const res = await GET(req("Bearer errado"));
    expect(res.status).toBe(401);
  });

  it("sem geração em andamento: 200, processada: false, não avança nada", async () => {
    reivindicarGeracao.mockResolvedValue(null);
    const { GET } = await import("../app/api/cron/ia/route");
    const res = await GET(req("Bearer segredo-do-cron"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ processada: false });
    expect(avancarGeracao).not.toHaveBeenCalled();
  });

  it("com geração reivindicada: avança e devolve o id", async () => {
    reivindicarGeracao.mockResolvedValue({ id: "g1", status: "fila" });
    avancarGeracao.mockResolvedValue(undefined);
    const { GET } = await import("../app/api/cron/ia/route");
    const res = await GET(req("Bearer segredo-do-cron"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ processada: true, id: "g1" });
    expect(avancarGeracao).toHaveBeenCalledWith({ id: "g1", status: "fila" });
  });

  it("maxDuration = 300", async () => {
    const rota = await import("../app/api/cron/ia/route");
    expect(rota.maxDuration).toBe(300);
  });
});
