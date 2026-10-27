import { beforeEach, describe, expect, it, vi } from "vitest";

const dbAdmin = vi.fn();
const bunnyConfig = vi.fn();
const env = vi.fn();
const envOpcional = vi.fn();
const cookiesMock = vi.fn();

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));
// A fila de disparos tem os próprios testes (tests/disparos.test.ts); aqui ela só não pode derrubar criarSessao.
vi.mock("@/src/lib/disparos", () => ({ enfileirarPorEvento: vi.fn() }));
vi.mock("@/src/lib/env", () => ({
  bunnyConfig: (...a: unknown[]) => bunnyConfig(...a),
  env: (...a: unknown[]) => env(...a),
  envOpcional: (...a: unknown[]) => envOpcional(...a),
}));
vi.mock("next/headers", () => ({ cookies: (...a: unknown[]) => cookiesMock(...a) }));

const SEGREDO = "segredo-teste";

/** Resolve pro `resultado` dado em qualquer ponto da cadeia (`.select().eq()...` ou `.range()` do `lerTudo`). */
function chain(resultado: unknown) {
  const p: Record<string, unknown> = Promise.resolve(resultado) as unknown as Record<string, unknown>;
  for (const m of ["select", "eq", "ilike", "gt", "order", "insert", "single", "maybeSingle", "range"]) {
    p[m] = () => p;
  }
  return p as unknown as Promise<unknown> & Record<string, (...a: unknown[]) => unknown>;
}

/** `from` que resolve cada tabela a partir de um mapa simples {tabela: resultado}. */
function fromDoMapa(mapa: Record<string, unknown>) {
  return vi.fn((tabela: string) => {
    if (!(tabela in mapa)) throw new Error(`tabela inesperada no teste: ${tabela}`);
    return chain(mapa[tabela]);
  });
}

beforeEach(() => {
  vi.resetModules();
  dbAdmin.mockReset();
  bunnyConfig.mockReset();
  env.mockReset();
  envOpcional.mockReset();
  cookiesMock.mockReset();
  env.mockImplementation((nome: string) => {
    if (nome === "SALA_TOKEN_SECRET") return SEGREDO;
    throw new Error(`env inesperada no teste: ${nome}`);
  });
});

const LINHA_WEBINAR = {
  id: "web-1",
  status: "ativo",
  acesso_facilitado: false,
  login_na_sala: true,
  sincronizar_video: true,
  limite_simultaneo: null,
  idioma: "pt-BR",
  titulo: "Aulão",
  apresentador_nome: "Rodrigo",
  apresentador_avatar_url: null,
  titulo_notificacao_compra: null,
  pixel_meta: null,
  pixel_tiktok: null,
  gtm: null,
};

