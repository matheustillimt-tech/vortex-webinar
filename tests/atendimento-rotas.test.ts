import { beforeEach, describe, expect, it, vi } from "vitest";

const membroApi = vi.fn();
const dbUsuario = vi.fn();
const rpcAdmin = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({
  membroApi: (...a: unknown[]) => membroApi(...a),
  dbUsuario: (...a: unknown[]) => dbUsuario(...a),
}));

vi.mock("@/src/lib/supabase/admin", () => ({
  dbAdmin: () => ({ rpc: (...a: unknown[]) => rpcAdmin(...a), from: (...a: unknown[]) => fromAdmin(...a) }),
}));
const fromAdmin = vi.fn();

const WEB = "11111111-1111-1111-1111-111111111111";
const OUTRO_WEB = "99999999-9999-9999-9999-999999999999";
const SESSAO = "22222222-2222-2222-2222-222222222222";
const EU = { id: "at-1", nome: "Bruno", papel: "atendente" as const };

function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "order"]) p[m] = () => p;
  p.maybeSingle = () => Promise.resolve(resultado);
  return p;
}

beforeEach(() => {
  vi.resetModules();
  membroApi.mockReset();
  dbUsuario.mockReset();
  membroApi.mockResolvedValue(EU);
  rpcAdmin.mockReset();
  rpcAdmin.mockResolvedValue({ data: [{ ao_vivo: 0, replay: 0, desktop: 0, mobile: 0 }], error: null });
  fromAdmin.mockReset();
  fromAdmin.mockImplementation((tabela: string) => {
    const resultado =
      tabela === "webinar_video"
        ? { data: { videos: { duracao_seg: 1000 } }, error: null }
        : { data: [{ id: SESSAO, max_segundo: 250 }], error: null };
    const p: any = Promise.resolve(resultado);
    for (const m of ["select", "eq", "in"]) p[m] = () => p;
    p.maybeSingle = () => Promise.resolve(resultado);
    return p;
  });
});

const LINHA = {
  sessao_id: SESSAO,
  participante_nome: "Ana",
  participante_email: "ana@x.com",
  participante_telefone: null,
  inicio_sessao: "2026-10-20T11:00:00+00:00",
  ultimo_sinal_em: null,
  status_atendimento: "aguardando",
  atendente_id: null,
  atendente_nome: null,
  ultima_texto: "segredo",
  ultima_imagem: false,
  ultima_autor: "atendente",
  ultima_em: "2026-10-20T11:30:00+00:00",
  ultima_apagada: true,
  nao_lidas: 1,
};

describe("GET /api/painel/atendimento/[webinarId]/conversas", () => {
  const params = (webinarId = WEB) => ({ params: Promise.resolve({ webinarId }) });

  it("sem membro: 401 JSON, sem tocar no banco", async () => {
    membroApi.mockResolvedValue(null);
    const { GET } = await import("../app/api/painel/atendimento/[webinarId]/conversas/route");
    const res = await GET(new Request("http://x"), params());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erro: "Acesso negado." });
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("id inválido: 400", async () => {
    const { GET } = await import("../app/api/painel/atendimento/[webinarId]/conversas/route");
    const res = await GET(new Request("http://x"), params("nao-e-uuid"));
    expect(res.status).toBe(400);
  });

  it("uma chamada só à função conversas_atendimento (limite 300), prévia apagada sem conteúdo", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [LINHA], error: null });
    const from = vi.fn();
    dbUsuario.mockResolvedValue({ rpc, from });

    const { GET } = await import("../app/api/painel/atendimento/[webinarId]/conversas/route");
    const res = await GET(new Request("http://x"), params());
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("conversas_atendimento", { p_webinar: WEB, p_limite: 300 });
    expect(from).not.toHaveBeenCalled();
    expect(corpo.conversas).toHaveLength(1);
    expect(corpo.online).toBe(0);
    expect(corpo.conversas[0]).toMatchObject({
      sessaoId: SESSAO,
      nome: "Ana",
      naoLidas: 1,
      online: false,
      inicioSessao: "2026-10-20T11:00:00.000Z",
      ultimaMensagem: { texto: null, temImagem: false, apagada: true, autor: "atendente", criadaEm: "2026-10-20T11:30:00.000Z" },
    });
  });

  it("com ?turma: filtra a turma e devolve a lista de turmas", async () => {
    const rpc = vi.fn((nome: string) =>
      Promise.resolve(nome === "turmas_atendimento" ? { data: [{ turma: "2026-10-23", conversas: 1 }], error: null } : { data: [LINHA], error: null }),
    );
    dbUsuario.mockResolvedValue({ rpc, from: vi.fn() });

    const { GET } = await import("../app/api/painel/atendimento/[webinarId]/conversas/route");
    const corpo = await (await GET(new Request("http://x?turma=2026-10-23"), params())).json();

    expect(rpc).toHaveBeenCalledWith("conversas_atendimento_turma", { p_webinar: WEB, p_turma: "2026-10-23", p_limite: 300 });
    expect(rpc).toHaveBeenCalledWith("turmas_atendimento", { p_webinar: WEB });
    expect(corpo.conversas).toHaveLength(1);
    expect(corpo.turmas).toEqual([{ turma: "2026-10-23", conversas: 1 }]);
    expect(corpo.conversas[0].assistidoPct).toBe(25);
  });

  it("turma inválida: 400", async () => {
    const { GET } = await import("../app/api/painel/atendimento/[webinarId]/conversas/route");
    expect((await GET(new Request("http://x?turma=ontem"), params())).status).toBe(400);
  });

  it("online = todo mundo na sala (ao vivo + replay, mesmo número do painel), não só quem conversa", async () => {
    dbUsuario.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: [LINHA], error: null }) });
    rpcAdmin.mockResolvedValue({ data: [{ ao_vivo: 116, replay: 3, desktop: 50, mobile: 69 }], error: null });
    const { GET } = await import("../app/api/painel/atendimento/[webinarId]/conversas/route");
    const corpo = await (await GET(new Request("http://x"), params())).json();
    expect(rpcAdmin).toHaveBeenCalledWith("metricas_ao_vivo", { p_webinar: WEB });
    expect(corpo.online).toBe(119);
  });

  it("erro do banco: 500 JSON", async () => {
    dbUsuario.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }) });
    const { GET } = await import("../app/api/painel/atendimento/[webinarId]/conversas/route");
    const res = await GET(new Request("http://x"), params());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ erro: "Não deu para carregar as conversas." });
  });
});

