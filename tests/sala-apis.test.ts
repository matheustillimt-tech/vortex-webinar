import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const lerSessaoDoCookie = vi.fn();
const dbAdmin = vi.fn();
const carregarSalaPorId = vi.fn();
const responderComAgente = vi.fn();

vi.mock("@/src/lib/sala/sessao", () => ({
  lerSessaoDoCookie: (...a: unknown[]) => lerSessaoDoCookie(...a),
  // Implementação real: conflito esperado é só o código do Postgres pra unique violada.
  ehConflito: (erro: unknown) => !!erro && typeof erro === "object" && (erro as { code?: string }).code === "23505",
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));
vi.mock("@/src/lib/sala/dados", () => ({ carregarSalaPorId: (...a: unknown[]) => carregarSalaPorId(...a) }));
// A fila de disparos tem os próprios testes (tests/disparos.test.ts); aqui ela só não pode derrubar a rota.
const enfileirarPorEvento = vi.fn();
vi.mock("@/src/lib/disparos", () => ({
  enfileirarPorEvento: (...a: unknown[]) => enfileirarPorEvento(...a),
  enfileirarPermaneceu: vi.fn(),
  eventoDisparaNoTeste: (t: string) => t === "oferta" || t === "clicou_oferta",
}));
// O agente de IA tem os próprios testes (tests/agente.test.ts); aqui só confere que `/api/sala/mensagem` chama
// `after(() => responderComAgente(...))` com os parâmetros certos.
vi.mock("@/src/lib/agente", () => ({ responderComAgente: (...a: unknown[]) => responderComAgente(...a) }));
// `after()` real exige o contexto de requisição do runtime do Next, que estes testes (chamando a rota direto)
// não têm — aqui ele só chama a função na hora, como um `after` "síncrono" o bastante pra testar o parâmetro.
vi.mock("next/server", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("next/server")>();
  return { ...real, after: (fn: () => unknown) => fn() };
});

const WEBINAR_ID = "11111111-1111-1111-1111-111111111111";
const SESSAO_ID = "22222222-2222-2222-2222-222222222222";
const PARTICIPANTE_ID = "33333333-3333-3333-3333-333333333333";

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

/** Builder encadeável (thenable): toda chamada de método devolve o próprio objeto, e aguardar resolve pro
 *  `resultado` passado — cobre `.select().eq()...maybeSingle()`, `.insert().select().single()`,
 *  `.update().eq()` e o `.range()` que o `lerTudo` chama no fim da paginação. */
function chain(resultado: unknown) {
  const p: Record<string, unknown> = Promise.resolve(resultado) as unknown as Record<string, unknown>;
  for (const m of ["select", "eq", "in", "gt", "gte", "lte", "order", "limit", "insert", "update", "single", "maybeSingle", "range"]) {
    p[m] = () => p;
  }
  return p as unknown as Promise<unknown> & Record<string, (...a: unknown[]) => unknown>;
}

/** `from` que devolve, por tabela, uma fila de resultados (consumidos em ordem a cada chamada) — útil quando o
 *  mesmo teste faz mais de uma operação na mesma tabela (ex.: `sinal` primeiro faz `update` em `sessoes`, depois
 *  `insert` em `retencao_sessao`). */
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

function dbFake(mapa: Record<string, unknown[]>, rpc = vi.fn().mockResolvedValue({ data: null, error: null })) {
  return { from: fromDaFila(mapa), rpc };
}

/** `rpc` que responde por nome da função (o que não estiver no mapa devolve `{ data: null, error: null }`). */
function rpcPorNome(mapa: Record<string, unknown>) {
  return vi.fn((nome: string, _args?: unknown) => Promise.resolve(mapa[nome] ?? { data: null, error: null }));
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  lerSessaoDoCookie.mockReset();
  dbAdmin.mockReset();
  carregarSalaPorId.mockReset();
  lerSessaoDoCookie.mockResolvedValue(SESSAO_BASE);
});

