import { beforeEach, describe, expect, it, vi } from "vitest";

const iaConfig = vi.fn();
const bunnyConfig = vi.fn();
vi.mock("@/src/lib/env", () => ({
  iaConfig: (...a: unknown[]) => iaConfig(...a),
  bunnyConfig: (...a: unknown[]) => bunnyConfig(...a),
}));

const CFG_IA = { openrouterKey: "or-key", modelo: "modelo-x", elevenlabsKey: "el-key" };
const CFG_BUNNY = { libraryId: "123", apiKey: "chave", cdnHost: "vz-abc.b-cdn.net" };

/** Fábrica de uma chain estilo Supabase: registra cada chamada (`chamadas`) e resolve pro `resultado` dado em
 *  `maybeSingle`/`single`, ou direto (thenable) se o código nunca chama um desses. Baseada no helper de
 *  `tests/disparos.test.ts`, com `or` a mais (usado por `reivindicarGeracao`). */
function chain(resultado: unknown, chamadas: { metodo: string; args: unknown[] }[] = []) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "neq", "is", "in", "or", "lte", "lt", "gte", "order", "limit", "upsert", "insert", "update"]) {
    p[m] = (...args: unknown[]) => {
      chamadas.push({ metodo: m, args });
      return p;
    };
  }
  p.single = () => Promise.resolve(resultado);
  p.maybeSingle = () => Promise.resolve(resultado);
  return p;
}

beforeEach(() => {
  vi.resetModules();
  iaConfig.mockReset();
  bunnyConfig.mockReset();
  iaConfig.mockReturnValue(CFG_IA);
  bunnyConfig.mockReturnValue(CFG_BUNNY);
});

describe("iniciarGeracao", () => {
  it("IA desligada (sem OpenRouter/modelo): erro, não consulta nada", async () => {
    iaConfig.mockReturnValue(null);
    const from = vi.fn();
    const { iniciarGeracao } = await import("@/src/lib/geracao");
    const r = await iniciarGeracao("w1", { idioma: "pt", tom: "natural", intensidade: "media" }, { db: { from } as any });
    expect(r).toEqual({ erro: "A geração de chat por IA está desligada. Configure as chaves de IA." });
    expect(from).not.toHaveBeenCalled();
  });

  it("sem ElevenLabs configurado: erro (geração precisa de transcrição)", async () => {
    iaConfig.mockReturnValue({ ...CFG_IA, elevenlabsKey: null });
    const from = vi.fn();
    const { iniciarGeracao } = await import("@/src/lib/geracao");
    const r = await iniciarGeracao("w1", { idioma: "pt", tom: "natural", intensidade: "media" }, { db: { from } as any });
    expect("erro" in r).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it("já tem uma geração em andamento: erro", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela === "geracoes_chat") return chain({ data: { id: "g0" } });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const { iniciarGeracao } = await import("@/src/lib/geracao");
    const r = await iniciarGeracao("w1", { idioma: "pt", tom: "natural", intensidade: "media" }, { db: { from } as any });
    expect(r).toEqual({ erro: "Já tem uma geração em andamento para este webinar." });
  });

  it("sem vídeo escolhido no passo Vídeo: erro", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela === "geracoes_chat") return chain({ data: null });
      if (tabela === "webinar_video") return chain({ data: null });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const { iniciarGeracao } = await import("@/src/lib/geracao");
    const r = await iniciarGeracao("w1", { idioma: "pt", tom: "natural", intensidade: "media" }, { db: { from } as any });
    expect(r).toEqual({ erro: "Escolha um vídeo no passo Vídeo antes de gerar o chat." });
  });

  it("vídeo externo com link HLS: recusa", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela === "geracoes_chat") return chain({ data: null });
      if (tabela === "webinar_video") return chain({ data: { video_id: "v1" } });
      if (tabela === "videos") return chain({ data: { origem: "externo", bunny_guid: null, hls_url: "https://x.com/a.m3u8" } });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const { iniciarGeracao } = await import("@/src/lib/geracao");
    const r = await iniciarGeracao("w1", { idioma: "pt", tom: "natural", intensidade: "media" }, { db: { from } as any });
    expect(r).toEqual({ erro: "Para gerar o chat com IA, use um vídeo do Bunny ou um link MP4." });
  });

  it("vídeo do Bunny válido: insere a geração em fila com a fonte_url resolvida", async () => {
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "geracoes_chat") {
        return { ...chain({ data: null }, chamadas), insert };
      }
      if (tabela === "webinar_video") return chain({ data: { video_id: "v1" } }, chamadas);
      if (tabela === "videos") return chain({ data: { origem: "bunny", bunny_guid: "g1", hls_url: null } }, chamadas);
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const { iniciarGeracao } = await import("@/src/lib/geracao");
    const r = await iniciarGeracao("w1", { idioma: "pt", tom: "natural", intensidade: "alta", instrucoes: "público iniciante" }, { db: { from } as any });
    expect(r).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith({
      webinar_id: "w1",
      status: "fila",
      idioma: "pt",
      tom: "natural",
      intensidade: "alta",
      instrucoes: "público iniciante",
      fonte_url: "https://vz-abc.b-cdn.net/g1/play_360p.mp4",
    });
  });

  it("vídeo do Bunny mas Bunny não configurado: erro", async () => {
    bunnyConfig.mockReturnValue(null);
    const from = vi.fn((tabela: string) => {
      if (tabela === "geracoes_chat") return chain({ data: null });
      if (tabela === "webinar_video") return chain({ data: { video_id: "v1" } });
      if (tabela === "videos") return chain({ data: { origem: "bunny", bunny_guid: "g1", hls_url: null } });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const { iniciarGeracao } = await import("@/src/lib/geracao");
    const r = await iniciarGeracao("w1", { idioma: "pt", tom: "natural", intensidade: "media" }, { db: { from } as any });
    expect(r).toEqual({ erro: "O Bunny não está configurado." });
  });
});

