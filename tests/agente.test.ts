import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const iaConfig = vi.fn();
vi.mock("@/src/lib/env", () => ({ iaConfig: (...a: unknown[]) => iaConfig(...a) }));

const CFG_IA = { openrouterKey: "or-key", modelo: "modelo-x", elevenlabsKey: null };

function chain(resultado: unknown, chamadas: { metodo: string; args: unknown[] }[] = []) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "neq", "is", "in", "or", "lte", "lt", "gte", "order", "limit", "insert", "update"]) {
    p[m] = (...args: unknown[]) => {
      chamadas.push({ metodo: m, args });
      return p;
    };
  }
  p.single = () => Promise.resolve(resultado);
  p.maybeSingle = () => Promise.resolve(resultado);
  return p;
}

// Sessão ao vivo, sem atendente humano, começou há 5 min; vídeo de 1h — a transmissão não terminou.
const AGORA = new Date("2026-10-20T12:05:00.000Z");
const SESSAO_AO_VIVO_NAO_PROVISORIA = {
  modo: "ao_vivo",
  status_atendimento: "aguardando",
  inicio_sessao: "2026-10-20T12:00:00.000Z",
  participantes: { temporario: false },
};
const AGENTE_LIGADO = { ligado: true, nome: "Suporte", instrucoes: null, contexto: "Curso X", faq: null };
const VIDEO_UMA_HORA = { data: { videos: { duracao_seg: 3600 } } };

/** Monta um `from` que atende, na ordem em que `responderComAgente` consulta: sessoes, webinar_video, agentes_ia,
 *  3x mensagens_suporte (contagem ia/hora, contagem participante/hora, contagem webinar/minuto), mensagens_suporte
 *  (histórico), mensagens_suporte (insert). */
function dbPadrao(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    sessoes: { data: SESSAO_AO_VIVO_NAO_PROVISORIA },
    video: VIDEO_UMA_HORA,
    agentes_ia: { data: AGENTE_LIGADO },
    contagemIa: { count: 0 },
    contagemParticipante: { count: 0 },
    contagemWebinar: { count: 0 },
    historico: { data: [] },
    ofertas: { data: null },
    ...overrides,
  };
  let chamadaMensagens = 0;
  const from = vi.fn((tabela: string) => {
    if (tabela === "sessoes") return chain(base.sessoes);
    if (tabela === "webinar_video") return chain(base.video);
    if (tabela === "agentes_ia") return chain(base.agentes_ia);
    if (tabela === "ofertas") return chain(base.ofertas);
    if (tabela === "mensagens_suporte") {
      chamadaMensagens += 1;
      if (chamadaMensagens === 1) return chain(base.contagemIa);
      if (chamadaMensagens === 2) return chain(base.contagemParticipante);
      if (chamadaMensagens === 3) return chain(base.contagemWebinar);
      if (chamadaMensagens === 4) return chain(base.historico);
      return { insert: vi.fn(() => Promise.resolve({ error: null })) };
    }
    throw new Error(`tabela inesperada: ${tabela}`);
  });
  return { from };
}

const PARAMS = { sessaoId: "s1", webinarId: "w1", texto: "Qual o preço do curso?", mensagemId: "m1" };