function postJson(caminho: string, corpo: unknown): Request {
  return new Request(`https://aovivo.exemplo.com${caminho}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

function postCorpoCru(caminho: string, corpo: string): Request {
  return new Request(`https://aovivo.exemplo.com${caminho}`, { method: "POST", headers: { "content-type": "application/json" }, body: corpo });
}

describe("GET /api/sala/linha-do-tempo", () => {
  it("sem sessão (cookie ausente): 401", async () => {
    lerSessaoDoCookie.mockResolvedValue(null);
    const { GET } = await import("../app/api/sala/linha-do-tempo/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/linha-do-tempo?w=${WEBINAR_ID}&de=0&ate=300`));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erro: "Sessão expirada." });
  });

  it("w não é um UUID: 400, sem consultar sessão", async () => {
    const { GET } = await import("../app/api/sala/linha-do-tempo/route");
    const res = await GET(new NextRequest("https://x.com/api/sala/linha-do-tempo?w=nao-uuid&de=0&ate=300"));
    expect(res.status).toBe(400);
    expect(lerSessaoDoCookie).not.toHaveBeenCalled();
  });

  it("janela inválida (ate - de > 600): 400", async () => {
    const { GET } = await import("../app/api/sala/linha-do-tempo/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/linha-do-tempo?w=${WEBINAR_ID}&de=0&ate=601`));
    expect(res.status).toBe(400);
  });

  it("janela inválida (ate <= de): 400", async () => {
    const { GET } = await import("../app/api/sala/linha-do-tempo/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/linha-do-tempo?w=${WEBINAR_ID}&de=300&ate=300`));
    expect(res.status).toBe(400);
  });

  it("troca #nome/#nomecompleto/#sobrenome pelo nome da sessão; devolve mensagens e vendas ordenadas", async () => {
    dbAdmin.mockReturnValue(
      dbFake({
        mensagens_simuladas: [{ data: [{ segundo: 10, nome: "Clara", texto: "Oi #nome, bem-vindo!", suporte: false }], error: null }],
        vendas_simuladas: [{ data: [{ segundo: 20, texto: "Fulano acabou de comprar" }], error: null }],
      }),
    );
    const { GET } = await import("../app/api/sala/linha-do-tempo/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/linha-do-tempo?w=${WEBINAR_ID}&de=0&ate=300`));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      mensagens: [{ segundo: 10, nome: "Clara", texto: "Oi Ana, bem-vindo!", suporte: false }],
      vendas: [{ segundo: 20, texto: "Fulano acabou de comprar" }],
    });
  });
});

describe("GET /api/sala/linha-do-tempo — cache da janela", () => {
  it("a mesma janela é lida do banco uma vez; o #nome continua sendo o de cada sessão", async () => {
    const db = dbFake({
      mensagens_simuladas: [{ data: [{ segundo: 10, nome: "Clara", texto: "Oi #nome!", suporte: false }], error: null }],
      vendas_simuladas: [{ data: [], error: null }],
    });
    dbAdmin.mockReturnValue(db);
    const { GET } = await import("../app/api/sala/linha-do-tempo/route");
    const url = `https://x.com/api/sala/linha-do-tempo?w=${WEBINAR_ID}&de=0&ate=300`;
    const r1 = await (await GET(new NextRequest(url))).json();
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, participanteNome: "Bruno" });
    const r2 = await (await GET(new NextRequest(url))).json();
    expect(r1.mensagens[0].texto).toBe("Oi Ana!");
    expect(r2.mensagens[0].texto).toBe("Oi Bruno!");
    expect(db.from).toHaveBeenCalledTimes(2); // mensagens + vendas, só na primeira
  });

  it("erro na consulta não fica no cache", async () => {
    const db = dbFake({
      mensagens_simuladas: [{ data: null, error: { message: "timeout" } }, { data: [], error: null }],
      vendas_simuladas: [{ data: [], error: null }],
    });
    dbAdmin.mockReturnValue(db);
    const { GET } = await import("../app/api/sala/linha-do-tempo/route");
    const url = `https://x.com/api/sala/linha-do-tempo?w=${WEBINAR_ID}&de=0&ate=300`;
    await GET(new NextRequest(url));
    await new Promise((r) => setTimeout(r, 0));
    await GET(new NextRequest(url));
    expect(db.from).toHaveBeenCalledTimes(4);
  });
});

describe("GET /api/sala/linha-do-tempo — limites da janela", () => {
  function fromQueRegistra(chamadas: string[]) {
    return vi.fn(() => {
      const p: Record<string, unknown> = Promise.resolve({ data: [], error: null }) as unknown as Record<string, unknown>;
      for (const m of ["select", "eq", "gt", "gte", "lte", "order", "range"]) {
        p[m] = (...a: unknown[]) => {
          if (m === "gt" || m === "gte") chamadas.push(`${m}:${String(a[1])}`);
          return p;
        };
      }
      return p;
    });
  }

  it("de = 0: inclui o segundo 0 (gte 0)", async () => {
    const chamadas: string[] = [];
    dbAdmin.mockReturnValue({ from: fromQueRegistra(chamadas), rpc: vi.fn() });
    const { GET } = await import("../app/api/sala/linha-do-tempo/route");
    const res = await GET(new NextRequest(`https://x.com/api/sala/linha-do-tempo?w=${WEBINAR_ID}&de=0&ate=600`));
    expect(res.status).toBe(200);
    expect(chamadas.length).toBeGreaterThan(0);
    expect(chamadas.every((c) => c === "gte:0")).toBe(true);
  });

  it("de > 0: exclusivo (gt de)", async () => {
    const chamadas: string[] = [];
    dbAdmin.mockReturnValue({ from: fromQueRegistra(chamadas), rpc: vi.fn() });
    const { GET } = await import("../app/api/sala/linha-do-tempo/route");
    await GET(new NextRequest(`https://x.com/api/sala/linha-do-tempo?w=${WEBINAR_ID}&de=300&ate=600`));
    expect(chamadas.length).toBeGreaterThan(0);
    expect(chamadas.every((c) => c === "gt:300")).toBe(true);
  });
});

describe("POST /api/sala/evento", () => {
  it("sem sessão: 401", async () => {
    lerSessaoDoCookie.mockResolvedValue(null);
    const { POST } = await import("../app/api/sala/evento/route");
    const res = await POST(postJson("/api/sala/evento", { w: WEBINAR_ID, tipo: "acessou_sala", segundo: 0 }));
    expect(res.status).toBe(401);
  });

  it("corpo malformado (JSON inválido): 400", async () => {
    const { POST } = await import("../app/api/sala/evento/route");
    const res = await POST(postCorpoCru("/api/sala/evento", "{não é json"));
    expect(res.status).toBe(400);
  });

  it("tipo não aceito: 400", async () => {
    const { POST } = await import("../app/api/sala/evento/route");
    const res = await POST(postJson("/api/sala/evento", { w: WEBINAR_ID, tipo: "comprou", segundo: 10 }));
    expect(res.status).toBe(400);
  });

  it("tipo aceito: grava e devolve 204 (ignora conflito de unique)", async () => {
    dbAdmin.mockReturnValue(dbFake({ eventos: [{ data: null, error: { code: "23505" } }] }));
    const { POST } = await import("../app/api/sala/evento/route");
    const res = await POST(postJson("/api/sala/evento", { w: WEBINAR_ID, tipo: "acessou_sala", segundo: 0 }));
    expect(res.status).toBe(204);
  });

  it("modo teste: 204 sem gravar nada", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, modo: "teste" });
    const { POST } = await import("../app/api/sala/evento/route");
    const res = await POST(postJson("/api/sala/evento", { w: WEBINAR_ID, tipo: "min_15", segundo: 900 }));
    expect(res.status).toBe(204);
    expect(dbAdmin).not.toHaveBeenCalled();
    expect(enfileirarPorEvento).not.toHaveBeenCalled();
  });

  it("modo teste + oferta: 204 sem gravar evento, mas enfileira o webhook", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, modo: "teste" });
    const { POST } = await import("../app/api/sala/evento/route");
    const res = await POST(postJson("/api/sala/evento", { w: WEBINAR_ID, tipo: "oferta", segundo: 4636 }));
    expect(res.status).toBe(204);
    expect(dbAdmin).not.toHaveBeenCalled();
    expect(enfileirarPorEvento).toHaveBeenCalledWith(SESSAO_BASE.sessaoId, SESSAO_BASE.webinarId, "oferta");
  });
});