const GERACAO_BASE = {
  id: "g1",
  webinarId: "w1",
  idioma: "pt" as const,
  tom: "natural" as const,
  intensidade: "media" as const,
  instrucoes: null,
  fonteUrl: "https://vz-abc.b-cdn.net/g1/original",
  blocos: null,
  blocoAtual: 0,
  mensagensGeradas: 0,
  erro: null,
};

describe("avancarGeracao", () => {
  it("fila: transcreve, agrupa em blocos e passa pra gerando", async () => {
    const update = vi.fn(() => chain({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "geracoes_chat") return { update };
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const transcreverFake = vi.fn(async () => ({
      palavras: [
        { texto: "Oi", inicio: 0, fim: 1 },
        { texto: "pessoal", inicio: 1, fim: 2 },
      ],
    }));
    const completarJsonFake = vi.fn();

    const { avancarGeracao } = await import("@/src/lib/geracao");
    await avancarGeracao(
      { ...GERACAO_BASE, status: "fila" },
      { db: { from } as any, transcrever: transcreverFake, completarJson: completarJsonFake, cfg: CFG_IA },
    );

    expect(transcreverFake).toHaveBeenCalledWith(GERACAO_BASE.fonteUrl, "pt", { elevenlabsKey: "el-key" });
    expect(completarJsonFake).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "gerando", transcricao: "Oi pessoal", bloco_atual: 0 }),
    );
  });

  it("fila sem fala no áudio (sem blocos): termina direto em pronto", async () => {
    const update = vi.fn(() => chain({ error: null }));
    const from = vi.fn(() => ({ update }));
    const transcreverFake = vi.fn(async () => ({ palavras: [] }));

    const { avancarGeracao } = await import("@/src/lib/geracao");
    await avancarGeracao(
      { ...GERACAO_BASE, status: "fila" },
      { db: { from } as any, transcrever: transcreverFake, cfg: CFG_IA },
    );

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "pronto", blocos: [] }));
  });

  it("fila: transcrição falha (erro amigável do cliente) -> status erro com a mesma mensagem", async () => {
    const update = vi.fn(() => chain({ error: null }));
    const from = vi.fn(() => ({ update }));
    const transcreverFake = vi.fn(async () => {
      throw new Error("A transcrição não respondeu.");
    });

    const { avancarGeracao } = await import("@/src/lib/geracao");
    await avancarGeracao(
      { ...GERACAO_BASE, status: "fila" },
      { db: { from } as any, transcrever: transcreverFake, cfg: CFG_IA },
    );

    expect(update).toHaveBeenCalledWith({ status: "erro", erro: "A transcrição não respondeu." });
  });

  it("gerando: processa um bloco, grava as mensagens e avança bloco_atual/mensagens_geradas", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const update = vi.fn(() => chain({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "geracoes_chat") return { update };
      if (tabela === "mensagens_simuladas") return { insert };
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const bloco = { inicio: 0, fim: 60, texto: "trecho 1" };
    const completarJsonFake = vi.fn(async () => ({
      mensagens: [{ segundo: 5, nome: "Ana", texto: "Oi!", suporte: false }],
    }));

    const { avancarGeracao } = await import("@/src/lib/geracao");
    await avancarGeracao(
      { ...GERACAO_BASE, status: "gerando", blocos: [bloco], blocoAtual: 0, mensagensGeradas: 0 },
      { db: { from } as any, completarJson: completarJsonFake, cfg: CFG_IA },
    );

    expect(insert).toHaveBeenCalledWith([{ webinar_id: "w1", segundo: 5, nome: "Ana", texto: "Oi!", suporte: false }]);
    expect(update).toHaveBeenCalledWith({ bloco_atual: 1, mensagens_geradas: 1 });
    expect(update).toHaveBeenCalledWith({ status: "pronto" });
  });

  it("gerando: respeita o orçamento de tempo, para no meio e deixa pra próxima execução retomar", async () => {
    let agora = 1_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => agora);

    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const update = vi.fn(() => chain({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "geracoes_chat") return { update };
      if (tabela === "mensagens_simuladas") return { insert };
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const blocos = [
      { inicio: 0, fim: 60, texto: "trecho 1" },
      { inicio: 60, fim: 120, texto: "trecho 2" },
    ];
    // Cada chamada "gasta" mais que o orçamento: só o primeiro bloco deveria ser processado nesta execução.
    const completarJsonFake = vi.fn(async () => {
      agora += 50_000;
      return { mensagens: [{ segundo: 5, nome: "Ana", texto: "Oi!", suporte: false }] };
    });

    const { avancarGeracao } = await import("@/src/lib/geracao");
    await avancarGeracao(
      { ...GERACAO_BASE, status: "gerando", blocos, blocoAtual: 0, mensagensGeradas: 0 },
      { db: { from } as any, completarJson: completarJsonFake, cfg: CFG_IA },
    );

    expect(completarJsonFake).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ bloco_atual: 1, mensagens_geradas: 1 });
    expect(update).not.toHaveBeenCalledWith({ status: "pronto" });

    dateNowSpy.mockRestore();
  });

  it("gerando: o modelo falha (erro amigável) -> status erro, mantém o progresso já gravado antes", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const update = vi.fn(() => chain({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "geracoes_chat") return { update };
      if (tabela === "mensagens_simuladas") return { insert };
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const completarJsonFake = vi.fn(async () => {
      throw new Error("A IA não respondeu.");
    });

    const { avancarGeracao } = await import("@/src/lib/geracao");
    await avancarGeracao(
      { ...GERACAO_BASE, status: "gerando", blocos: [{ inicio: 0, fim: 60, texto: "x" }], blocoAtual: 0, mensagensGeradas: 0 },
      { db: { from } as any, completarJson: completarJsonFake, cfg: CFG_IA },
    );

    expect(update).toHaveBeenCalledWith({ status: "erro", erro: "A IA não respondeu." });
  });

  it("IA desligada no meio do caminho: status erro com aviso amigável", async () => {
    const update = vi.fn(() => chain({ error: null }));
    const from = vi.fn(() => ({ update }));

    const { avancarGeracao } = await import("@/src/lib/geracao");
    await avancarGeracao({ ...GERACAO_BASE, status: "gerando", blocos: [], blocoAtual: 0 }, { db: { from } as any, cfg: null });

    expect(update).toHaveBeenCalledWith({ status: "erro", erro: "A IA foi desligada enquanto a geração estava em andamento." });
  });

  it("sempre libera o lease (trabalhando_ate = null) ao sair, mesmo com sucesso", async () => {
    const update = vi.fn(() => chain({ error: null }));
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "geracoes_chat") return { update };
      if (tabela === "mensagens_simuladas") return { insert };
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const completarJsonFake = vi.fn(async () => ({ mensagens: [{ segundo: 5, nome: "Ana", texto: "Oi!", suporte: false }] }));

    const { avancarGeracao } = await import("@/src/lib/geracao");
    await avancarGeracao(
      { ...GERACAO_BASE, status: "gerando", blocos: [{ inicio: 0, fim: 60, texto: "x" }], blocoAtual: 0, mensagensGeradas: 0 },
      { db: { from } as any, completarJson: completarJsonFake, cfg: CFG_IA },
    );

    expect(update).toHaveBeenCalledWith({ trabalhando_ate: null });
  });

  it("sempre libera o lease mesmo quando dá erro", async () => {
    const update = vi.fn(() => chain({ error: null }));
    const from = vi.fn(() => ({ update }));

    const { avancarGeracao } = await import("@/src/lib/geracao");
    await avancarGeracao({ ...GERACAO_BASE, status: "gerando", blocos: [], blocoAtual: 0 }, { db: { from } as any, cfg: null });

    expect(update).toHaveBeenCalledWith({ trabalhando_ate: null });
  });
});