describe("carregarSala", () => {
  it("webinar inexistente: null", async () => {
    dbAdmin.mockReturnValue({ from: fromDoMapa({ webinars: { data: null, error: null } }) });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    await expect(carregarSala("nao-existe")).resolves.toBeNull();
  });

  it("erro na consulta do webinar: loga (sem segredos) e devolve null", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbAdmin.mockReturnValue({ from: fromDoMapa({ webinars: { data: null, error: { message: "banco fora do ar" } } }) });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    await expect(carregarSala("aulao")).resolves.toBeNull();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("vídeo do Bunny: url via urlsBunny", async () => {
    bunnyConfig.mockReturnValue({ libraryId: "123", apiKey: "chave", cdnHost: "vz-abc.b-cdn.net" });
    dbAdmin.mockReturnValue({
      from: fromDoMapa({
        webinars: { data: LINHA_WEBINAR, error: null },
        agendas: { data: null, error: null },
        telas_login: { data: null, error: null },
        webinar_video: { data: { video_id: "vid-1", autoplay: true, tela_cheia: false, orientacao: "horizontal" }, error: null },
        videos: { data: { origem: "bunny", bunny_guid: "guid-1", hls_url: null, duracao_seg: 1800, thumb_url: "https://vz-abc.b-cdn.net/guid-1/thumbnail.jpg" }, error: null },
        ofertas: { data: null, error: null },
        audiencias: { data: null, error: null },
        chatbot: { data: [], error: null },
        tarjas_aviso: { data: [], error: null },
      }),
    });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    const sala = await carregarSala("aulao");
    expect(sala?.video).toEqual({
      url: "https://vz-abc.b-cdn.net/guid-1/playlist.m3u8",
      formato: "hls",
      duracaoSeg: 1800,
      autoplay: true,
      telaCheia: false,
      orientacao: "horizontal",
      capa: "/api/sala/capa/web-1",
    });
  });

  it("vídeo externo: usa hls_url direto e detecta o formato", async () => {
    dbAdmin.mockReturnValue({
      from: fromDoMapa({
        webinars: { data: LINHA_WEBINAR, error: null },
        agendas: { data: null, error: null },
        telas_login: { data: null, error: null },
        webinar_video: { data: { video_id: "vid-2", autoplay: false, tela_cheia: true, orientacao: "vertical" }, error: null },
        videos: { data: { origem: "externo", bunny_guid: null, hls_url: "https://cdn.x.com/a.mp4", duracao_seg: 900 }, error: null },
        ofertas: { data: null, error: null },
        audiencias: { data: null, error: null },
        chatbot: { data: [], error: null },
        tarjas_aviso: { data: [], error: null },
      }),
    });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    const sala = await carregarSala("aulao");
    expect(sala?.video).toEqual({
      url: "https://cdn.x.com/a.mp4",
      formato: "mp4",
      duracaoSeg: 900,
      autoplay: false,
      telaCheia: true,
      orientacao: "vertical",
      capa: null,
    });
  });

  it("vídeo do Bunny sem BUNNY_STREAM_* configurado: sala sem vídeo (e loga o problema)", async () => {
    bunnyConfig.mockReturnValue(null);
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbAdmin.mockReturnValue({
      from: fromDoMapa({
        webinars: { data: LINHA_WEBINAR, error: null },
        agendas: { data: null, error: null },
        telas_login: { data: null, error: null },
        webinar_video: { data: { video_id: "vid-3", autoplay: true, tela_cheia: false, orientacao: "horizontal" }, error: null },
        videos: { data: { origem: "bunny", bunny_guid: "guid-2", hls_url: null, duracao_seg: 1200 }, error: null },
        ofertas: { data: null, error: null },
        audiencias: { data: null, error: null },
        chatbot: { data: [], error: null },
        tarjas_aviso: { data: [], error: null },
      }),
    });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    const sala = await carregarSala("aulao");
    expect(sala?.video).toBeNull();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("sem vídeo cadastrado: video null, telaLogin cai no padrão", async () => {
    dbAdmin.mockReturnValue({
      from: fromDoMapa({
        webinars: { data: LINHA_WEBINAR, error: null },
        agendas: { data: null, error: null },
        telas_login: { data: null, error: null },
        webinar_video: { data: null, error: null },
        ofertas: { data: null, error: null },
        audiencias: { data: null, error: null },
        chatbot: { data: [], error: null },
        tarjas_aviso: { data: [], error: null },
      }),
    });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    const sala = await carregarSala("aulao");
    expect(sala?.video).toBeNull();
    expect(sala?.telaLogin.botaoTexto).toBe("Assistir transmissão");
    expect(sala?.telaLogin.pedeEmail).toBe(true);
  });

  it("webinar arquivado: ainda carrega, com status arquivado (quem decide bloquear é o chamador)", async () => {
    dbAdmin.mockReturnValue({
      from: fromDoMapa({
        webinars: { data: { ...LINHA_WEBINAR, status: "arquivado" }, error: null },
        agendas: { data: null, error: null },
        telas_login: { data: null, error: null },
        webinar_video: { data: null, error: null },
        ofertas: { data: null, error: null },
        audiencias: { data: null, error: null },
        chatbot: { data: [], error: null },
        tarjas_aviso: { data: [], error: null },
      }),
    });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    const sala = await carregarSala("aulao");
    expect(sala?.webinar.status).toBe("arquivado");
  });

  it("sanitiza o titulo_html da tela de login", async () => {
    dbAdmin.mockReturnValue({
      from: fromDoMapa({
        webinars: { data: LINHA_WEBINAR, error: null },
        agendas: { data: null, error: null },
        telas_login: {
          data: {
            logo_url: null,
            logo_alinhamento: "centro",
            logo_largura_total: true,
            barra_ligada: true,
            barra_valor: 92,
            barra_cor: "#e01414",
            barra_cor_texto: "#fff",
            titulo_html: '<p onclick="x()">Oi<script>1</script></p>',
            botao_texto: "Assistir",
            botao_cor: "#000",
            botao_cor_texto: "#fff",
            pede_email: true,
            email_obrigatorio: true,
            pede_telefone: false,
            telefone_obrigatorio: false,
            pais_padrao: "BR",
            placeholder_nome: "Nome",
            placeholder_email: "E-mail",
            placeholder_telefone: "WhatsApp",
          },
          error: null,
        },
        webinar_video: { data: null, error: null },
        ofertas: { data: null, error: null },
        audiencias: { data: null, error: null },
        chatbot: { data: [], error: null },
        tarjas_aviso: { data: [], error: null },
      }),
    });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    const sala = await carregarSala("aulao");
    expect(sala?.telaLogin.tituloHtml).not.toContain("script");
    expect(sala?.telaLogin.tituloHtml).not.toContain("onclick");
    expect(sala?.telaLogin.tituloHtml).toContain("Oi");
  });
});

describe("carregarSala — tarjas de aviso", () => {
  it("uma consulta só, das ligadas, em ordem de aparece_seg, com os campos da sala (camelCase)", async () => {
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    const base = fromDoMapa({
      webinars: { data: LINHA_WEBINAR, error: null },
      agendas: { data: null, error: null },
      telas_login: { data: null, error: null },
      webinar_video: { data: null, error: null },
      ofertas: { data: null, error: null },
      audiencias: { data: null, error: null },
      chatbot: { data: [], error: null },
    });
    const linhas = [
      { texto: "Não saia!", aparece_seg: 2, duracao_seg: 15, posicao: "topo", cor: "vermelho" },
      { texto: "Oferta já já", aparece_seg: 600, duracao_seg: 10, posicao: "base", cor: "amarelo" },
    ];
    const from = vi.fn((tabela: string) => {
      if (tabela !== "tarjas_aviso") return base(tabela);
      const c: Record<string, unknown> = Promise.resolve({ data: linhas, error: null }) as unknown as Record<string, unknown>;
      for (const m of ["select", "eq", "order"]) {
        c[m] = (...args: unknown[]) => {
          chamadas.push({ metodo: m, args });
          return c;
        };
      }
      return c;
    });
    dbAdmin.mockReturnValue({ from });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    const sala = await carregarSala("aulao");

    expect(from.mock.calls.filter(([t]) => t === "tarjas_aviso")).toHaveLength(1);
    expect(chamadas).toEqual([
      { metodo: "select", args: ["texto, aparece_seg, duracao_seg, posicao, cor"] },
      { metodo: "eq", args: ["webinar_id", "web-1"] },
      { metodo: "eq", args: ["ligada", true] },
      { metodo: "order", args: ["aparece_seg", { ascending: true }] },
    ]);
    expect(sala?.tarjas).toEqual([
      { texto: "Não saia!", apareceSeg: 2, duracaoSeg: 15, posicao: "topo", cor: "vermelho" },
      { texto: "Oferta já já", apareceSeg: 600, duracaoSeg: 10, posicao: "base", cor: "amarelo" },
    ]);
  });

  it("erro na consulta das tarjas: sala sem tarjas e fora do cache", async () => {
    const from = fromDoMapa({
      webinars: { data: LINHA_WEBINAR, error: null },
      agendas: { data: null, error: null },
      telas_login: { data: null, error: null },
      webinar_video: { data: null, error: null },
      ofertas: { data: null, error: null },
      audiencias: { data: null, error: null },
      chatbot: { data: [], error: null },
      tarjas_aviso: { data: null, error: { message: "timeout" } },
    });
    dbAdmin.mockReturnValue({ from });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    const sala = await carregarSala("aulao");
    expect(sala?.tarjas).toEqual([]);
    const chamadas = from.mock.calls.length;
    await new Promise((r) => setTimeout(r, 0));
    await carregarSala("aulao");
    expect(from.mock.calls.length).toBe(chamadas * 2);
  });
});

describe("carregarSala — cache curto", () => {
  const MAPA_OK = {
    webinars: { data: LINHA_WEBINAR, error: null },
    agendas: { data: null, error: null },
    telas_login: { data: null, error: null },
    webinar_video: { data: null, error: null },
    ofertas: { data: null, error: null },
    audiencias: { data: null, error: null },
    chatbot: { data: [], error: null },
    tarjas_aviso: { data: [], error: null },
  };

  it("segunda leitura do mesmo slug não vai ao banco; limparCacheSala força ler de novo", async () => {
    const from = fromDoMapa(MAPA_OK);
    dbAdmin.mockReturnValue({ from });
    const { carregarSala, limparCacheSala } = await import("@/src/lib/sala/dados");
    const a = await carregarSala("aulao");
    const chamadas = from.mock.calls.length;
    const b = await carregarSala("aulao");
    expect(b).toBe(a);
    expect(from.mock.calls.length).toBe(chamadas);
    limparCacheSala();
    await carregarSala("aulao");
    expect(from.mock.calls.length).toBe(chamadas * 2);
  });

  it("sala montada com erro em alguma consulta não fica no cache", async () => {
    const from = fromDoMapa({ ...MAPA_OK, agendas: { data: null, error: { message: "timeout" } } });
    dbAdmin.mockReturnValue({ from });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    await carregarSala("aulao");
    const chamadas = from.mock.calls.length;
    await new Promise((r) => setTimeout(r, 0));
    await carregarSala("aulao");
    expect(from.mock.calls.length).toBe(chamadas * 2);
  });

  it("webinar inexistente não fica no cache (um webinar recém-criado aparece na hora)", async () => {
    const from = fromDoMapa({ webinars: { data: null, error: null } });
    dbAdmin.mockReturnValue({ from });
    const { carregarSala } = await import("@/src/lib/sala/dados");
    await expect(carregarSala("novo")).resolves.toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    await carregarSala("novo");
    expect(from).toHaveBeenCalledTimes(2);
  });
});

describe("salaCheia", () => {
  it("sem limite configurado: nunca fica cheia", async () => {
    dbAdmin.mockReturnValue({ from: fromDoMapa({}) });
    const { salaCheia } = await import("@/src/lib/sala/dados");
    await expect(salaCheia("web-1", null, new Date())).resolves.toBe(false);
  });

  it("com limite, contagem atinge o limite: cheia", async () => {
    dbAdmin.mockReturnValue({ from: fromDoMapa({ sessoes: { data: null, count: 50, error: null } }) });
    const { salaCheia } = await import("@/src/lib/sala/dados");
    await expect(salaCheia("web-1", 50, new Date())).resolves.toBe(true);
  });

  it("com limite, contagem abaixo: não está cheia", async () => {
    dbAdmin.mockReturnValue({ from: fromDoMapa({ sessoes: { data: null, count: 3, error: null } }) });
    const { salaCheia } = await import("@/src/lib/sala/dados");
    await expect(salaCheia("web-1", 50, new Date())).resolves.toBe(false);
  });
});

const SALA_BASE = {
  webinar: { id: "web-1", loginNaSala: true, sincronizarVideo: true } as unknown as import("@/src/lib/sala/dados").SalaWebinar,
} as unknown as import("@/src/lib/sala/dados").Sala;


describe("criarSessao", () => {
  it("nunca reaproveita participante: duas sessões com o mesmo e-mail criam dois participantes", async () => {
    const insertParticipante = vi
      .fn()
      .mockReturnValueOnce(chain({ data: { id: "part-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: { id: "part-2" }, error: null }))
      .mockReturnValue(chain({ data: { id: "part-3" }, error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: insertParticipante };
      if (tabela === "sessoes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "sessao-x" }, error: null })) };
      if (tabela === "eventos") return { insert: vi.fn().mockReturnValue(chain({ data: null, error: null })) };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const agora = new Date("2026-10-20T10:00:00Z");
    const dadosSessao = {
      sala: SALA_BASE,
      dados: { nome: "Ana", email: "ana@x.com", telefone: null },
      temporario: false,
      utms: {},
      modo: "ao_vivo" as const,
      janelaInicio: agora,
      agora,
      geo: {},
      dispositivo: "desktop" as const,
      navegador: null,
      ipHash: null,
      linkMagico: false,
    };

    await criarSessao(dadosSessao);
    await criarSessao({ ...dadosSessao, dados: { ...dadosSessao.dados, nome: "Ana de Novo" } });

    expect(insertParticipante).toHaveBeenCalledTimes(2);
    expect(insertParticipante).toHaveBeenNthCalledWith(1, expect.objectContaining({ email: "ana@x.com", nome: "Ana" }));
    expect(insertParticipante).toHaveBeenNthCalledWith(2, expect.objectContaining({ email: "ana@x.com", nome: "Ana de Novo" }));

    // E-mail sempre minúsculo e sem espaço (link mágico chega aqui sem passar por validarCadastro): o checkout
    // casa a venda por igualdade exata com o e-mail minúsculo.
    await criarSessao({ ...dadosSessao, dados: { ...dadosSessao.dados, email: "  Ana@X.COM " } });
    expect(insertParticipante).toHaveBeenNthCalledWith(3, expect.objectContaining({ email: "ana@x.com" }));
    await criarSessao({ ...dadosSessao, dados: { ...dadosSessao.dados, email: "   " } });
    expect(insertParticipante).toHaveBeenNthCalledWith(4, expect.objectContaining({ email: null }));
  });

  it("insere o participante com o nome/e-mail/telefone digitados nesta sessão (sem lookup)", async () => {
    const insertParticipante = vi.fn().mockReturnValue(chain({ data: { id: "part-novo" }, error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: insertParticipante };
      if (tabela === "sessoes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "sessao-2" }, error: null })) };
      if (tabela === "eventos") return { insert: vi.fn().mockReturnValue(chain({ data: null, error: null })) };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const agora = new Date("2026-10-20T10:00:00Z");
    const r = await criarSessao({
      sala: SALA_BASE,
      dados: { nome: "Novo", email: null, telefone: null },
      temporario: false,
      utms: {},
      modo: "ao_vivo",
      janelaInicio: agora,
      agora,
      geo: {},
      dispositivo: "mobile",
      navegador: "Chrome",
      ipHash: "hash-123",
      linkMagico: false,
    });

    expect(r.sessaoId).toBe("sessao-2");
    expect(insertParticipante).toHaveBeenCalledWith(expect.objectContaining({ nome: "Novo", email: null, telefone_e164: null }));
  });

  it("inscrição do JIT: inicio_sessao = jit_horario, evento inscreveu_lp e cookie até 12 h depois do fim", async () => {
    const insertSessao = vi.fn().mockReturnValue(chain({ data: { id: "sessao-jit" }, error: null }));
    const insertEvento = vi.fn().mockReturnValue(chain({ data: null, error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "part-1" }, error: null })) };
      if (tabela === "sessoes") return { insert: insertSessao };
      if (tabela === "eventos") return { insert: insertEvento };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });
    env.mockImplementation((nome: string) => (nome === "SALA_TOKEN_SECRET" ? SEGREDO : ""));

    const sala = { webinar: { id: "web-1", loginNaSala: false, sincronizarVideo: false }, video: { duracaoSeg: 3600 } } as unknown as import("@/src/lib/sala/dados").Sala;
    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const { enfileirarPorEvento } = await import("@/src/lib/disparos");
    const agora = new Date("2026-10-20T09:12:00Z");
    const jitHorario = new Date("2026-10-21T22:00:00Z");
    const r = await criarSessao({
      sala,
      dados: { nome: "Ana", email: "ana@x.com", telefone: null },
      temporario: false,
      utms: {},
      modo: "ao_vivo",
      janelaInicio: jitHorario,
      agora,
      geo: {},
      dispositivo: "desktop",
      navegador: null,
      ipHash: null,
      linkMagico: false,
      jitHorario,
      jitFuso: "Europe/Lisbon",
    });
    expect(insertSessao).toHaveBeenCalledWith(
      expect.objectContaining({
        inicio_sessao: jitHorario.toISOString(),
        jit_horario: jitHorario.toISOString(),
        jit_fuso: "Europe/Lisbon",
        modo: "ao_vivo",
      }),
    );
    expect(insertEvento).toHaveBeenCalledWith({ sessao_id: "sessao-jit", webinar_id: "web-1", tipo: "inscreveu_lp" });
    expect(enfileirarPorEvento).toHaveBeenCalledWith("sessao-jit", "web-1", "inscreveu_lp");
    expect(r.exp).toBe(Math.floor(jitHorario.getTime() / 1000) + 3600 + 12 * 3600);
  });

  it("inicio_sessao sincronizado usa a janela de início, não o primeiro acesso", async () => {
    const insertSessao = vi.fn().mockReturnValue(chain({ data: { id: "sessao-3" }, error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "part-1" }, error: null })) };
      if (tabela === "sessoes") return { insert: insertSessao };
      if (tabela === "eventos") return { insert: vi.fn().mockReturnValue(chain({ data: null, error: null })) };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const janela = new Date("2026-10-20T09:00:00Z");
    const agora = new Date("2026-10-20T09:12:00Z");
    await criarSessao({
      sala: SALA_BASE,
      dados: { nome: "Ana", email: "ana@x.com", telefone: null },
      temporario: false,
      utms: {},
      modo: "ao_vivo",
      janelaInicio: janela,
      agora,
      geo: {},
      dispositivo: "desktop",
      navegador: null,
      ipHash: null,
      linkMagico: false,
    });
    expect(insertSessao).toHaveBeenCalledWith(expect.objectContaining({ inicio_sessao: janela.toISOString() }));
  });

  it("sem sincronizar: inicio_sessao é o primeiro acesso (agora)", async () => {
    const insertSessao = vi.fn().mockReturnValue(chain({ data: { id: "sessao-4" }, error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "part-1" }, error: null })) };
      if (tabela === "sessoes") return { insert: insertSessao };
      if (tabela === "eventos") return { insert: vi.fn().mockReturnValue(chain({ data: null, error: null })) };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const salaSemSync = { webinar: { id: "web-1", loginNaSala: true, sincronizarVideo: false } } as unknown as import("@/src/lib/sala/dados").Sala;
    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const janela = new Date("2026-10-20T09:00:00Z");
    const agora = new Date("2026-10-20T09:12:00Z");
    await criarSessao({
      sala: salaSemSync,
      dados: { nome: "Ana", email: "ana@x.com", telefone: null },
      temporario: false,
      utms: {},
      modo: "ao_vivo",
      janelaInicio: janela,
      agora,
      geo: {},
      dispositivo: "desktop",
      navegador: null,
      ipHash: null,
      linkMagico: false,
    });
    expect(insertSessao).toHaveBeenCalledWith(expect.objectContaining({ inicio_sessao: agora.toISOString() }));
  });

  it("replay: inicio_sessao é sempre agora, mesmo com sincronizar ligado", async () => {
    const insertSessao = vi.fn().mockReturnValue(chain({ data: { id: "sessao-5" }, error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "part-1" }, error: null })) };
      if (tabela === "sessoes") return { insert: insertSessao };
      if (tabela === "eventos") return { insert: vi.fn().mockReturnValue(chain({ data: null, error: null })) };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const janela = new Date("2026-10-20T09:00:00Z");
    const agora = new Date("2026-10-20T11:00:00Z");
    await criarSessao({
      sala: SALA_BASE,
      dados: { nome: "Ana", email: "ana@x.com", telefone: null },
      temporario: false,
      utms: {},
      modo: "replay",
      janelaInicio: janela,
      agora,
      geo: {},
      dispositivo: "desktop",
      navegador: null,
      ipHash: null,
      linkMagico: false,
    });
    expect(insertSessao).toHaveBeenCalledWith(expect.objectContaining({ inicio_sessao: agora.toISOString(), modo: "replay" }));
  });

  it("link mágico grava o evento link_magico mesmo com login_na_sala", async () => {
    const insertEvento = vi.fn().mockReturnValue(chain({ data: null, error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "part-1" }, error: null })) };
      if (tabela === "sessoes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "sessao-6" }, error: null })) };
      if (tabela === "eventos") return { insert: insertEvento };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const agora = new Date();
    await criarSessao({
      sala: SALA_BASE,
      dados: { nome: "Ana", email: "ana@x.com", telefone: null },
      temporario: false,
      utms: {},
      modo: "ao_vivo",
      janelaInicio: agora,
      agora,
      geo: {},
      dispositivo: "desktop",
      navegador: null,
      ipHash: null,
      linkMagico: true,
    });
    expect(insertEvento).toHaveBeenCalledWith(expect.objectContaining({ tipo: "link_magico" }));
  });

  describe("evento de entrada por caminho", () => {
    async function eventoGravado(o: { loginNaSala: boolean; temporario: boolean; linkMagico: boolean }) {
      const insertEvento = vi.fn().mockReturnValue(chain({ data: null, error: null }));
      const from = vi.fn((tabela: string) => {
        if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "part-1" }, error: null })) };
        if (tabela === "sessoes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "sessao-e" }, error: null })) };
        if (tabela === "eventos") return { insert: insertEvento };
        throw new Error("tabela inesperada: " + tabela);
      });
      dbAdmin.mockReturnValue({ from });
      const { criarSessao } = await import("@/src/lib/sala/sessao");
      const agora = new Date();
      await criarSessao({
        sala: { ...SALA_BASE, webinar: { ...SALA_BASE.webinar, loginNaSala: o.loginNaSala } },
        dados: { nome: "Ana", email: o.temporario ? null : "ana@x.com", telefone: null },
        temporario: o.temporario,
        utms: {},
        modo: "ao_vivo",
        janelaInicio: agora,
        agora,
        geo: {},
        dispositivo: "desktop",
        navegador: null,
        ipHash: null,
        linkMagico: o.linkMagico,
      });
      return (insertEvento.mock.calls[0]?.[0] as { tipo: string }).tipo;
    }

    it("formulário de login (cadastro completo) com login_na_sala desligado: fez_login (era sem_login)", async () => {
      expect(await eventoGravado({ loginNaSala: false, temporario: false, linkMagico: false })).toBe("fez_login");
    });
    it("formulário de login com login_na_sala ligado: fez_login", async () => {
      expect(await eventoGravado({ loginNaSala: true, temporario: false, linkMagico: false })).toBe("fez_login");
    });
    it("acesso facilitado (provisória) com login_na_sala desligado: sem_login", async () => {
      expect(await eventoGravado({ loginNaSala: false, temporario: true, linkMagico: false })).toBe("sem_login");
    });
    it("acesso facilitado (provisória) com login_na_sala ligado: login_provisorio", async () => {
      expect(await eventoGravado({ loginNaSala: true, temporario: true, linkMagico: false })).toBe("login_provisorio");
    });
    it("link mágico com login_na_sala desligado: link_magico", async () => {
      expect(await eventoGravado({ loginNaSala: false, temporario: false, linkMagico: true })).toBe("link_magico");
    });
  });

  it("modo teste: não grava evento (link assinado do Pronto não entra nas métricas reais)", async () => {
    const insertEvento = vi.fn().mockReturnValue(chain({ data: null, error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "part-1" }, error: null })) };
      if (tabela === "sessoes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "sessao-7" }, error: null })) };
      if (tabela === "eventos") return { insert: insertEvento };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const agora = new Date();
    await criarSessao({
      sala: SALA_BASE,
      dados: { nome: "Ana", email: "ana@x.com", telefone: null },
      temporario: false,
      utms: {},
      modo: "teste",
      janelaInicio: agora,
      agora,
      geo: {},
      dispositivo: "desktop",
      navegador: null,
      ipHash: null,
      linkMagico: false,
    });
    expect(insertEvento).not.toHaveBeenCalled();
  });

  it("erro ao inserir o participante: lança erro amigável", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: null, error: { message: "falhou" } })) };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const agora = new Date();
    await expect(
      criarSessao({
        sala: SALA_BASE,
        dados: { nome: "Ana", email: "ana@x.com", telefone: null },
        temporario: false,
        utms: {},
        modo: "ao_vivo",
        janelaInicio: agora,
        agora,
        geo: {},
        dispositivo: "desktop",
        navegador: null,
        ipHash: null,
        linkMagico: false,
      }),
    ).rejects.toThrow("Não deu para abrir sua sessão.");
  });

  it("erro ao inserir a sessão: lança erro amigável", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "part-1" }, error: null })) };
      if (tabela === "sessoes") return { insert: vi.fn().mockReturnValue(chain({ data: null, error: { message: "falhou" } })) };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const agora = new Date();
    await expect(
      criarSessao({
        sala: SALA_BASE,
        dados: { nome: "Ana", email: "ana@x.com", telefone: null },
        temporario: false,
        utms: {},
        modo: "ao_vivo",
        janelaInicio: agora,
        agora,
        geo: {},
        dispositivo: "desktop",
        navegador: null,
        ipHash: null,
        linkMagico: false,
      }),
    ).rejects.toThrow("Não deu para abrir sua sessão.");
  });

  it("erro ao inserir o evento (não é conflito): lança erro amigável", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "part-1" }, error: null })) };
      if (tabela === "sessoes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "sessao-8" }, error: null })) };
      if (tabela === "eventos") return { insert: vi.fn().mockReturnValue(chain({ data: null, error: { code: "500", message: "falhou" } })) };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const agora = new Date();
    await expect(
      criarSessao({
        sala: SALA_BASE,
        dados: { nome: "Ana", email: "ana@x.com", telefone: null },
        temporario: false,
        utms: {},
        modo: "ao_vivo",
        janelaInicio: agora,
        agora,
        geo: {},
        dispositivo: "desktop",
        navegador: null,
        ipHash: null,
        linkMagico: false,
      }),
    ).rejects.toThrow("Não deu para abrir sua sessão.");
  });

  it("conflito (23505) ao inserir o evento: ignorado, sessão criada normalmente", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "part-1" }, error: null })) };
      if (tabela === "sessoes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "sessao-9" }, error: null })) };
      if (tabela === "eventos") return { insert: vi.fn().mockReturnValue(chain({ data: null, error: { code: "23505", message: "duplicate" } })) };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { criarSessao } = await import("@/src/lib/sala/sessao");
    const agora = new Date();
    const r = await criarSessao({
      sala: SALA_BASE,
      dados: { nome: "Ana", email: "ana@x.com", telefone: null },
      temporario: false,
      utms: {},
      modo: "ao_vivo",
      janelaInicio: agora,
      agora,
      geo: {},
      dispositivo: "desktop",
      navegador: null,
      ipHash: null,
      linkMagico: false,
    });
    expect(r.sessaoId).toBe("sessao-9");
  });
});

