import { beforeEach, describe, expect, it, vi } from "vitest";

const membroApi = vi.fn();
const dbUsuario = vi.fn();
const gerarXlsx = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({
  dbUsuario: (...a: unknown[]) => dbUsuario(...a),
  membroApi: (...a: unknown[]) => membroApi(...a),
}));
vi.mock("@/src/lib/planilha", () => ({ gerarXlsx: (...a: unknown[]) => gerarXlsx(...a) }));

/** Chain estilo Supabase que resolve pro `resultado` dado, aceitando qualquer método encadeado. */
function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "neq", "gte", "lt", "order", "maybeSingle"]) p[m] = () => p;
  return p;
}

/** Builder de uma tabela com várias linhas, pra `lerTudo` paginar via `.range`. */
function construtorMultiplo(linhas: unknown[], opts: { falhar?: boolean } = {}) {
  const nodo: any = {};
  for (const m of ["select", "eq", "neq", "gte", "lt", "order"]) nodo[m] = () => nodo;
  nodo.range = (desde: number, ate: number) => {
    if (opts.falhar) return Promise.resolve({ data: null, error: { message: "falhou" } });
    return Promise.resolve({ data: linhas.slice(desde, ate + 1), error: null });
  };
  return nodo;
}

function req(url: string): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.resetModules();
  membroApi.mockReset();
  dbUsuario.mockReset();
  gerarXlsx.mockReset();
  gerarXlsx.mockResolvedValue(Buffer.from("xlsx"));
});