describe("reivindicarGeracao", () => {
  it("uma geração por vez: reivindica a mais antiga e bate o lease (trabalhando_ate) atomicamente", async () => {
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    const linha = {
      id: "g1",
      webinar_id: "w1",
      status: "fila",
      idioma: "pt",
      tom: "natural",
      intensidade: "media",
      instrucoes: null,
      fonte_url: "https://x/a.mp4",
      blocos: null,
      bloco_atual: 0,
      mensagens_geradas: 0,
      erro: null,
      trabalhando_ate: null,
      tentativas: 0,
    };
    let chamadaSelect = 0;
    const from = vi.fn(() => {
      chamadaSelect += 1;
      if (chamadaSelect === 1) return chain({ data: linha }, chamadas);
      return chain({ data: { ...linha, status: "transcrevendo", tentativas: 1 } }, chamadas);
    });

    const { reivindicarGeracao } = await import("@/src/lib/geracao");
    const r = await reivindicarGeracao({ from } as any, new Date("2026-01-01T00:05:00.000Z"));

    expect(r).not.toBeNull();
    expect(r?.id).toBe("g1");
    expect(r?.status).toBe("transcrevendo");
    expect(chamadas).toEqual(
      expect.arrayContaining([
        { metodo: "eq", args: ["id", "g1"] },
        { metodo: "is", args: ["trabalhando_ate", null] },
        {
          metodo: "update",
          args: [{ status: "transcrevendo", trabalhando_ate: "2026-01-01T00:10:00.000Z", tentativas: 1 }],
        },
      ]),
    );
  });

  it("geração com lease vencido (travou numa execução anterior): bate lt no trabalhando_ate antigo", async () => {
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    const linha = {
      id: "g1",
      webinar_id: "w1",
      status: "gerando",
      idioma: "pt",
      tom: "natural",
      intensidade: "media",
      instrucoes: null,
      fonte_url: null,
      blocos: [],
      bloco_atual: 0,
      mensagens_geradas: 0,
      erro: null,
      trabalhando_ate: "2026-01-01T00:00:00.000Z",
      tentativas: 1,
    };
    let chamadaSelect = 0;
    const from = vi.fn(() => {
      chamadaSelect += 1;
      if (chamadaSelect === 1) return chain({ data: linha }, chamadas);
      return chain({ data: { ...linha, tentativas: 2 } }, chamadas);
    });
    const { reivindicarGeracao } = await import("@/src/lib/geracao");
    const r = await reivindicarGeracao({ from } as any, new Date("2026-01-01T00:10:00.000Z"));
    expect(r).not.toBeNull();
    expect(chamadas).toEqual(
      expect.arrayContaining([{ metodo: "lt", args: ["trabalhando_ate", "2026-01-01T00:10:00.000Z"] }]),
    );
  });

  it("sem nenhuma geração em andamento: devolve null", async () => {
    const from = vi.fn(() => chain({ data: null }));
    const { reivindicarGeracao } = await import("@/src/lib/geracao");
    const r = await reivindicarGeracao({ from } as any, new Date());
    expect(r).toBeNull();
  });

  it("outra execução reivindicou primeiro (update não bate o lease): devolve null", async () => {
    const linha = {
      id: "g1",
      webinar_id: "w1",
      status: "gerando",
      idioma: "pt",
      tom: "natural",
      intensidade: "media",
      instrucoes: null,
      fonte_url: null,
      blocos: [],
      bloco_atual: 0,
      mensagens_geradas: 0,
      erro: null,
      trabalhando_ate: null,
      tentativas: 0,
    };
    let chamadaSelect = 0;
    const from = vi.fn(() => {
      chamadaSelect += 1;
      if (chamadaSelect === 1) return chain({ data: linha });
      return chain({ data: null }); // perdeu a corrida
    });
    const { reivindicarGeracao } = await import("@/src/lib/geracao");
    const r = await reivindicarGeracao({ from } as any, new Date("2026-01-01T00:10:00.000Z"));
    expect(r).toBeNull();
  });

  it("já reivindicada 3 vezes sem terminar: marca erro direto, sem reivindicar de novo", async () => {
    const linha = {
      id: "g1",
      webinar_id: "w1",
      status: "gerando",
      idioma: "pt",
      tom: "natural",
      intensidade: "media",
      instrucoes: null,
      fonte_url: null,
      blocos: [],
      bloco_atual: 0,
      mensagens_geradas: 0,
      erro: null,
      trabalhando_ate: null,
      tentativas: 3,
    };
    const update = vi.fn(() => chain({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela !== "geracoes_chat") throw new Error(`tabela inesperada: ${tabela}`);
      return { ...chain({ data: linha }), update };
    });
    const { reivindicarGeracao } = await import("@/src/lib/geracao");
    const r = await reivindicarGeracao({ from } as any, new Date("2026-01-01T00:10:00.000Z"));
    expect(r).toBeNull();
    expect(update).toHaveBeenCalledWith({ status: "erro", erro: "A geração não terminou. Tente de novo." });
  });
});