describe("lerSessaoDoCookie", () => {
  function jarCom(valor: string | undefined) {
    return { get: (nome: string) => (nome === "vw_web-1" && valor !== undefined ? { value: valor } : undefined) };
  }

  it("cookie ausente: null", async () => {
    cookiesMock.mockResolvedValue(jarCom(undefined));
    dbAdmin.mockReturnValue({ from: fromDoMapa({}) });
    const { lerSessaoDoCookie } = await import("@/src/lib/sala/sessao");
    await expect(lerSessaoDoCookie("web-1")).resolves.toBeNull();
  });

  it("cookie válido: devolve a sessão com o nome do participante", async () => {
    const { assinarToken } = await import("@/src/lib/regras/sessao-token");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = assinarToken({ s: "sessao-1", w: "web-1", exp }, SEGREDO);
    cookiesMock.mockResolvedValue(jarCom(token));
    dbAdmin.mockReturnValue({
      from: fromDoMapa({
        sessoes: {
          data: {
            id: "sessao-1",
            webinar_id: "web-1",
            participante_id: "part-1",
            modo: "ao_vivo",
            inicio_sessao: "2026-10-20T10:00:00.000Z",
            utms: { utm_source: "ig" },
            participantes: { nome: "Ana", temporario: false, email: "ana@x.com", telefone_e164: "+5511987654321" },
          },
          error: null,
        },
      }),
    });
    const { lerSessaoDoCookie } = await import("@/src/lib/sala/sessao");
    await expect(lerSessaoDoCookie("web-1")).resolves.toEqual({
      sessaoId: "sessao-1",
      webinarId: "web-1",
      participanteId: "part-1",
      participanteNome: "Ana",
      participanteEmail: "ana@x.com",
      participanteTelefone: "+5511987654321",
      temporario: false,
      modo: "ao_vivo",
      inicioSessao: new Date("2026-10-20T10:00:00.000Z"),
      jitHorario: null,
      utms: { utm_source: "ig" },
    });
  });

  it("token expirado: null", async () => {
    const { assinarToken } = await import("@/src/lib/regras/sessao-token");
    const exp = Math.floor(Date.now() / 1000) - 10;
    const token = assinarToken({ s: "sessao-1", w: "web-1", exp }, SEGREDO);
    cookiesMock.mockResolvedValue(jarCom(token));
    dbAdmin.mockReturnValue({ from: fromDoMapa({}) });
    const { lerSessaoDoCookie } = await import("@/src/lib/sala/sessao");
    await expect(lerSessaoDoCookie("web-1")).resolves.toBeNull();
  });

  it("token de outro webinar: null", async () => {
    const { assinarToken } = await import("@/src/lib/regras/sessao-token");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = assinarToken({ s: "sessao-1", w: "web-2", exp }, SEGREDO);
    cookiesMock.mockResolvedValue(jarCom(token));
    dbAdmin.mockReturnValue({ from: fromDoMapa({}) });
    const { lerSessaoDoCookie } = await import("@/src/lib/sala/sessao");
    // o cookie é vw_web-1 mas o token foi assinado pra web-2: a função é chamada com webinarId="web-1"
    await expect(lerSessaoDoCookie("web-1")).resolves.toBeNull();
  });

  it("sessão no banco pertence a outro webinar (defesa extra): null", async () => {
    const { assinarToken } = await import("@/src/lib/regras/sessao-token");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = assinarToken({ s: "sessao-1", w: "web-1", exp }, SEGREDO);
    cookiesMock.mockResolvedValue(jarCom(token));
    dbAdmin.mockReturnValue({
      from: fromDoMapa({
        sessoes: { data: { id: "sessao-1", webinar_id: "web-2", modo: "ao_vivo", inicio_sessao: "2026-10-20T10:00:00.000Z", utms: {}, participantes: null }, error: null },
      }),
    });
    const { lerSessaoDoCookie } = await import("@/src/lib/sala/sessao");
    await expect(lerSessaoDoCookie("web-1")).resolves.toBeNull();
  });

  it("erro na consulta da sessão: null", async () => {
    const { assinarToken } = await import("@/src/lib/regras/sessao-token");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = assinarToken({ s: "sessao-1", w: "web-1", exp }, SEGREDO);
    cookiesMock.mockResolvedValue(jarCom(token));
    dbAdmin.mockReturnValue({ from: fromDoMapa({ sessoes: { data: null, error: { message: "banco fora do ar" } } }) });
    const { lerSessaoDoCookie } = await import("@/src/lib/sala/sessao");
    await expect(lerSessaoDoCookie("web-1")).resolves.toBeNull();
  });

  it("token de teste (t: 1, sem s) é rejeitado como sessão", async () => {
    const { assinarToken } = await import("@/src/lib/regras/sessao-token");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = assinarToken({ w: "web-1", t: 1, exp }, SEGREDO);
    cookiesMock.mockResolvedValue(jarCom(token));
    dbAdmin.mockReturnValue({ from: fromDoMapa({}) });
    const { lerSessaoDoCookie } = await import("@/src/lib/sala/sessao");
    await expect(lerSessaoDoCookie("web-1")).resolves.toBeNull();
  });
});