beforeEach(() => {
  vi.resetModules();
  iaConfig.mockReset();
  iaConfig.mockReturnValue(CFG_IA);
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("responderComAgente", () => {
  it("IA desligada (sem chave): não responde, não consulta nada", async () => {
    iaConfig.mockReturnValue(null);
    const from = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: { from } as any });
    expect(from).not.toHaveBeenCalled();
  });

  it("texto vazio (só espaços): não responde", async () => {
    const from = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente({ ...PARAMS, texto: "   " }, { db: { from } as any });
    expect(from).not.toHaveBeenCalled();
  });

  it("texto curto (< 8) sem '?': não responde, não consulta nada (poupa a chamada ao modelo)", async () => {
    const from = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente({ ...PARAMS, texto: "kkkkk" }, { db: { from } as any });
    expect(from).not.toHaveBeenCalled();
  });

  it("texto curto (< 8) mas com '?': consulta normalmente", async () => {
    const db = dbPadrao();
    const completarJsonFake = vi.fn(async () => ({ responder: false, resposta: "" }));
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente({ ...PARAMS, texto: "oi?" }, { db: db as any, completarJson: completarJsonFake });
    expect(completarJsonFake).toHaveBeenCalled();
  });

  it("sessão em replay: não responde", async () => {
    const db = dbPadrao({ sessoes: { data: { ...SESSAO_AO_VIVO_NAO_PROVISORIA, modo: "replay" } } });
    const completarJsonFake = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });
    expect(completarJsonFake).not.toHaveBeenCalled();
  });

  it("sessão em modo teste: não responde", async () => {
    const db = dbPadrao({ sessoes: { data: { ...SESSAO_AO_VIVO_NAO_PROVISORIA, modo: "teste" } } });
    const completarJsonFake = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });
    expect(completarJsonFake).not.toHaveBeenCalled();
  });

  it("sessão provisória: não responde, mesmo ao_vivo", async () => {
    const db = dbPadrao({ sessoes: { data: { ...SESSAO_AO_VIVO_NAO_PROVISORIA, participantes: { temporario: true } } } });
    const completarJsonFake = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });
    expect(completarJsonFake).not.toHaveBeenCalled();
  });

  it("atendente humano conversando agora (status_atendimento = atendendo): não responde", async () => {
    const db = dbPadrao({ sessoes: { data: { ...SESSAO_AO_VIVO_NAO_PROVISORIA, status_atendimento: "atendendo" } } });
    const completarJsonFake = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });
    expect(completarJsonFake).not.toHaveBeenCalled();
  });

  it("transmissão já encerrada (início + duração do vídeo no passado): não responde", async () => {
    const db = dbPadrao({
      sessoes: { data: { ...SESSAO_AO_VIVO_NAO_PROVISORIA, inicio_sessao: "2026-10-20T08:00:00.000Z" } }, // 4h atrás
      video: { data: { videos: { duracao_seg: 3600 } } }, // vídeo de 1h, bem menor que o tempo decorrido
    });
    const completarJsonFake = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });
    expect(completarJsonFake).not.toHaveBeenCalled();
  });

  it("agente desligado: não responde", async () => {
    const db = dbPadrao({ agentes_ia: { data: { ...AGENTE_LIGADO, ligado: false } } });
    const completarJsonFake = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });
    expect(completarJsonFake).not.toHaveBeenCalled();
  });

  it("webinar sem agente configurado: não responde", async () => {
    const db = dbPadrao({ agentes_ia: { data: null } });
    const completarJsonFake = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });
    expect(completarJsonFake).not.toHaveBeenCalled();
  });

  it("limite de 20 respostas da IA por sessão/hora já atingido: não responde", async () => {
    const db = dbPadrao({ contagemIa: { count: 20 } });
    const completarJsonFake = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });
    expect(completarJsonFake).not.toHaveBeenCalled();
  });

  it("limite de 30 mensagens processadas por sessão/hora já atingido: não responde", async () => {
    const db = dbPadrao({ contagemParticipante: { count: 30 } });
    const completarJsonFake = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });
    expect(completarJsonFake).not.toHaveBeenCalled();
  });

  it("teto de 120 por webinar/minuto já atingido: não responde", async () => {
    const db = dbPadrao({ contagemWebinar: { count: 120 } });
    const completarJsonFake = vi.fn();
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });
    expect(completarJsonFake).not.toHaveBeenCalled();
  });

  it("modelo decide não responder (não é pergunta sobre o conteúdo): nada é gravado", async () => {
    const db = dbPadrao();
    const insert = vi.fn();
    (db.from as any).mockImplementation((tabela: string) => {
      if (tabela === "sessoes") return chain({ data: SESSAO_AO_VIVO_NAO_PROVISORIA });
      if (tabela === "webinar_video") return chain(VIDEO_UMA_HORA);
      if (tabela === "agentes_ia") return chain({ data: AGENTE_LIGADO });
      if (tabela === "mensagens_suporte") return { ...chain({ count: 0, data: [] }), insert };
      if (tabela === "ofertas") return chain({ data: null });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const completarJsonFake = vi.fn(async () => ({ responder: false, resposta: "" }));
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });
    expect(insert).not.toHaveBeenCalled();
  });

  it("responde e grava mensagens_suporte com autor 'ia', pedindo no máximo 400 tokens", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    let chamadaMensagens = 0;
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes") return chain({ data: SESSAO_AO_VIVO_NAO_PROVISORIA });
      if (tabela === "webinar_video") return chain(VIDEO_UMA_HORA);
      if (tabela === "agentes_ia") return chain({ data: AGENTE_LIGADO });
      if (tabela === "mensagens_suporte") {
        chamadaMensagens += 1;
        if (chamadaMensagens <= 3) return chain({ count: 3 });
        if (chamadaMensagens === 4) return chain({ data: [{ autor: "participante", texto: "Oi" }] });
        return { insert };
      }
      if (tabela === "ofertas") return chain({ data: null });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const completarJsonFake = vi.fn(async () => ({ responder: true, resposta: "Custa 97 reais, só o que está na página." }));

    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: { from } as any, completarJson: completarJsonFake });

    expect(insert).toHaveBeenCalledWith({
      sessao_id: "s1",
      webinar_id: "w1",
      autor: "ia",
      texto: "Custa 97 reais, só o que está na página.",
    });
    expect(completarJsonFake).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 400 }), expect.anything());
  });

  it("remove da resposta links que não estão no contexto/FAQ configurados", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const db = dbPadrao({ agentes_ia: { data: { ...AGENTE_LIGADO, contexto: "Garantia em https://site.com/garantia" } } });
    let chamadaMensagens = 0;
    (db.from as any).mockImplementation((tabela: string) => {
      if (tabela === "sessoes") return chain({ data: SESSAO_AO_VIVO_NAO_PROVISORIA });
      if (tabela === "webinar_video") return chain(VIDEO_UMA_HORA);
      if (tabela === "agentes_ia") return chain({ data: { ...AGENTE_LIGADO, contexto: "Garantia em https://site.com/garantia" } });
      if (tabela === "mensagens_suporte") {
        chamadaMensagens += 1;
        if (chamadaMensagens <= 3) return chain({ count: 0 });
        if (chamadaMensagens === 4) return chain({ data: [] });
        return { insert };
      }
      if (tabela === "ofertas") return chain({ data: null });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const completarJsonFake = vi.fn(async () => ({
      responder: true,
      resposta: "Garantia em https://site.com/garantia, e o bônus em https://outro.com/inventado",
    }));
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ texto: expect.stringContaining("https://site.com/garantia") }),
    );
    const chamada = (insert.mock.calls[0] as unknown as [{ texto: string }])[0];
    expect(chamada.texto).not.toContain("outro.com/inventado");
  });

  it("antes da oferta aparecer: resposta com link vira o \"fica até o final\" (trava no código)", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    let chamadaMensagens = 0;
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes") return chain({ data: { ...SESSAO_AO_VIVO_NAO_PROVISORIA, max_segundo: 120 } });
      if (tabela === "webinar_video") return chain(VIDEO_UMA_HORA);
      if (tabela === "agentes_ia") return chain({ data: { ...AGENTE_LIGADO, faq: "Link: https://site.com/aplicacao" } });
      if (tabela === "ofertas") return chain({ data: { ligada: true, aparece_seg: 1800 } });
      if (tabela === "mensagens_suporte") {
        chamadaMensagens += 1;
        if (chamadaMensagens <= 3) return chain({ count: 0 });
        if (chamadaMensagens === 4) return chain({ data: [] });
        return { insert };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const completarJsonFake = vi.fn(async () => ({ responder: true, resposta: "Aqui, ó: https://site.com/aplicacao" }));
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: { from } as any, completarJson: completarJsonFake });
    const { RESPOSTA_ANTES_DA_OFERTA } = await import("@/src/lib/regras/ia");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ texto: RESPOSTA_ANTES_DA_OFERTA }));
  });

  it("depois da oferta aparecer: o link autorizado sai normalmente", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    let chamadaMensagens = 0;
    const from = vi.fn((tabela: string) => {
      // Sessão começou há 5 min (300 s) e a oferta aparece em 200 s.
      if (tabela === "sessoes") return chain({ data: { ...SESSAO_AO_VIVO_NAO_PROVISORIA, max_segundo: 0 } });
      if (tabela === "webinar_video") return chain(VIDEO_UMA_HORA);
      if (tabela === "agentes_ia") return chain({ data: { ...AGENTE_LIGADO, faq: "Link: https://site.com/aplicacao" } });
      if (tabela === "ofertas") return chain({ data: { ligada: true, aparece_seg: 200 } });
      if (tabela === "mensagens_suporte") {
        chamadaMensagens += 1;
        if (chamadaMensagens <= 3) return chain({ count: 0 });
        if (chamadaMensagens === 4) return chain({ data: [] });
        return { insert };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const completarJsonFake = vi.fn(async () => ({ responder: true, resposta: "Aqui, ó: https://site.com/aplicacao" }));
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: { from } as any, completarJson: completarJsonFake });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ texto: "Aqui, ó: https://site.com/aplicacao" }));
  });

  it("não inclui a própria mensagem do participante (mensagemId) no histórico", async () => {
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    let chamadaMensagens = 0;
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes") return chain({ data: SESSAO_AO_VIVO_NAO_PROVISORIA });
      if (tabela === "webinar_video") return chain(VIDEO_UMA_HORA);
      if (tabela === "agentes_ia") return chain({ data: AGENTE_LIGADO });
      if (tabela === "mensagens_suporte") {
        chamadaMensagens += 1;
        if (chamadaMensagens <= 3) return chain({ count: 0 });
        if (chamadaMensagens === 4) return chain({ data: [] }, chamadas);
        return { insert };
      }
      if (tabela === "ofertas") return chain({ data: null });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const completarJsonFake = vi.fn(async () => ({ responder: false, resposta: "" }));
    const { responderComAgente } = await import("@/src/lib/agente");
    await responderComAgente(PARAMS, { db: { from } as any, completarJson: completarJsonFake });
    expect(chamadas).toEqual(expect.arrayContaining([{ metodo: "neq", args: ["id", "m1"] }]));
  });

  it("nunca lança: erro do modelo só vira log, nada é gravado", async () => {
    const db = dbPadrao();
    const insert = vi.fn();
    (db.from as any).mockImplementation((tabela: string) => {
      if (tabela === "sessoes") return chain({ data: SESSAO_AO_VIVO_NAO_PROVISORIA });
      if (tabela === "webinar_video") return chain(VIDEO_UMA_HORA);
      if (tabela === "agentes_ia") return chain({ data: AGENTE_LIGADO });
      if (tabela === "mensagens_suporte") return { ...chain({ count: 0, data: [] }), insert };
      if (tabela === "ofertas") return chain({ data: null });
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    const completarJsonFake = vi.fn(async () => {
      throw new Error("A IA não respondeu.");
    });
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { responderComAgente } = await import("@/src/lib/agente");
    await expect(responderComAgente(PARAMS, { db: db as any, completarJson: completarJsonFake })).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
    erroSpy.mockRestore();
  });
});

