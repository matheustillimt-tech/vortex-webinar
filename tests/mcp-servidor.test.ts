import { beforeEach, describe, expect, it, vi } from "vitest";

/** Banco falso: `chaves_api` (busca pelo hash) e a RPC `api_registrar_uso`. */
const estado = { chave: null as Record<string, unknown> | null, usos: 0, erroRpc: false };

function consulta(resultado: () => unknown) {
  const p: any = {};
  for (const m of ["select", "eq", "is", "order", "limit"]) p[m] = () => p;
  p.maybeSingle = () => Promise.resolve({ data: resultado(), error: null });
  return p;
}

vi.mock("@/src/lib/supabase/admin", () => ({
  dbAdmin: () => ({
    from: () => consulta(() => estado.chave),
    rpc: () => Promise.resolve(estado.erroRpc ? { data: null, error: { message: "x" } } : { data: ++estado.usos, error: null }),
  }),
}));

const executar = vi.fn();
vi.mock("@/src/lib/mcp/ferramentas", () => {
  const ferramentas = [
    { name: "ler", title: "Ler", description: "lê", inputSchema: { type: "object" }, annotations: {}, escrita: false },
    { name: "mudar", title: "Mudar", description: "muda", inputSchema: { type: "object" }, annotations: {}, escrita: true },
  ];
  return {
    listaDeFerramentas: () => ferramentas.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
    acharFerramenta: (n: string) => ferramentas.find((f) => f.name === n),
    chamarFerramenta: async (f: { escrita: boolean }, chave: { permissao: string }, args: unknown) => {
      if (f.escrita && chave.permissao !== "escrita") return { content: [{ type: "text", text: "Esta chave só tem permissão de leitura." }], isError: true };
      return executar(f, chave, args);
    },
  };
});

const CHAVE = "vw_" + "A".repeat(40);

function req(corpo: unknown, cabecalhos: Record<string, string> = {}) {
  return new Request("https://painel.x.com/api/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${CHAVE}`, "content-type": "application/json", ...cabecalhos },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_PAINEL_URL = "https://painel.x.com";
  estado.chave = { id: "c1", nome: "Claude", permissao: "escrita", criada_por: "u1", revogada_em: null, usuarios: { ativo: true, papel: "admin" } };
  estado.usos = 0;
  estado.erroRpc = false;
  executar.mockReset();
  executar.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
});

const servidor = () => import("@/src/lib/mcp/servidor");

describe("POST /api/mcp — autenticação", () => {
  it("sem chave, chave mal formada ou revogada → 401", async () => {
    const { tratarPostMcp } = await servidor();
    expect((await tratarPostMcp(req({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "" }))).status).toBe(401);
    expect((await tratarPostMcp(req({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "Bearer gg_123" }))).status).toBe(401);
    estado.chave = { ...estado.chave!, revogada_em: "2026-10-21T00:00:00Z" };
    expect((await tratarPostMcp(req({ jsonrpc: "2.0", id: 1, method: "ping" }))).status).toBe(401);
  });

  it("chave de quem foi desativado ou virou atendente → 401", async () => {
    const { tratarPostMcp } = await servidor();
    estado.chave = { ...estado.chave!, usuarios: { ativo: false, papel: "admin" } };
    expect((await tratarPostMcp(req({ jsonrpc: "2.0", id: 1, method: "ping" }))).status).toBe(401);
    estado.chave = { ...estado.chave!, usuarios: { ativo: true, papel: "atendente" } };
    expect((await tratarPostMcp(req({ jsonrpc: "2.0", id: 1, method: "ping" }))).status).toBe(401);
  });

  it("acima de 120 chamadas no minuto → 429", async () => {
    const { tratarPostMcp } = await servidor();
    estado.usos = 120;
    const r = await tratarPostMcp(req({ jsonrpc: "2.0", id: 1, method: "ping" }));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
  });

  it("outra origem de navegador → 403", async () => {
    const { tratarPostMcp } = await servidor();
    expect((await tratarPostMcp(req({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://malicioso.com" }))).status).toBe(403);
  });
});

describe("POST /api/mcp — protocolo", () => {
  it("initialize devolve o servidor e as instruções", async () => {
    const { tratarPostMcp } = await servidor();
    const r = await (await tratarPostMcp(req({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }))).json();
    expect(r.result.protocolVersion).toBe("2025-03-26");
    expect(r.result.serverInfo.name).toBe("Vórtex Webinar");
    expect(r.result.instructions).toMatch(/responder_participante/);
  });

  it("tools/list sem os campos internos", async () => {
    const { tratarPostMcp } = await servidor();
    const r = await (await tratarPostMcp(req({ jsonrpc: "2.0", id: 2, method: "tools/list" }))).json();
    expect(r.result.tools.map((t: { name: string }) => t.name)).toEqual(["ler", "mudar"]);
    expect(r.result.tools[0]).not.toHaveProperty("escrita");
  });

  it("tools/call: chave de leitura não roda ferramenta de escrita", async () => {
    const { tratarPostMcp } = await servidor();
    estado.chave = { ...estado.chave!, permissao: "leitura" };
    const r = await (await tratarPostMcp(req({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mudar", arguments: {} } }))).json();
    expect(r.result.isError).toBe(true);
    expect(executar).not.toHaveBeenCalled();
    const ok = await (await tratarPostMcp(req({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "ler", arguments: { a: 1 } } }))).json();
    expect(ok.result.content[0].text).toBe("ok");
    expect(executar.mock.calls[0][1]).toMatchObject({ id: "c1", usuarioId: "u1", permissao: "leitura" });
  });

  it("ferramenta que lança vira isError, sem derrubar a resposta", async () => {
    const { tratarPostMcp } = await servidor();
    executar.mockRejectedValue(new Error("boom"));
    const r = await (await tratarPostMcp(req({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "ler" } }))).json();
    expect(r.result.isError).toBe(true);
  });

  it("ferramenta desconhecida, método desconhecido, JSON inválido e notificação", async () => {
    const { tratarPostMcp } = await servidor();
    expect((await (await tratarPostMcp(req({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "x" } }))).json()).error.code).toBe(-32602);
    expect((await (await tratarPostMcp(req({ jsonrpc: "2.0", id: 7, method: "x" }))).json()).error.code).toBe(-32601);
    expect((await tratarPostMcp(req("{"))).status).toBe(400);
    expect((await tratarPostMcp(req({ jsonrpc: "2.0", method: "notifications/initialized" }))).status).toBe(202);
  });

  it("lote: responde cada requisição e conta uma chamada por requisição", async () => {
    const { tratarPostMcp } = await servidor();
    const r = await (await tratarPostMcp(req([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]))).json();
    expect(r.map((x: { id: number }) => x.id)).toEqual([1, 2]);
    expect(estado.usos).toBe(2);
  });

  it("GET e DELETE → 405", async () => {
    const { metodoNaoPermitido } = await servidor();
    expect(metodoNaoPermitido().status).toBe(405);
  });
});
