import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const lerSessaoDoCookie = vi.fn();
const dbAdmin = vi.fn();
const enviarImagem = vi.fn();

vi.mock("@/src/lib/sala/sessao", () => ({
  lerSessaoDoCookie: (...a: unknown[]) => lerSessaoDoCookie(...a),
  ehConflito: (erro: unknown) => !!erro && typeof erro === "object" && (erro as { code?: string }).code === "23505",
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));
vi.mock("@/src/lib/midias", () => ({ enviarImagem: (...a: unknown[]) => enviarImagem(...a) }));

const WEBINAR_ID = "11111111-1111-1111-1111-111111111111";
const SESSAO_ID = "22222222-2222-2222-2222-222222222222";
const PARTICIPANTE_ID = "33333333-3333-3333-3333-333333333333";
const SUPABASE_URL = "https://proj.supabase.co";

const SESSAO_BASE = {
  sessaoId: SESSAO_ID,
  webinarId: WEBINAR_ID,
  participanteId: PARTICIPANTE_ID,
  participanteNome: "Ana Souza",
  temporario: false,
  modo: "ao_vivo" as const,
  inicioSessao: new Date("2026-10-20T10:00:00.000Z"),
  utms: {},
};

function chain(resultado: unknown) {
  const p: Record<string, unknown> = Promise.resolve(resultado) as unknown as Record<string, unknown>;
  for (const m of ["select", "eq", "in", "gt", "gte", "lte", "or", "order", "limit", "not", "insert", "update", "single", "maybeSingle", "range"]) {
    p[m] = () => p;
  }
  return p as unknown as Promise<unknown> & Record<string, (...a: unknown[]) => unknown>;
}

function fromDaFila(mapa: Record<string, unknown[]>) {
  const indices: Record<string, number> = {};
  return vi.fn((tabela: string) => {
    if (!(tabela in mapa)) throw new Error(`tabela inesperada no teste: ${tabela}`);
    const fila = mapa[tabela];
    const i = Math.min(indices[tabela] ?? 0, fila.length - 1);
    indices[tabela] = (indices[tabela] ?? 0) + 1;
    return chain(fila[i]);
  });
}

function dbFake(mapa: Record<string, unknown[]>) {
  return { from: fromDaFila(mapa), rpc: vi.fn() };
}

beforeEach(() => {
  vi.resetModules();
  lerSessaoDoCookie.mockReset();
  dbAdmin.mockReset();
  enviarImagem.mockReset();
  lerSessaoDoCookie.mockResolvedValue(SESSAO_BASE);
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
});

function postJson(caminho: string, corpo: unknown): Request {
  return new Request(`https://aovivo.exemplo.com${caminho}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

function postFormData(caminho: string, campos: Record<string, string | File>): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  return new Request(`https://aovivo.exemplo.com${caminho}`, { method: "POST", body: fd });
}

function arquivoFalso(bytes = 1000): File {
  return new File([new Uint8Array(bytes)], "foto.jpg", { type: "image/jpeg" });
}

describe("GET /api/sala/suporte", () => {
  it("sem sessão: 401", async () => {
    lerSessaoDoCookie.mockResolvedValue(null);
    const { GET } = await import("../app/api/sala/suporte/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/suporte?w=${WEBINAR_ID}`));
    expect(res.status).toBe(401);
  });

  it("w inválido: 400, sem consultar sessão", async () => {
    const { GET } = await import("../app/api/sala/suporte/route");
    const res = await GET(new NextRequest("https://x.com/api/sala/suporte?w=nao-uuid"));
    expect(res.status).toBe(400);
    expect(lerSessaoDoCookie).not.toHaveBeenCalled();
  });

  it("desde inválido: 400", async () => {
    const { GET } = await import("../app/api/sala/suporte/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/suporte?w=${WEBINAR_ID}&desde=nao-data`));
    expect(res.status).toBe(400);
  });

  it("desde válido: filtra updated_at > a string original (microssegundos do Postgres preservados)", async () => {
    const chamadasGt: unknown[][] = [];
    const p: any = Promise.resolve({ data: [], error: null });
    for (const m of ["select", "eq", "order"]) p[m] = () => p;
    p.gt = (...args: unknown[]) => {
      chamadasGt.push(args);
      return p;
    };
    dbAdmin.mockReturnValue({ from: () => p });

    const desde = "2026-10-20T10:00:00.123456+00:00";
    const { GET } = await import("../app/api/sala/suporte/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/suporte?w=${WEBINAR_ID}&desde=${encodeURIComponent(desde)}`));

    expect(res.status).toBe(200);
    expect(chamadasGt).toEqual([["updated_at", desde]]);
  });

  it("modo teste: lista vazia, sem consultar o banco", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, modo: "teste" });
    const { GET } = await import("../app/api/sala/suporte/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/suporte?w=${WEBINAR_ID}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mensagens: [] });
    expect(dbAdmin).not.toHaveBeenCalled();
  });

  it("mensagem apagada: texto e imagemUrl nulos mesmo que o banco ainda tenha o valor antigo", async () => {
    dbAdmin.mockReturnValue(
      dbFake({
        mensagens_suporte: [
          {
            data: [
              {
                id: "m1",
                autor: "participante",
                autor_id: null,
                texto: "oi",
                imagem_url: null,
                editada: false,
                apagada: true,
                created_at: "2026-10-20T10:00:00.000Z",
                updated_at: "2026-10-20T10:00:05.000Z",
                usuarios: null,
              },
            ],
            error: null,
          },
        ],
      }),
    );
    const { GET } = await import("../app/api/sala/suporte/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/suporte?w=${WEBINAR_ID}`));
    const corpo = await res.json();
    expect(corpo.mensagens[0]).toMatchObject({ texto: null, imagemUrl: null, apagada: true, nomeAutor: null });
  });

  it("atendente: sai com o nome do agente do webinar (a equipe), não o do atendente", async () => {
    dbAdmin.mockReturnValue(
      dbFake({
        mensagens_suporte: [
          {
            data: [
              {
                id: "m1",
                autor: "atendente",
                autor_id: "u1",
                texto: "Já te ajudo",
                imagem_url: null,
                editada: false,
                apagada: false,
                created_at: "2026-10-20T10:00:00.000Z",
                updated_at: "2026-10-20T10:00:00.000Z",
                usuarios: { nome: "Clara" },
              },
            ],
            error: null,
          },
        ],
        agentes_ia: [{ data: { nome: "Equipe Sua Empresa" }, error: null }],
      }),
    );
    const { GET } = await import("../app/api/sala/suporte/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/suporte?w=${WEBINAR_ID}`));
    const corpo = await res.json();
    expect(corpo.mensagens[0].nomeAutor).toBe("Equipe Sua Empresa");
  });

it("atendente sem agente configurado: cai no nome do atendente (usuarios.nome)", async () => {
    dbAdmin.mockReturnValue(
      dbFake({
        mensagens_suporte: [
          {
            data: [
              {
                id: "m1",
                autor: "atendente",
                autor_id: "u1",
                texto: "Já te ajudo",
                imagem_url: null,
                editada: false,
                apagada: false,
                created_at: "2026-10-20T10:00:00.000Z",
                updated_at: "2026-10-20T10:00:00.000Z",
                usuarios: { nome: "Clara" },
              },
            ],
            error: null,
          },
        ],
        agentes_ia: [{ data: null, error: null }],
      }),
    );
    const { GET } = await import("../app/api/sala/suporte/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/suporte?w=${WEBINAR_ID}`));
    const corpo = await res.json();
    expect(corpo.mensagens[0].nomeAutor).toBe("Clara");
  });

  it("chatbot antigo (descontinuado): sem nomeAutor, nem consulta a tabela chatbot", async () => {
    dbAdmin.mockReturnValue(
      dbFake({
        mensagens_suporte: [
          {
            data: [
              {
                id: "m1",
                autor: "chatbot",
                autor_id: null,
                texto: "Já te mando o link!",
                imagem_url: null,
                editada: false,
                apagada: false,
                created_at: "2026-10-20T10:00:00.000Z",
                updated_at: "2026-10-20T10:00:00.000Z",
                usuarios: null,
              },
            ],
            error: null,
          },
        ],
      }),
    );
    const { GET } = await import("../app/api/sala/suporte/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/suporte?w=${WEBINAR_ID}`));
    const corpo = await res.json();
    expect(corpo.mensagens[0].nomeAutor).toBeNull();
  });

  it("ia: nomeAutor vem de agentes_ia.nome", async () => {
    dbAdmin.mockReturnValue(
      dbFake({
        mensagens_suporte: [
          {
            data: [
              {
                id: "m1",
                autor: "ia",
                autor_id: null,
                texto: "Oi, posso ajudar?",
                imagem_url: null,
                editada: false,
                apagada: false,
                created_at: "2026-10-20T10:00:00.000Z",
                updated_at: "2026-10-20T10:00:00.000Z",
                usuarios: null,
              },
            ],
            error: null,
          },
        ],
        agentes_ia: [{ data: { nome: "Nova" }, error: null }],
      }),
    );
    const { GET } = await import("../app/api/sala/suporte/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/suporte?w=${WEBINAR_ID}`));
    const corpo = await res.json();
    expect(corpo.mensagens[0].nomeAutor).toBe("Nova");
  });
});

describe("POST /api/sala/imagem", () => {
  it("sem sessão: 401", async () => {
    lerSessaoDoCookie.mockResolvedValue(null);
    const { POST } = await import("../app/api/sala/imagem/route");
    const res = await POST(postFormData("/api/sala/imagem", { w: WEBINAR_ID, arquivo: arquivoFalso() }));
    expect(res.status).toBe(401);
  });

  it("sessão de replay: 403, não chama enviarImagem", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, modo: "replay" });
    const { POST } = await import("../app/api/sala/imagem/route");
    const res = await POST(postFormData("/api/sala/imagem", { w: WEBINAR_ID, arquivo: arquivoFalso() }));
    expect(res.status).toBe(403);
    expect(enviarImagem).not.toHaveBeenCalled();
  });

  it("sessão provisória: 403 com precisaCadastro", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, temporario: true });
    const { POST } = await import("../app/api/sala/imagem/route");
    const res = await POST(postFormData("/api/sala/imagem", { w: WEBINAR_ID, arquivo: arquivoFalso() }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ erro: "Cadastre-se para enviar mensagens.", precisaCadastro: true });
  });

  it("modo teste: devolve uma url sem chamar o banco nem o storage", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, modo: "teste" });
    const { POST } = await import("../app/api/sala/imagem/route");
    const res = await POST(postFormData("/api/sala/imagem", { w: WEBINAR_ID, arquivo: arquivoFalso() }));
    expect(res.status).toBe(200);
    expect(dbAdmin).not.toHaveBeenCalled();
    expect(enviarImagem).not.toHaveBeenCalled();
  });

  it("sem arquivo: 400", async () => {
    const { POST } = await import("../app/api/sala/imagem/route");
    const res = await POST(postFormData("/api/sala/imagem", { w: WEBINAR_ID }));
    expect(res.status).toBe(400);
  });

  it("update atômico não libera (0 linhas: já tinha imagem há menos de 10 s): 429, sem subir a imagem", async () => {
    dbAdmin.mockReturnValue(dbFake({ sessoes: [{ data: [], error: null }] }));
    const { POST } = await import("../app/api/sala/imagem/route");
    const res = await POST(postFormData("/api/sala/imagem", { w: WEBINAR_ID, arquivo: arquivoFalso() }));
    expect(res.status).toBe(429);
    expect(enviarImagem).not.toHaveBeenCalled();
  });

  it("update atômico falha: 500, sem subir a imagem", async () => {
    dbAdmin.mockReturnValue(dbFake({ sessoes: [{ data: null, error: { message: "boom" } }] }));
    const { POST } = await import("../app/api/sala/imagem/route");
    const res = await POST(postFormData("/api/sala/imagem", { w: WEBINAR_ID, arquivo: arquivoFalso() }));
    expect(res.status).toBe(500);
    expect(enviarImagem).not.toHaveBeenCalled();
  });

  it("upload ok: devolve a url do enviarImagem com a pasta chat", async () => {
    dbAdmin.mockReturnValue(dbFake({ sessoes: [{ data: [{ id: SESSAO_ID }], error: null }] }));
    enviarImagem.mockResolvedValue({ url: `${SUPABASE_URL}/storage/v1/object/public/midias/webinars/${WEBINAR_ID}/chat/abc.jpg` });
    const { POST } = await import("../app/api/sala/imagem/route");
    const res = await POST(postFormData("/api/sala/imagem", { w: WEBINAR_ID, arquivo: arquivoFalso() }));
    expect(res.status).toBe(200);
    expect(enviarImagem).toHaveBeenCalledWith(WEBINAR_ID, expect.anything(), "chat");
    expect(await res.json()).toEqual({ url: `${SUPABASE_URL}/storage/v1/object/public/midias/webinars/${WEBINAR_ID}/chat/abc.jpg` });
  });

  it("5 uploads rápidos na mesma sessão: o update atômico só libera o primeiro (nunca duas corridas passam)", async () => {
    dbAdmin.mockReturnValue(
      dbFake({
        sessoes: [
          { data: [{ id: SESSAO_ID }], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ],
      }),
    );
    enviarImagem.mockResolvedValue({ url: `${SUPABASE_URL}/storage/v1/object/public/midias/webinars/${WEBINAR_ID}/chat/abc.jpg` });
    const { POST } = await import("../app/api/sala/imagem/route");

    const status: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await POST(postFormData("/api/sala/imagem", { w: WEBINAR_ID, arquivo: arquivoFalso() }));
      status.push(res.status);
    }

    expect(status).toEqual([200, 429, 429, 429, 429]);
    expect(enviarImagem).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/sala/mensagem com imagemUrl", () => {
  it("imagemUrl de outro webinar/host: 400, não chega a consultar o banco", async () => {
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "", imagemUrl: "https://outro.com/x.jpg" }));
    expect(res.status).toBe(400);
    expect(dbAdmin).not.toHaveBeenCalled();
  });

  it("texto vazio sem imagemUrl: 400", async () => {
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "" }));
    expect(res.status).toBe(400);
  });

  it("imagemUrl válida com texto vazio: grava e devolve imagemUrl", async () => {
    dbAdmin.mockReturnValue(
      dbFake({
        mensagens_suporte: [
          { data: null, error: null },
          { data: { id: "m1", texto: null, imagem_url: `${SUPABASE_URL}/storage/v1/object/public/midias/webinars/${WEBINAR_ID}/chat/abc.jpg`, created_at: "2026-10-20T10:00:00.000Z" }, error: null },
        ],
        eventos: [{ data: null, error: null }],
        sessoes: [{ data: null, error: null }],
      }),
    );
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(
      postJson("/api/sala/mensagem", {
        w: WEBINAR_ID,
        texto: "",
        imagemUrl: `${SUPABASE_URL}/storage/v1/object/public/midias/webinars/${WEBINAR_ID}/chat/abc.jpg`,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "m1",
      texto: null,
      imagemUrl: `${SUPABASE_URL}/storage/v1/object/public/midias/webinars/${WEBINAR_ID}/chat/abc.jpg`,
      criadaEm: "2026-10-20T10:00:00.000Z",
    });
  });

  it("modo teste com imagemUrl de teste (não bate no bucket real): 200, ecoa sem validar nem gravar", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, modo: "teste" });
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(
      postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "", imagemUrl: "https://teste.local/midias/imagem-de-teste.jpg" }),
    );
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { id: string; texto: string | null; imagemUrl: string | null };
    expect(corpo.imagemUrl).toBe("https://teste.local/midias/imagem-de-teste.jpg");
    expect(corpo.id).toMatch(/^teste-/);
    expect(dbAdmin).not.toHaveBeenCalled();
  });
});
