import { beforeEach, describe, expect, it, vi } from "vitest";

const receberVenda = vi.fn();
vi.mock("@/src/lib/checkout", () => ({ receberVenda: (...a: unknown[]) => receberVenda(...a) }));

beforeEach(() => {
  vi.resetModules();
  receberVenda.mockReset();
  receberVenda.mockResolvedValue({ tipo: "aceita" });
});

function params(plataforma: string, token = "tok-1") {
  return { params: Promise.resolve({ plataforma, token }) };
}

describe("POST /api/checkout/[plataforma]/[token]", () => {
  it("passa a assinatura da query string (?signature=, como a Kiwify manda) pro recebimento", async () => {
    const { POST } = await import("../app/api/checkout/[plataforma]/[token]/route");
    const req = new Request("https://painel.x.com/api/checkout/kiwify/tok-1?signature=abc123", { method: "POST", body: '{"a":1}' });
    const res = await POST(req, params("kiwify"));
    expect(res.status).toBe(200);
    expect(receberVenda).toHaveBeenCalledWith("kiwify", "tok-1", '{"a":1}', expect.any(Object), { signature: "abc123" });
  });

  it("sem signature na query: consulta com null (o header fica de reserva)", async () => {
    const { POST } = await import("../app/api/checkout/[plataforma]/[token]/route");
    const req = new Request("https://painel.x.com/api/checkout/kiwify/tok-1", { method: "POST", body: "{}", headers: { signature: "do-header" } });
    await POST(req, params("kiwify"));
    expect(receberVenda).toHaveBeenCalledWith("kiwify", "tok-1", "{}", expect.objectContaining({ signature: "do-header" }), { signature: null });
  });

  it("erro ao gravar a venda: 500 (a plataforma reenvia)", async () => {
    receberVenda.mockResolvedValue({ tipo: "erro" });
    const { POST } = await import("../app/api/checkout/[plataforma]/[token]/route");
    const res = await POST(new Request("https://painel.x.com/api/checkout/hotmart/tok-1", { method: "POST", body: "{}" }), params("hotmart"));
    expect(res.status).toBe(500);
  });

  it("content-length acima de 1 MB: 413 sem ler o corpo", async () => {
    const { POST } = await import("../app/api/checkout/[plataforma]/[token]/route");
    const req = new Request("https://painel.x.com/api/checkout/hotmart/tok-1", { method: "POST", body: "{}", headers: { "content-length": "2000000" } });
    const res = await POST(req, params("hotmart"));
    expect(res.status).toBe(413);
    expect(receberVenda).not.toHaveBeenCalled();
  });

  it("limite em bytes, não em caracteres: 600 mil 'é' (1,2 MB) dá 413", async () => {
    const { POST } = await import("../app/api/checkout/[plataforma]/[token]/route");
    const corpo = "é".repeat(600_000); // 600 mil caracteres, 1,2 milhão de bytes
    const req = new Request("https://painel.x.com/api/checkout/hotmart/tok-1", { method: "POST", body: corpo });
    const res = await POST(req, params("hotmart"));
    expect(res.status).toBe(413);
    expect(receberVenda).not.toHaveBeenCalled();
  });

  it("plataforma desconhecida: 404; token não achado: 404; não autorizada: 401", async () => {
    const { POST } = await import("../app/api/checkout/[plataforma]/[token]/route");
    expect((await POST(new Request("https://x.com/a", { method: "POST", body: "{}" }), params("paypal"))).status).toBe(404);
    receberVenda.mockResolvedValueOnce({ tipo: "nao_encontrado" });
    expect((await POST(new Request("https://x.com/a", { method: "POST", body: "{}" }), params("hotmart"))).status).toBe(404);
    receberVenda.mockResolvedValueOnce({ tipo: "nao_autorizada" });
    expect((await POST(new Request("https://x.com/a", { method: "POST", body: "{}" }), params("hotmart"))).status).toBe(401);
  });
});