describe("POST /api/sala/sinal", () => {
  it("sem sessão: 401", async () => {
    lerSessaoDoCookie.mockResolvedValue(null);
    const { POST } = await import("../app/api/sala/sinal/route");
    const res = await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 10 }));
    expect(res.status).toBe(401);
  });

  it("modo teste: 204 sem tocar no banco (nem presença, nem retenção)", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, modo: "teste" });
    const { POST } = await import("../app/api/sala/sinal/route");
    const res = await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 65 }));
    expect(res.status).toBe(204);
    expect(dbAdmin).not.toHaveBeenCalled();
  });

  it("duração do vídeo fica no cache: dois sinais seguidos consultam webinar_video uma vez só", async () => {
    const rpc = rpcPorNome({ registrar_sinal: { data: [{ anterior: 10, atual: 10 }], error: null } });
    const db = dbFake({ webinar_video: [{ data: { videos: { duracao_seg: 1800 } }, error: null }] }, rpc);
    dbAdmin.mockReturnValue(db);
    const { POST } = await import("../app/api/sala/sinal/route");
    expect((await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 10 }))).status).toBe(204);
    expect((await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 10 }))).status).toBe(204);
    expect(db.from.mock.calls.filter(([t]) => t === "webinar_video")).toHaveLength(1);
  });

  it("primeiro sinal no minuto: insere a retenção da sessão e soma em retencao (rpc)", async () => {
    const rpc = rpcPorNome({ registrar_sinal: { data: [{ anterior: 0, atual: 65 }], error: null } });
    dbAdmin.mockReturnValue(
      dbFake(
        {
          webinar_video: [{ data: { videos: { duracao_seg: 1800 } }, error: null }],
          retencao_sessao: [{ data: { id: "r1" }, error: null }],
        },
        rpc,
      ),
    );
    const { POST } = await import("../app/api/sala/sinal/route");
    const res = await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 65 }));
    expect(res.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("somar_retencao", expect.objectContaining({ p_webinar: WEBINAR_ID, p_minuto: 1 }));
  });

  it("grava a retenção no dia de Brasília, não no dia UTC (perto da virada do dia os dois diferem)", async () => {
    // 2026-10-21T02:00:00Z = 2026-10-20T23:00:00 em Brasília (UTC-3): ainda dia 20 lá, já dia 21 em UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T02:00:00.000Z"));
    try {
      const rpc = rpcPorNome({ registrar_sinal: { data: [{ anterior: 0, atual: 65 }], error: null } });
      dbAdmin.mockReturnValue(
        dbFake(
          {
            webinar_video: [{ data: { videos: { duracao_seg: 1800 } }, error: null }],
            retencao_sessao: [{ data: { id: "r1" }, error: null }],
          },
          rpc,
        ),
      );
      const { POST } = await import("../app/api/sala/sinal/route");
      const res = await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 65 }));
      expect(res.status).toBe(204);
      expect(rpc).toHaveBeenCalledWith("somar_retencao", expect.objectContaining({ p_data: "2026-10-20" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("segundo sinal no mesmo minuto (conflito de unique): não chama somar_retencao de novo", async () => {
    const rpc = rpcPorNome({ registrar_sinal: { data: [{ anterior: 0, atual: 65 }], error: null } });
    dbAdmin.mockReturnValue(
      dbFake(
        {
          webinar_video: [{ data: { videos: { duracao_seg: 1800 } }, error: null }],
          retencao_sessao: [{ data: null, error: { code: "23505" } }],
        },
        rpc,
      ),
    );
    const { POST } = await import("../app/api/sala/sinal/route");
    const res = await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 65 }));
    expect(res.status).toBe(204);
    expect(rpc).not.toHaveBeenCalledWith("somar_retencao", expect.anything());
  });

  it("minuto fora do intervalo do vídeo (depois do fim): não grava retenção", async () => {
    const rpc = rpcPorNome({ registrar_sinal: { data: [{ anterior: 0, atual: 65 }], error: null } });
    // duração 1 min -> minuto máximo = 2
    dbAdmin.mockReturnValue(dbFake({ webinar_video: [{ data: { videos: { duracao_seg: 60 } }, error: null }] }, rpc));
    const { POST } = await import("../app/api/sala/sinal/route");
    const res = await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 600 })); // minuto 10 > máximo 2
    expect(res.status).toBe(204);
    expect(rpc).not.toHaveBeenCalledWith("somar_retencao", expect.anything());
  });

  it("replay: chama registrar_sinal com p_replay = true", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, modo: "replay" });
    const rpc = rpcPorNome({ registrar_sinal: { data: [{ anterior: 0, atual: 65 }], error: null } });
    dbAdmin.mockReturnValue(dbFake({ webinar_video: [{ data: { videos: { duracao_seg: 1800 } }, error: null }], retencao_sessao: [{ data: { id: "r1" }, error: null }] }, rpc));
    const { POST } = await import("../app/api/sala/sinal/route");
    const res = await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 65 }));
    expect(res.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("registrar_sinal", { p_sessao: SESSAO_ID, p_segundo: 65, p_replay: true });
  });

  it("segundo maior que a duração do vídeo: limitado à duração antes de gravar e enfileirar", async () => {
    const rpc = rpcPorNome({ registrar_sinal: { data: [{ anterior: 100, atual: 1800 }], error: null } });
    dbAdmin.mockReturnValue(dbFake({ webinar_video: [{ data: { videos: { duracao_seg: 1800 } }, error: null }] }, rpc));
    const { enfileirarPermaneceu } = await import("@/src/lib/disparos");
    const { POST } = await import("../app/api/sala/sinal/route");
    const res = await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 999_999 }));
    expect(res.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("registrar_sinal", { p_sessao: SESSAO_ID, p_segundo: 1800, p_replay: false });
    expect(enfileirarPermaneceu).toHaveBeenCalledWith(expect.objectContaining({ sessaoId: SESSAO_ID }), 1800);
  });

  it("max_segundo não cresceu (sinal repetido/voltou no vídeo): não enfileira permaneceu", async () => {
    const rpc = rpcPorNome({ registrar_sinal: { data: [{ anterior: 300, atual: 300 }], error: null } });
    dbAdmin.mockReturnValue(dbFake({ webinar_video: [{ data: { videos: { duracao_seg: 1800 } }, error: null }], retencao_sessao: [{ data: null, error: { code: "23505" } }] }, rpc));
    const { enfileirarPermaneceu } = await import("@/src/lib/disparos");
    const { POST } = await import("../app/api/sala/sinal/route");
    const res = await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 120 }));
    expect(res.status).toBe(204);
    expect(enfileirarPermaneceu).not.toHaveBeenCalled();
  });

  it("erro ao gravar o sinal: 500", async () => {
    const rpc = rpcPorNome({ registrar_sinal: { data: null, error: { message: "x" } } });
    dbAdmin.mockReturnValue(dbFake({ webinar_video: [{ data: { videos: { duracao_seg: 1800 } }, error: null }] }, rpc));
    const { POST } = await import("../app/api/sala/sinal/route");
    const res = await POST(postJson("/api/sala/sinal", { w: WEBINAR_ID, segundo: 10 }));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/sala/mensagem", () => {
  it("maxDuration = 60 (o agente de IA roda depois da resposta, em after())", async () => {
    const rota = await import("../app/api/sala/mensagem/route");
    expect(rota.maxDuration).toBe(60);
  });

  it("sem sessão: 401", async () => {
    lerSessaoDoCookie.mockResolvedValue(null);
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "Oi" }));
    expect(res.status).toBe(401);
  });

  it("texto vazio: 400", async () => {
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "   " }));
    expect(res.status).toBe(400);
  });

  it("sessão provisória: 403, não chega a consultar o banco", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, temporario: true });
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "Oi" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ erro: "Cadastre-se para enviar mensagens.", precisaCadastro: true });
    expect(dbAdmin).not.toHaveBeenCalled();
  });

  it("sessão de replay: 403 sem pedir cadastro, não consulta o banco", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, modo: "replay" });
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "Oi" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ erro: "Comentários desativados no replay." });
    expect(dbAdmin).not.toHaveBeenCalled();
  });

  it("modo teste: devolve ok com o texto, sem gravar mensagem nem evento", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, modo: "teste" });
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "  Oi teste  " }));
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { id: string; texto: string; criadaEm: string };
    expect(corpo.texto).toBe("Oi teste");
    expect(corpo.id).toMatch(/^teste-/);
    expect(dbAdmin).not.toHaveBeenCalled();
  });

  it("mensagem há menos de 2 s: 429", async () => {
    dbAdmin.mockReturnValue(dbFake({ mensagens_suporte: [{ data: { created_at: new Date().toISOString() }, error: null }] }));
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "Oi de novo" }));
    expect(res.status).toBe(429);
  });

  it("mensagem válida: grava e devolve id/texto/criadaEm", async () => {
    dbAdmin.mockReturnValue(
      dbFake({
        mensagens_suporte: [
          { data: null, error: null },
          { data: { id: "m1", texto: "Oi", created_at: "2026-10-20T10:00:00.000Z" }, error: null },
        ],
        eventos: [{ data: null, error: null }],
        sessoes: [{ data: null, error: null }],
      }),
    );
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "Oi" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: "m1", texto: "Oi", criadaEm: "2026-10-20T10:00:00.000Z" });
    // Depois de gravar, chama o agente de IA.
    expect(responderComAgente).toHaveBeenCalledWith({ sessaoId: SESSAO_ID, webinarId: WEBINAR_ID, texto: "Oi", mensagemId: "m1" });
  });

  it("modo teste: não chama o agente de IA", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, modo: "teste" });
    const { POST } = await import("../app/api/sala/mensagem/route");
    await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "Oi teste" }));
    expect(responderComAgente).not.toHaveBeenCalled();
  });

  it("mensagem nova reabre a conversa já atendida/dispensada: volta pra 'aguardando' sem atendente", async () => {
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    const sessoesChain = () => {
      const p: any = Promise.resolve({ data: null, error: null });
      for (const m of ["update", "eq", "in"]) {
        p[m] = (...args: unknown[]) => {
          chamadas.push({ metodo: m, args });
          return p;
        };
      }
      return p;
    };
    const fila = fromDaFila({
      mensagens_suporte: [
        { data: null, error: null },
        { data: { id: "m1", texto: "Oi", created_at: "2026-10-20T10:00:00.000Z" }, error: null },
      ],
      eventos: [{ data: null, error: null }],
    });
    dbAdmin.mockReturnValue({ from: (t: string) => (t === "sessoes" ? sessoesChain() : fila(t)), rpc: vi.fn() });

    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "Oi" }));

    expect(res.status).toBe(200);
    expect(chamadas).toEqual([
      { metodo: "update", args: [{ status_atendimento: "aguardando", atendente_id: null }] },
      { metodo: "eq", args: ["id", SESSAO_ID] },
      { metodo: "in", args: ["status_atendimento", ["atendido", "dispensado"]] },
    ]);
  });

  it("falha ao reabrir a conversa não derruba a mensagem (já gravada)", async () => {
    dbAdmin.mockReturnValue(
      dbFake({
        mensagens_suporte: [
          { data: null, error: null },
          { data: { id: "m1", texto: "Oi", created_at: "2026-10-20T10:00:00.000Z" }, error: null },
        ],
        eventos: [{ data: null, error: null }],
        sessoes: [{ data: null, error: { message: "boom" } }],
      }),
    );
    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "Oi" }));
    expect(res.status).toBe(200);
  });

  it("chatbot descontinuado: mesmo com respostaChatbot (cliente antigo), só grava a mensagem e quem responde é o agente de IA", async () => {
    const mensagensChain = { insertadas: [] as unknown[] };
    const fromMock = vi.fn((tabela: string) => {
      if (tabela === "mensagens_suporte") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }) }),
          insert: (valores: unknown) => {
            mensagensChain.insertadas.push(valores);
            return { select: () => ({ single: () => Promise.resolve({ data: { id: "m1", texto: "Qual o preço?", created_at: "2026-10-20T10:00:00.000Z" }, error: null }) }) };
          },
        };
      }
      if (tabela === "eventos" || tabela === "sessoes") return chain({ data: null, error: null });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    dbAdmin.mockReturnValue({ from: fromMock, rpc: vi.fn() });

    const { POST } = await import("../app/api/sala/mensagem/route");
    const res = await POST(postJson("/api/sala/mensagem", { w: WEBINAR_ID, texto: "Qual o preço?", respostaChatbot: true }));
    expect(res.status).toBe(200);
    expect(mensagensChain.insertadas).toEqual([
      expect.objectContaining({ autor: "participante", texto: "Qual o preço?" }),
    ]);
    expect(responderComAgente).toHaveBeenCalledWith({
      sessaoId: SESSAO_ID,
      webinarId: WEBINAR_ID,
      texto: "Qual o preço?",
      mensagemId: "m1",
    });
  });
});