describe("geoDoCabecalho / ipHashDoCabecalho", () => {
  it("cidade malformada (URL-encoding inválido): mantém o valor cru em vez de quebrar", async () => {
    const { geoDoCabecalho } = await import("@/src/lib/sala/sessao");
    const headers = new Headers({ "x-vercel-ip-city": "%E0%A4%A" }); // sequência %-encoding inválida
    expect(geoDoCabecalho(headers).cidade).toBe("%E0%A4%A");
  });

  it("latitude/longitude não numéricas: não entram no resultado", async () => {
    const { geoDoCabecalho } = await import("@/src/lib/sala/sessao");
    const headers = new Headers({ "x-vercel-ip-latitude": "não-é-numero", "x-vercel-ip-longitude": "também-não" });
    const geo = geoDoCabecalho(headers);
    expect(geo.lat).toBeUndefined();
    expect(geo.lon).toBeUndefined();
  });

  it("sem cabeçalhos de geo: objeto vazio (não confunde ausência com 0)", async () => {
    const { geoDoCabecalho } = await import("@/src/lib/sala/sessao");
    expect(geoDoCabecalho(new Headers())).toEqual({});
  });

  it("latitude/longitude numéricas válidas", async () => {
    const { geoDoCabecalho } = await import("@/src/lib/sala/sessao");
    const headers = new Headers({ "x-vercel-ip-latitude": "-23.55", "x-vercel-ip-longitude": "-46.63" });
    expect(geoDoCabecalho(headers)).toEqual({ lat: -23.55, lon: -46.63 });
  });
});