describe("GET /api/webinars/[id]/exportar/[tipo] — acesso", () => {
  it("sem login: 401, sem bater no banco", async () => {
    membroApi.mockResolvedValue(null);
    const { GET } = await import("../app/api/webinars/[id]/exportar/[tipo]/route");
    const res = await GET(req("https://x/api/webinars/w1/exportar/participantes"), {
      params: Promise.resolve({ id: "w1", tipo: "participantes" }),
    });
    expect(res.status).toBe(401);
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("logado mas não admin: 403 (Revisão final: só sem login é 401)", async () => {
    membroApi.mockResolvedValue({ id: "u1", nome: "Fulano", papel: "atendente" });
    const { GET } = await import("../app/api/webinars/[id]/exportar/[tipo]/route");
    const res = await GET(req("https://x/api/webinars/w1/exportar/participantes"), {
      params: Promise.resolve({ id: "w1", tipo: "participantes" }),
    });
    expect(res.status).toBe(403);
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("tipo inválido: 400", async () => {
    membroApi.mockResolvedValue({ id: "u1", nome: "Admin", papel: "admin" });
    const { GET } = await import("../app/api/webinars/[id]/exportar/[tipo]/route");
    const res = await GET(req("https://x/api/webinars/w1/exportar/banana"), {
      params: Promise.resolve({ id: "w1", tipo: "banana" }),
    });
    expect(res.status).toBe(400);
  });

  it("webinar inexistente: 404", async () => {
    membroApi.mockResolvedValue({ id: "u1", nome: "Admin", papel: "admin" });
    const from = vi.fn((tabela: string) => {
      if (tabela === "webinars") return chain({ data: null, error: null });
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });
    const { GET } = await import("../app/api/webinars/[id]/exportar/[tipo]/route");
    const res = await GET(req("https://x/api/webinars/w1/exportar/participantes"), {
      params: Promise.resolve({ id: "w1", tipo: "participantes" }),
    });
    expect(res.status).toBe(404);
  });

  it("momento sem ?eventos: 400", async () => {
    membroApi.mockResolvedValue({ id: "u1", nome: "Admin", papel: "admin" });
    dbUsuario.mockResolvedValue({ from: vi.fn() });
    const { GET } = await import("../app/api/webinars/[id]/exportar/[tipo]/route");
    const res = await GET(req("https://x/api/webinars/w1/exportar/momento"), {
      params: Promise.resolve({ id: "w1", tipo: "momento" }),
    });
    expect(res.status).toBe(400);
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("momento com mais de 2 eventos: 400", async () => {
    membroApi.mockResolvedValue({ id: "u1", nome: "Admin", papel: "admin" });
    dbUsuario.mockResolvedValue({ from: vi.fn() });
    const { GET } = await import("../app/api/webinars/[id]/exportar/[tipo]/route");
    const res = await GET(req("https://x/api/webinars/w1/exportar/momento?eventos=pitch,oferta,comprou"), {
      params: Promise.resolve({ id: "w1", tipo: "momento" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET — cada tipo monta as colunas certas", () => {
  beforeEach(() => {
    membroApi.mockResolvedValue({ id: "u1", nome: "Admin", papel: "admin" });
  });

  it("participantes: lê sessões paginadas e monta as 16 colunas", async () => {
    const SESSOES = [
      {
        id: "s1",
        entrou_em: "2026-10-21T15:00:00.000Z",
        modo: "ao_vivo",
        max_segundo: 120,
        pais: "Brasil",
        cidade: "SP",
        dispositivo: "desktop",
        utms: { utm_source: "meta" },
        participantes: { nome: "Ana", email: "ana@x.com", telefone_e164: "+5511999999999" },
        eventos: [{ tipo: "acessou_sala" }, { tipo: "comprou" }],
      },
    ];
    const from = vi.fn((tabela: string) => {
      if (tabela === "webinars") return chain({ data: { slug: "aula" }, error: null });
      if (tabela === "sessoes") return construtorMultiplo(SESSOES);
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { GET } = await import("../app/api/webinars/[id]/exportar/[tipo]/route");
    const res = await GET(req("https://x/api/webinars/w1/exportar/participantes"), {
      params: Promise.resolve({ id: "w1", tipo: "participantes" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("participantes-aula-");
    const linhas = gerarXlsx.mock.calls[0][0] as unknown[][];
    expect(linhas[0]).toHaveLength(16);
    expect(linhas[1][0]).toBe("Ana");
    expect(linhas[1].at(-1)).toBe("Sim"); // comprou
  });

  it("momento: só exporta quem tem todos os eventos pedidos", async () => {
    const SESSOES = [
      {
        id: "s1",
        entrou_em: "2026-10-21T15:00:00.000Z",
        modo: "ao_vivo",
        max_segundo: 120,
        pais: null,
        cidade: null,
        dispositivo: "desktop",
        utms: {},
        participantes: { nome: "Ana", email: null, telefone_e164: null },
        eventos: [{ tipo: "pitch" }, { tipo: "oferta" }],
      },
      {
        id: "s2",
        entrou_em: "2026-10-21T15:00:00.000Z",
        modo: "ao_vivo",
        max_segundo: 60,
        pais: null,
        cidade: null,
        dispositivo: "mobile",
        utms: {},
        participantes: { nome: "Bruno", email: null, telefone_e164: null },
        eventos: [{ tipo: "pitch" }],
      },
    ];
    const from = vi.fn((tabela: string) => {
      if (tabela === "webinars") return chain({ data: { slug: "aula" }, error: null });
      if (tabela === "sessoes") return construtorMultiplo(SESSOES);
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { GET } = await import("../app/api/webinars/[id]/exportar/[tipo]/route");
    const res = await GET(req("https://x/api/webinars/w1/exportar/momento?eventos=pitch,oferta"), {
      params: Promise.resolve({ id: "w1", tipo: "momento" }),
    });

    expect(res.status).toBe(200);
    const linhas = gerarXlsx.mock.calls[0][0] as unknown[][];
    expect(linhas).toHaveLength(2); // cabeçalho + Ana só
    expect(linhas[1][0]).toBe("Ana");
  });

  it("conversas: monta as 6 colunas, mensagem apagada mascarada", async () => {
    const MENSAGENS = [
      {
        id: "m1",
        created_at: "2026-10-21T15:00:00.000Z",
        autor: "atendente",
        texto: "Segredo",
        imagem_url: null,
        apagada: true,
        usuarios: { nome: "Bruno" },
        sessoes: { participantes: { nome: "Ana", email: "ana@x.com" } },
      },
    ];
    const from = vi.fn((tabela: string) => {
      if (tabela === "webinars") return chain({ data: { slug: "aula" }, error: null });
      if (tabela === "mensagens_suporte") return construtorMultiplo(MENSAGENS);
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { GET } = await import("../app/api/webinars/[id]/exportar/[tipo]/route");
    const res = await GET(req("https://x/api/webinars/w1/exportar/conversas"), {
      params: Promise.resolve({ id: "w1", tipo: "conversas" }),
    });

    expect(res.status).toBe(200);
    const linhas = gerarXlsx.mock.calls[0][0] as unknown[][];
    expect(linhas[0]).toHaveLength(6);
    expect(linhas[1][3]).toBe("Atendente Bruno");
    expect(linhas[1][4]).toBe("[apagada]");
  });

  it("vendas: monta as 6 colunas, casada com sessão quando tem sessao_id", async () => {
    const VENDAS = [
      {
        id: "v1",
        created_at: "2026-10-21T15:00:00.000Z",
        plataforma: "hotmart",
        id_transacao: "T1",
        valor_centavos: 19700,
        comprador_email: "ana@x.com",
        sessao_id: "s1",
      },
    ];
    const from = vi.fn((tabela: string) => {
      if (tabela === "webinars") return chain({ data: { slug: "aula" }, error: null });
      if (tabela === "vendas") return construtorMultiplo(VENDAS);
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { GET } = await import("../app/api/webinars/[id]/exportar/[tipo]/route");
    const res = await GET(req("https://x/api/webinars/w1/exportar/vendas"), {
      params: Promise.resolve({ id: "w1", tipo: "vendas" }),
    });

    expect(res.status).toBe(200);
    const linhas = gerarXlsx.mock.calls[0][0] as unknown[][];
    expect(linhas[0]).toHaveLength(6);
    expect(linhas[1][2]).toBe("T1");
    expect(linhas[1][3]).toBe(197); // número em reais, não texto (Revisão final)
    expect(linhas[1].at(-1)).toBe("Sim");
    // Pede o formato de moeda pra coluna "Valor" (4ª) no gerarXlsx.
    expect(gerarXlsx.mock.calls[0][1]).toEqual({ 4: "R$ #,##0.00" });
  });

  it("erro no meio da paginação: 500, sem gerar arquivo parcial", async () => {
    const SESSOES = Array.from({ length: 1500 }, (_, i) => ({
      id: `s${i}`,
      entrou_em: "2026-10-21T15:00:00.000Z",
      modo: "ao_vivo",
      max_segundo: 0,
      pais: null,
      cidade: null,
      dispositivo: null,
      utms: {},
      participantes: { nome: "Ana", email: null, telefone_e164: null },
      eventos: [],
    }));
    let chamadas = 0;
    const from = vi.fn((tabela: string) => {
      if (tabela === "webinars") return chain({ data: { slug: "aula" }, error: null });
      if (tabela === "sessoes") return construtorMultiplo(SESSOES, { falhar: chamadas++ === 1 });
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { GET } = await import("../app/api/webinars/[id]/exportar/[tipo]/route");
    const res = await GET(req("https://x/api/webinars/w1/exportar/participantes"), {
      params: Promise.resolve({ id: "w1", tipo: "participantes" }),
    });

    expect(res.status).toBe(500);
    expect(gerarXlsx).not.toHaveBeenCalled();
  });
});