describe("GET /api/painel/atendimento/[webinarId]/conversas/[sessaoId]", () => {
  const params = (webinarId = WEB, sessaoId = SESSAO) => ({ params: Promise.resolve({ webinarId, sessaoId }) });

  const SESSAO_LINHA = {
    id: SESSAO,
    webinar_id: WEB,
    inicio_sessao: "2026-10-20T11:00:00+00:00",
    atendente_id: null,
    status_atendimento: "aguardando",
    participantes: { nome: "Ana", email: null, telefone_e164: null },
  };

  function dbCom(sessao: unknown, mensagens: unknown, erroMensagens: unknown = null) {
    return {
      from: (tabela: string) => {
        if (tabela === "sessoes") return { select: () => chain({ data: sessao, error: null }) };
        if (tabela === "mensagens_suporte") return { select: () => chain({ data: mensagens, error: erroMensagens }) };
        throw new Error("tabela inesperada: " + tabela);
      },
    };
  }

  it("sem membro: 401 JSON", async () => {
    membroApi.mockResolvedValue(null);
    const { GET } = await import("../app/api/painel/atendimento/[webinarId]/conversas/[sessaoId]/route");
    const res = await GET(new Request("http://x"), params());
    expect(res.status).toBe(401);
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("mensagem apagada vem sem texto/imagem; nome do atendente de usuarios.nome", async () => {
    dbUsuario.mockResolvedValue(
      dbCom(SESSAO_LINHA, [
        { id: "m1", autor: "participante", autor_id: null, texto: "Oi", imagem_url: null, editada: false, apagada: false, created_at: "2026-10-20T11:01:00+00:00", usuarios: null },
        { id: "m2", autor: "atendente", autor_id: "at-1", texto: "segredo", imagem_url: "https://x/a.png", editada: false, apagada: true, created_at: "2026-10-20T11:02:00+00:00", usuarios: { nome: "Bruno" } },
      ]),
    );
    const { GET } = await import("../app/api/painel/atendimento/[webinarId]/conversas/[sessaoId]/route");
    const res = await GET(new Request("http://x"), params());
    const corpo = await res.json();
    expect(res.status).toBe(200);
    expect(corpo.sessao).toMatchObject({ id: SESSAO, nome: "Ana", inicioSessao: "2026-10-20T11:00:00.000Z" });
    expect(corpo.mensagens[1]).toMatchObject({ id: "m2", texto: null, imagemUrl: null, apagada: true, nomeAutor: "Bruno" });
  });

  it("sessão de outro webinar (ou inexistente): 404", async () => {
    dbUsuario.mockResolvedValue(dbCom({ ...SESSAO_LINHA, webinar_id: OUTRO_WEB }, []));
    const { GET } = await import("../app/api/painel/atendimento/[webinarId]/conversas/[sessaoId]/route");
    expect((await GET(new Request("http://x"), params())).status).toBe(404);

    dbUsuario.mockResolvedValue(dbCom(null, []));
    expect((await GET(new Request("http://x"), params())).status).toBe(404);
  });

  it("erro do banco ao ler as mensagens: 500", async () => {
    dbUsuario.mockResolvedValue(dbCom(SESSAO_LINHA, null, { message: "boom" }));
    const { GET } = await import("../app/api/painel/atendimento/[webinarId]/conversas/[sessaoId]/route");
    expect((await GET(new Request("http://x"), params())).status).toBe(500);
  });
});