describe("testarAgente", () => {
  it("IA desligada: não responde, com erro explicando", async () => {
    iaConfig.mockReturnValue(null);
    const completarJsonFake = vi.fn();
    const { testarAgente } = await import("@/src/lib/agente");
    const r = await testarAgente({ nome: "Suporte", instrucoes: null, contexto: "x", faq: null }, "Qual o preço?", { completarJson: completarJsonFake });
    expect(r.resposta).toBeNull();
    expect(r.erro).toBeTruthy();
    expect(completarJsonFake).not.toHaveBeenCalled();
  });

  it("modelo responde: devolve a resposta, sem gravar nada (sem acesso a banco)", async () => {
    const completarJsonFake = vi.fn(async () => ({ responder: true, resposta: "Sim, é sobre marketing digital." }));
    const { testarAgente } = await import("@/src/lib/agente");
    const r = await testarAgente({ nome: "Suporte", instrucoes: null, contexto: "Curso de marketing", faq: null }, "É sobre o quê o curso?", {
      completarJson: completarJsonFake,
    });
    expect(r).toEqual({ resposta: "Sim, é sobre marketing digital." });
  });

  it("modelo decide não responder: resposta null, sem erro", async () => {
    const completarJsonFake = vi.fn(async () => ({ responder: false, resposta: "" }));
    const { testarAgente } = await import("@/src/lib/agente");
    const r = await testarAgente({ nome: "Suporte", instrucoes: null, contexto: null, faq: null }, "Oi, bom dia!", { completarJson: completarJsonFake });
    expect(r.resposta).toBeNull();
    expect(r.erro).toBeUndefined();
  });

  it("erro de verdade do cliente de IA: devolve o erro amigável de verdade, não esconde atrás de 'não respondida'", async () => {
    const completarJsonFake = vi.fn(async () => {
      throw new Error("A IA não respondeu.");
    });
    const { testarAgente } = await import("@/src/lib/agente");
    const r = await testarAgente({ nome: "Suporte", instrucoes: null, contexto: null, faq: null }, "Oi", { completarJson: completarJsonFake });
    expect(r.resposta).toBeNull();
    expect(r.erro).toBe("A IA não respondeu.");
  });
});