describe("verificarTokenTeste", () => {
  it("aceita token de teste (t: 1, sem s)", async () => {
    const { assinarToken, verificarTokenTeste } = await import("@/src/lib/regras/sessao-token");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = assinarToken({ w: "web-1", t: 1, exp }, SEGREDO);
    expect(verificarTokenTeste(token, SEGREDO, Math.floor(Date.now() / 1000))).toEqual({ w: "web-1" });
  });

  it("rejeita token de sessão normal (com s, sem t)", async () => {
    const { assinarToken, verificarTokenTeste } = await import("@/src/lib/regras/sessao-token");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = assinarToken({ s: "sessao-1", w: "web-1", exp }, SEGREDO);
    expect(verificarTokenTeste(token, SEGREDO, Math.floor(Date.now() / 1000))).toBeNull();
  });
});

describe("carregarMinhasMensagens", () => {
  it("mensagem apagada pelo atendente: volta sem texto/imagem e com apagada = true (o banco guarda o original)", async () => {
    dbAdmin.mockReturnValue({
      from: fromDoMapa({
        mensagens_suporte: {
          data: [
            { id: "m1", autor: "participante", texto: "Oi", imagem_url: null, apagada: false, created_at: "2026-10-20T10:00:00Z" },
            { id: "m2", autor: "atendente", texto: "segredo", imagem_url: "https://x/a.png", apagada: true, created_at: "2026-10-20T10:01:00Z" },
          ],
          error: null,
        },
      }),
    });
    const { carregarMinhasMensagens } = await import("@/src/lib/sala/dados");
    const r = await carregarMinhasMensagens("s1");
    expect(r[0]).toEqual({ id: "m1", autor: "participante", texto: "Oi", imagemUrl: null, criadaEm: "2026-10-20T10:00:00Z", apagada: false });
    expect(r[1]).toEqual({ id: "m2", autor: "atendente", texto: null, imagemUrl: null, criadaEm: "2026-10-20T10:01:00Z", apagada: true });
  });
});