describe("POST /api/sala/cadastro", () => {
  it("sem sessão: 401", async () => {
    lerSessaoDoCookie.mockResolvedValue(null);
    const { POST } = await import("../app/api/sala/cadastro/route");
    const res = await POST(postJson("/api/sala/cadastro", { w: WEBINAR_ID, nome: "Ana" }));
    expect(res.status).toBe(401);
  });

  it("sessão já cadastrada (não provisória): 409, não chega a consultar a sala nem o banco", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, temporario: false });
    const { POST } = await import("../app/api/sala/cadastro/route");
    const res = await POST(postJson("/api/sala/cadastro", { w: WEBINAR_ID, nome: "Outro Nome" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ erro: "Seu cadastro já está feito." });
    expect(carregarSalaPorId).not.toHaveBeenCalled();
    expect(dbAdmin).not.toHaveBeenCalled();
  });

  it("nome vazio (regras da tela de login): 400 com a mensagem de validarCadastro", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, temporario: true });
    carregarSalaPorId.mockResolvedValue({ telaLogin: { pedeEmail: true, emailObrigatorio: true, pedeTelefone: false, telefoneObrigatorio: false, paisPadrao: "BR" } });
    const { POST } = await import("../app/api/sala/cadastro/route");
    const res = await POST(postJson("/api/sala/cadastro", { w: WEBINAR_ID, nome: "", email: "ana@x.com" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erro: "Informe seu nome." });
  });

  it("dados válidos: completa o participante, marca temporario=false e grava fez_login", async () => {
    lerSessaoDoCookie.mockResolvedValue({ ...SESSAO_BASE, temporario: true });
    carregarSalaPorId.mockResolvedValue({ telaLogin: { pedeEmail: true, emailObrigatorio: true, pedeTelefone: false, telefoneObrigatorio: false, paisPadrao: "BR" } });
    const updateSpy = vi.fn(() => ({ eq: () => Promise.resolve({ data: null, error: null }) }));
    const fromMock = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { update: updateSpy };
      if (tabela === "eventos" || tabela === "sessoes") return chain({ data: null, error: null });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    dbAdmin.mockReturnValue({ from: fromMock, rpc: vi.fn() });

    const { POST } = await import("../app/api/sala/cadastro/route");
    const res = await POST(postJson("/api/sala/cadastro", { w: WEBINAR_ID, nome: "Ana", email: "ana@x.com" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, nome: "Ana" });
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ nome: "Ana", email: "ana@x.com", temporario: false }));
  });
});
