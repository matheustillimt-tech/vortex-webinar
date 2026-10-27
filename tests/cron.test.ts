import { beforeEach, describe, expect, it, vi } from "vitest";

const processarFila = vi.fn();
const avaliarFimDeSessoes = vi.fn();
const env = vi.fn();
const processarEmails = vi.fn();
const EMAILS = { enviados: 4, falhas: 1, expirados: 0 };

vi.mock("@/src/lib/disparos", () => ({
  processarFila: (...a: unknown[]) => processarFila(...a),
  avaliarFimDeSessoes: (...a: unknown[]) => avaliarFimDeSessoes(...a),
}));
vi.mock("@/src/lib/emails", () => ({ processarEmails: (...a: unknown[]) => processarEmails(...a) }));
vi.mock("@/src/lib/env", () => ({ env: (...a: unknown[]) => env(...a) }));

beforeEach(() => {
  vi.resetModules();
  processarFila.mockReset();
  avaliarFimDeSessoes.mockReset();
  env.mockReset();
  processarEmails.mockReset();
  processarEmails.mockResolvedValue(EMAILS);
  env.mockReturnValue("segredo-do-cron");
  processarFila.mockResolvedValue({ processados: 3 });
  avaliarFimDeSessoes.mockResolvedValue({ avaliadas: 2 });
});

function req(auth?: string): Request {
  const headers: Record<string, string> = auth ? { authorization: auth } : {};
  return new Request("https://painel.x.com/api/cron/tick", { headers });
}

describe("GET /api/cron/tick", () => {
  it("sem Authorization: 401", async () => {
    const { GET } = await import("../app/api/cron/tick/route");
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(processarFila).not.toHaveBeenCalled();
  });

  it("Bearer errado: 401", async () => {
    const { GET } = await import("../app/api/cron/tick/route");
    const res = await GET(req("Bearer errado"));
    expect(res.status).toBe(401);
  });

  it("Bearer certo: processa a fila e as sessões, 200 com os totais", async () => {
    const { GET } = await import("../app/api/cron/tick/route");
    const res = await GET(req("Bearer segredo-do-cron"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ disparos: 3, sessoes: 2, emails: EMAILS });
    expect(processarEmails).toHaveBeenCalledWith(expect.any(Date), 50, { prazo: expect.any(Number) });
    expect(processarFila).toHaveBeenCalledWith(50, expect.any(Date), expect.any(Function), { prazo: expect.any(Number) });
    expect(avaliarFimDeSessoes).toHaveBeenCalledWith(200, expect.any(Date));
  });

  it("prazo dos envios: 40 s a partir do início", async () => {
    const antes = Date.now();
    const { GET } = await import("../app/api/cron/tick/route");
    await GET(req("Bearer segredo-do-cron"));
    const { prazo } = processarFila.mock.calls[0][3] as { prazo: number };
    expect(prazo - antes).toBeGreaterThanOrEqual(40_000);
    expect(prazo - antes).toBeLessThan(41_000);
  });

  it("prazo dos e-mails: 20 s a partir da vez deles, nunca depois dos 40 s", async () => {
    const antes = Date.now();
    const { GET } = await import("../app/api/cron/tick/route");
    await GET(req("Bearer segredo-do-cron"));
    const { prazo } = processarEmails.mock.calls[0][2] as { prazo: number };
    expect(prazo - antes).toBeGreaterThanOrEqual(20_000);
    expect(prazo - antes).toBeLessThan(21_000);
  });

  it("e-mails falham: o tick segue 200 e responde emails: null, sem detalhe", async () => {
    processarEmails.mockRejectedValue(new Error("detalhe interno"));
    const { GET } = await import("../app/api/cron/tick/route");
    const res = await GET(req("Bearer segredo-do-cron"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ disparos: 3, sessoes: 2, emails: null });
    expect(avaliarFimDeSessoes).toHaveBeenCalled();
  });

  it("maxDuration = 60", async () => {
    const rota = await import("../app/api/cron/tick/route");
    expect(rota.maxDuration).toBe(60);
  });

  it("fila falha: ainda avalia as sessões; 500 com os totais e só o nome da parte que falhou", async () => {
    processarFila.mockRejectedValue(new Error("detalhe interno do banco"));
    const { GET } = await import("../app/api/cron/tick/route");
    const res = await GET(req("Bearer segredo-do-cron"));
    expect(res.status).toBe(500);
    expect(avaliarFimDeSessoes).toHaveBeenCalled();
    const corpo = await res.json();
    expect(corpo).toEqual({ disparos: 0, sessoes: 2, emails: EMAILS, erros: ["disparos"] });
    expect(JSON.stringify(corpo)).not.toContain("detalhe interno");
  });

  it("avaliação falha: a fila já foi processada; 500 com erros: ['sessoes']", async () => {
    avaliarFimDeSessoes.mockRejectedValue(new Error("x"));
    const { GET } = await import("../app/api/cron/tick/route");
    const res = await GET(req("Bearer segredo-do-cron"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ disparos: 3, sessoes: 0, emails: EMAILS, erros: ["sessoes"] });
  });
});