describe("criarSessao com o cookie do teste A/B", () => {
  const TESTE = "11111111-2222-4333-8444-555555555555";
  const agora = new Date("2026-10-20T10:00:00Z");
  const agoraSeg = Math.floor(agora.getTime() / 1000);
  const NO_AR = { inicio: "2026-10-19T00:00:00Z", fim: "2026-10-21T00:00:00Z", arquivado: false };
  const valendo = { data: { teste_id: TESTE, testes_ab: NO_AR }, error: null };

  function montar(variacao: unknown) {
    const insertSessao = vi.fn().mockReturnValue(chain({ data: { id: "sessao-ab" }, error: null }));
    const eqVariacao = vi.fn();
    const from = vi.fn((tabela: string) => {
      if (tabela === "participantes") return { insert: vi.fn().mockReturnValue(chain({ data: { id: "part-1" }, error: null })) };
      if (tabela === "sessoes") return { insert: insertSessao };
      if (tabela === "eventos") return { insert: vi.fn().mockReturnValue(chain({ data: null, error: null })) };
      if (tabela === "testes_ab_variacoes") {
        const c = chain(variacao);
        const eqOriginal = c.eq;
        c.eq = (...a: unknown[]) => {
          eqVariacao(...a);
          return eqOriginal(...a);
        };
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });
    return { insertSessao, eqVariacao, from };
  }

  async function criar(cookie: string | null, modo: "ao_vivo" | "teste" = "ao_vivo") {
    cookiesMock.mockResolvedValue({ get: (nome: string) => (cookie && nome === "vw_abw_web-1" ? { value: cookie } : undefined) });
    const { criarSessao } = await import("@/src/lib/sala/sessao");
    return criarSessao({
      sala: SALA_BASE,
      dados: { nome: "Ana", email: "ana@x.com", telefone: null },
      temporario: false,
      utms: {},
      modo,
      janelaInicio: agora,
      agora,
      geo: {},
      dispositivo: "desktop",
      navegador: null,
      ipHash: null,
      linkMagico: false,
    });
  }

  it("cookie válido e o webinar ainda é variação do teste: grava teste_ab_id e variacao_webinar_id", async () => {
    const { criarTokenAb } = await import("@/src/lib/regras/sessao-token");
    const { insertSessao, eqVariacao } = montar(valendo);
    await criar(criarTokenAb({ t: TESTE, w: "web-1", exp: agoraSeg + 3600 }, SEGREDO));
    expect(eqVariacao).toHaveBeenCalledWith("teste_id", TESTE);
    expect(eqVariacao).toHaveBeenCalledWith("webinar_id", "web-1");
    expect(insertSessao).toHaveBeenCalledWith(expect.objectContaining({ teste_ab_id: TESTE, variacao_webinar_id: "web-1" }));
  });

  it("teste arquivado ou fora do período (antes do início, depois do fim): grava sem teste", async () => {
    const { criarTokenAb } = await import("@/src/lib/regras/sessao-token");
    for (const teste of [
      { ...NO_AR, arquivado: true },
      { ...NO_AR, inicio: "2026-10-20T10:00:01Z" },
      { ...NO_AR, fim: "2026-10-20T09:59:59Z" },
    ]) {
      const { insertSessao } = montar({ data: { teste_id: TESTE, testes_ab: teste }, error: null });
      await criar(criarTokenAb({ t: TESTE, w: "web-1", exp: agoraSeg + 3600 }, SEGREDO));
      expect(insertSessao).toHaveBeenCalledWith(expect.objectContaining({ teste_ab_id: null, variacao_webinar_id: null }));
    }
    // Bordas do período contam (inicio ≤ agora ≤ fim), como no /t/<slug>.
    const { insertSessao } = montar({ data: { teste_id: TESTE, testes_ab: { ...NO_AR, inicio: agora.toISOString(), fim: agora.toISOString() } }, error: null });
    await criar(criarTokenAb({ t: TESTE, w: "web-1", exp: agoraSeg + 3600 }, SEGREDO));
    expect(insertSessao).toHaveBeenCalledWith(expect.objectContaining({ teste_ab_id: TESTE }));
  });

  it("teste que não tem mais esse webinar como variação: grava sem teste", async () => {
    const { criarTokenAb } = await import("@/src/lib/regras/sessao-token");
    const { insertSessao } = montar({ data: null, error: null });
    await criar(criarTokenAb({ t: TESTE, w: "web-1", exp: agoraSeg + 3600 }, SEGREDO));
    expect(insertSessao).toHaveBeenCalledWith(expect.objectContaining({ teste_ab_id: null, variacao_webinar_id: null }));
  });

  it("cookie adulterado, expirado ou de outro webinar: nem consulta o teste", async () => {
    const { criarTokenAb } = await import("@/src/lib/regras/sessao-token");
    for (const cookie of [
      "lixo.lixo",
      criarTokenAb({ t: TESTE, w: "web-1", exp: agoraSeg - 1 }, SEGREDO),
      criarTokenAb({ t: TESTE, w: "web-2", exp: agoraSeg + 3600 }, SEGREDO),
      criarTokenAb({ t: TESTE, w: "web-1", exp: agoraSeg + 3600 }, "outro-segredo"),
    ]) {
      const { insertSessao, from } = montar(valendo);
      await criar(cookie);
      expect(from).not.toHaveBeenCalledWith("testes_ab_variacoes");
      expect(insertSessao).toHaveBeenCalledWith(expect.objectContaining({ teste_ab_id: null, variacao_webinar_id: null }));
    }
  });

  it("modo teste nunca grava o teste A/B", async () => {
    const { criarTokenAb } = await import("@/src/lib/regras/sessao-token");
    const { insertSessao, from } = montar(valendo);
    await criar(criarTokenAb({ t: TESTE, w: "web-1", exp: agoraSeg + 3600 }, SEGREDO), "teste");
    expect(from).not.toHaveBeenCalledWith("testes_ab_variacoes");
    expect(insertSessao).toHaveBeenCalledWith(expect.objectContaining({ teste_ab_id: null, variacao_webinar_id: null }));
  });

  it("sem cookie (ou cookies() indisponível): sessão normal", async () => {
    const { insertSessao } = montar({ data: null, error: null });
    await criar(null);
    expect(insertSessao).toHaveBeenCalledWith(expect.objectContaining({ teste_ab_id: null }));
    cookiesMock.mockRejectedValue(new Error("fora de requisição"));
    const { criarSessao } = await import("@/src/lib/sala/sessao");
    await expect(
      criarSessao({ sala: SALA_BASE, dados: { nome: "A", email: null, telefone: null }, temporario: false, utms: {}, modo: "ao_vivo", janelaInicio: agora, agora, geo: {}, dispositivo: "desktop", navegador: null, ipHash: null, linkMagico: false }),
    ).resolves.toMatchObject({ sessaoId: "sessao-ab" });
  });
});
