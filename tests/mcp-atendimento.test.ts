import { beforeEach, describe, expect, it, vi } from "vitest";

const dbAdmin = vi.fn();
const registrarAuditoria = vi.fn();

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));

type Chamada = { tabela: string; metodo: string; args: unknown[] };

/** Chain estilo Supabase: registra cada chamada e resolve pro `resultado` (em `maybeSingle`, `range` ou direto). */
function chain(tabela: string, resultado: unknown, chamadas: Chamada[]) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "neq", "in", "or", "gte", "not", "order", "limit", "insert", "update"]) {
    p[m] = (...args: unknown[]) => {
      chamadas.push({ tabela, metodo: m, args });
      return p;
    };
  }
  p.maybeSingle = () => Promise.resolve(resultado);
  p.range = () => Promise.resolve(resultado);
  return p;
}

/** Banco falso: cada tabela devolve, em ordem, os resultados da fila dela (o último se repete). */
function banco(filas: Record<string, unknown[]>, rpcs: Record<string, unknown> = {}) {
  const chamadas: Chamada[] = [];
  const usados: Record<string, number> = {};
  const db = {
    from: (tabela: string) => {
      const fila = filas[tabela];
      if (!fila) throw new Error("tabela inesperada: " + tabela);
      const i = usados[tabela] ?? 0;
      usados[tabela] = i + 1;
      return chain(tabela, fila[Math.min(i, fila.length - 1)], chamadas);
    },
    rpc: (nome: string, args: unknown) => {
      chamadas.push({ tabela: "rpc", metodo: nome, args: [args] });
      return Promise.resolve(rpcs[nome] ?? { data: [], error: null });
    },
  };
  dbAdmin.mockReturnValue(db);
  return chamadas;
}

const WEB = "11111111-1111-4111-8111-111111111111";
const SES = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";
const EU = "44444444-4444-4444-8444-444444444444";
const OUTRO = "55555555-5555-4555-8555-555555555555";
const CHAVE = { id: "k1", nome: "Claude", permissao: "escrita" as const, usuarioId: EU };

const sessao = (extra: Record<string, unknown> = {}) => ({
  data: { id: SES, webinar_id: WEB, atendente_id: null, status_atendimento: "aguardando", participantes: { nome: "Ana" }, ...extra },
  error: null,
});

async function ferramenta(nome: string) {
  const { FERRAMENTAS_ATENDIMENTO } = await import("../src/lib/mcp/ferramentas/atendimento");
  const f = FERRAMENTAS_ATENDIMENTO.find((x) => x.name === nome);
  if (!f) throw new Error("ferramenta ausente: " + nome);
  return f;
}
const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

beforeEach(() => {
  vi.resetModules();
  dbAdmin.mockReset();
  registrarAuditoria.mockReset();
});

describe("registro", () => {
  it("leituras não exigem escrita; as que mudam algo exigem", async () => {
    const { FERRAMENTAS_ATENDIMENTO } = await import("../src/lib/mcp/ferramentas/atendimento");
    const escrita = Object.fromEntries(FERRAMENTAS_ATENDIMENTO.map((f) => [f.name, f.escrita]));
    expect(escrita).toEqual({
      ao_vivo_agora: false,
      listar_conversas: false,
      ver_conversa: false,
      responder_participante: true,
      mudar_status_atendimento: true,
      editar_mensagem_atendimento: true,
      apagar_mensagem_atendimento: true,
    });
    for (const f of FERRAMENTAS_ATENDIMENTO) expect(f.inputSchema.additionalProperties).toBe(false);
    expect((await ferramenta("responder_participante")).description).toMatch(/confirm/i);
  });
});

describe("responder_participante", () => {
  it("valida o texto com a mesma regra do painel antes de tocar no banco", async () => {
    const f = await ferramenta("responder_participante");
    const r = await f.executar(CHAVE, { sessao_id: SES, texto: "   " });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Escreva uma mensagem ou envie uma imagem.");
    const r2 = await f.executar(CHAVE, { sessao_id: SES, texto: "a".repeat(1001) });
    expect(r2.content[0].text).toBe("A mensagem passa de 1000 caracteres.");
    expect(dbAdmin).not.toHaveBeenCalled();
  });

  it("chave sem dono não age como atendente", async () => {
    const f = await ferramenta("responder_participante");
    const r = await f.executar({ ...CHAVE, usuarioId: null }, { sessao_id: SES, texto: "Oi" });
    expect(r.isError).toBe(true);
    expect(dbAdmin).not.toHaveBeenCalled();
  });

  it("recusa quando outro atendente está atendendo", async () => {
    const chamadas = banco({ sessoes: [sessao({ atendente_id: OUTRO, status_atendimento: "atendendo" })] });
    const f = await ferramenta("responder_participante");
    const r = await f.executar(CHAVE, { sessao_id: SES, texto: "Oi" });
    expect(r.content[0].text).toBe("Outro atendente está atendendo esta conversa.");
    expect(chamadas.some((c) => c.metodo === "update" || c.metodo === "insert")).toBe(false);
  });

  it("conversa de outro webinar → não encontrada", async () => {
    banco({ sessoes: [sessao({ webinar_id: OUTRO })] });
    const f = await ferramenta("responder_participante");
    const r = await f.executar(CHAVE, { sessao_id: SES, webinar_id: WEB, texto: "Oi" });
    expect(r.content[0].text).toBe("Conversa não encontrada.");
  });

  it("assume de forma atômica, grava como atendente e audita", async () => {
    const chamadas = banco({
      sessoes: [sessao(), { data: { id: SES }, error: null }],
      mensagens_suporte: [{ data: { id: MSG, created_at: "2026-10-21T15:00:00Z" }, error: null }],
    });
    const f = await ferramenta("responder_participante");
    const r = await f.executar(CHAVE, { sessao_id: SES, texto: "  Olá, Ana!  " });
    expect(r.isError).toBeUndefined();
    expect(json(r)).toMatchObject({ enviada: true, mensagemId: MSG, participante: "Ana", status: "atendendo" });

    const update = chamadas.find((c) => c.tabela === "sessoes" && c.metodo === "update");
    expect(update?.args[0]).toEqual({ atendente_id: EU, status_atendimento: "atendendo" });
    expect(chamadas.find((c) => c.tabela === "sessoes" && c.metodo === "or")?.args[0]).toBe(
      `atendente_id.eq.${EU},atendente_id.is.null,status_atendimento.in.(aguardando,dispensado)`,
    );
    const insert = chamadas.find((c) => c.metodo === "insert");
    expect(insert?.args[0]).toEqual({ sessao_id: SES, webinar_id: WEB, autor: "atendente", autor_id: EU, texto: "Olá, Ana!", imagem_url: null });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: EU, webinarId: WEB, acao: "criou", descricao: "Respondeu Ana na sala de atendimento (MCP)" }),
    );
  });

  it("outro atendente assumiu no meio (update não acerta linha) → erro, sem mensagem", async () => {
    const chamadas = banco({ sessoes: [sessao(), { data: null, error: null }], mensagens_suporte: [{ data: null, error: null }] });
    const f = await ferramenta("responder_participante");
    const r = await f.executar(CHAVE, { sessao_id: SES, texto: "Oi" });
    expect(r.content[0].text).toBe("Outro atendente está atendendo esta conversa.");
    expect(chamadas.some((c) => c.metodo === "insert")).toBe(false);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe("mudar_status_atendimento", () => {
  it("encerrar filtra pelo próprio atendente e explica quando não é ele", async () => {
    const chamadas = banco({ sessoes: [sessao({ atendente_id: OUTRO, status_atendimento: "atendendo" }), { data: null, error: null }] });
    const f = await ferramenta("mudar_status_atendimento");
    const r = await f.executar(CHAVE, { sessao_id: SES, acao: "encerrar" });
    expect(r.content[0].text).toBe("Você não está atendendo esta conversa.");
    expect(chamadas.find((c) => c.metodo === "update")?.args[0]).toEqual({ status_atendimento: "atendido" });
    expect(chamadas.filter((c) => c.metodo === "eq").map((c) => c.args)).toContainEqual(["atendente_id", EU]);
  });

  it("dispensar tira da fila com a guarda atômica e audita", async () => {
    const chamadas = banco({ sessoes: [sessao(), { data: { id: SES }, error: null }] });
    const f = await ferramenta("mudar_status_atendimento");
    const r = await f.executar(CHAVE, { sessao_id: SES, acao: "dispensar" });
    expect(json(r)).toMatchObject({ ok: true, status: "dispensado" });
    expect(chamadas.find((c) => c.metodo === "update")?.args[0]).toEqual({ atendente_id: null, status_atendimento: "dispensado" });
    expect(chamadas.find((c) => c.metodo === "or")?.args[0]).toBe("atendente_id.is.null,status_atendimento.in.(aguardando,dispensado)");
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "editou", descricao: "Dispensou o atendimento de Ana (MCP)" }));
  });

  it("assumir já assumida por outro → mesma mensagem do painel", async () => {
    banco({ sessoes: [sessao({ atendente_id: OUTRO, status_atendimento: "atendendo" }), { data: null, error: null }] });
    const f = await ferramenta("mudar_status_atendimento");
    const r = await f.executar(CHAVE, { sessao_id: SES, acao: "assumir" });
    expect(r.content[0].text).toBe("Outro atendente já assumiu esta conversa.");
  });
});

describe("editar/apagar mensagem", () => {
  const msg = (extra: Record<string, unknown> = {}) => ({
    data: { id: MSG, webinar_id: WEB, autor: "atendente", autor_id: EU, texto: "Oi", imagem_url: null, apagada: false, ...extra },
    error: null,
  });

  it("só as próprias mensagens", async () => {
    const chamadas = banco({ mensagens_suporte: [msg({ autor_id: OUTRO })] });
    const f = await ferramenta("editar_mensagem_atendimento");
    const r = await f.executar(CHAVE, { mensagem_id: MSG, texto: "Novo" });
    expect(r.content[0].text).toBe("Você só pode editar as próprias mensagens.");
    expect(chamadas.some((c) => c.metodo === "update")).toBe(false);
  });

  it("mensagem com imagem não se edita (idêntico ao painel)", async () => {
    banco({ mensagens_suporte: [msg({ imagem_url: "https://x/y.jpg" })] });
    const f = await ferramenta("editar_mensagem_atendimento");
    const r = await f.executar(CHAVE, { mensagem_id: MSG, texto: "Novo" });
    expect(r.isError).toBe(true);
  });

  it("edita marcando editada, com os mesmos filtros da action", async () => {
    const chamadas = banco({ mensagens_suporte: [msg(), { data: { id: MSG }, error: null }] });
    const f = await ferramenta("editar_mensagem_atendimento");
    const r = await f.executar(CHAVE, { mensagem_id: MSG, texto: " Novo texto " });
    expect(json(r)).toMatchObject({ ok: true, texto: "Novo texto" });
    expect(chamadas.find((c) => c.metodo === "update")?.args[0]).toEqual({ texto: "Novo texto", editada: true });
    const eqs = chamadas.filter((c) => c.metodo === "eq").map((c) => c.args);
    expect(eqs).toContainEqual(["autor", "atendente"]);
    expect(eqs).toContainEqual(["autor_id", EU]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "editou", antes: { texto: "Oi" }, depois: { texto: "Novo texto" } }));
  });

  it("apaga (soft delete)", async () => {
    const chamadas = banco({ mensagens_suporte: [msg(), { data: { id: MSG }, error: null }] });
    const f = await ferramenta("apagar_mensagem_atendimento");
    const r = await f.executar(CHAVE, { mensagem_id: MSG });
    expect(json(r)).toMatchObject({ ok: true, apagada: true });
    expect(chamadas.find((c) => c.metodo === "update")?.args[0]).toEqual({ apagada: true });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "excluiu" }));
  });
});

const linhaConversa = (extra: Record<string, unknown> = {}) => ({
  sessao_id: SES,
  participante_nome: "Ana",
  participante_email: "ana@x.com",
  participante_telefone: null,
  inicio_sessao: "2026-10-21T22:00:00Z",
  ultimo_sinal_em: null,
  status_atendimento: "aguardando",
  atendente_id: null,
  atendente_nome: null,
  ultima_texto: "Qual o preço?",
  ultima_imagem: false,
  ultima_autor: "participante",
  ultima_em: "2026-10-21T22:10:00Z",
  ultima_apagada: false,
  nao_lidas: 2,
  ...extra,
});

describe("leituras", () => {
  it("webinar inexistente", async () => {
    banco({ webinars: [{ data: null, error: null }] });
    const f = await ferramenta("ao_vivo_agora");
    const r = await f.executar(CHAVE, { webinar_id: WEB });
    expect(r.content[0].text).toBe("Webinar não encontrado.");
    expect((await f.executar(CHAVE, { webinar_id: "x" })).isError).toBe(true);
  });

  it("ao_vivo_agora: totais do banco, minuto de cada um e conversas aguardando", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T22:12:30Z"));
    try {
      const chamadas = banco(
        {
          webinars: [{ data: { id: WEB, nome: "Aula", slug: "aula", tipo_agenda: "unica", sincronizar_video: true, status: "ativo" }, error: null }],
          agendas: [
            {
              data: { fuso: "America/Sao_Paulo", inicio: "2026-10-21T22:00:00Z", fim: "2026-10-21T23:30:00Z", repeticao: "nenhuma", dia_semana: null, hora_inicio: null, hora_fim: null, vigencia_fim: null },
              error: null,
            },
          ],
          webinar_video: [{ data: { videos: { duracao_seg: 3600 } }, error: null }],
          sessoes: [
            {
              data: [
                { id: SES, modo: "ao_vivo", inicio_sessao: "2026-10-21T22:00:00Z", jit_horario: null, posicao_replay_seg: null, dispositivo: "mobile", cidade: "Recife", pais: "BR", status_atendimento: "aguardando", participantes: { nome: "Ana" } },
                { id: OUTRO, modo: "replay", inicio_sessao: "2026-10-20T22:00:00Z", jit_horario: null, posicao_replay_seg: 95, dispositivo: "desktop", cidade: null, pais: null, status_atendimento: "aguardando", participantes: null },
              ],
              error: null,
            },
          ],
        },
        {
          metricas_ao_vivo: { data: [{ ao_vivo: 1, replay: 1, desktop: 1, mobile: 1 }], error: null },
          conversas_atendimento: { data: [linhaConversa(), linhaConversa({ sessao_id: OUTRO, nao_lidas: 0 })], error: null },
        },
      );
      const f = await ferramenta("ao_vivo_agora");
      const d = json(await f.executar(CHAVE, { webinar_id: WEB }));
      expect(d.online).toEqual({ aoVivo: 1, replay: 1, total: 2, desktop: 1, celular: 1 });
      expect(d.pessoas[0]).toMatchObject({ nome: "Ana", modo: "ao_vivo", segundo: 750, minuto: "12:30", local: "Recife, BR" });
      expect(d.pessoas[1]).toMatchObject({ nome: "Sem nome", modo: "replay", minuto: "1:35" });
      expect(d.transmissao).toMatchObject({ estado: "aberta", acontecendoAgora: true, minuto: "12:30" });
      expect(d.atendimento.aguardandoResposta).toBe(1);
      // Mesma regra do painel: só modos reais, sinal nos últimos 60 s.
      expect(chamadas.find((c) => c.tabela === "sessoes" && c.metodo === "in")?.args).toEqual(["modo", ["ao_vivo", "replay"]]);
      expect(chamadas.find((c) => c.tabela === "sessoes" && c.metodo === "gte")?.args).toEqual(["ultimo_sinal_em", "2026-10-21T22:11:30.000Z"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("listar_conversas filtra sem resposta e traz quem respondeu por último", async () => {
    banco(
      {
        webinars: [{ data: { id: WEB, nome: "Aula", slug: "aula", tipo_agenda: "unica", sincronizar_video: false, status: "ativo" }, error: null }],
        mensagens_suporte: [{ data: [{ id: MSG, sessao_id: SES, autor: "chatbot", created_at: "2026-10-21T22:05:00Z", usuarios: null }], error: null }],
      },
      { conversas_atendimento: { data: [linhaConversa(), linhaConversa({ sessao_id: OUTRO, nao_lidas: 0 })], error: null } },
    );
    const f = await ferramenta("listar_conversas");
    const d = json(await f.executar(CHAVE, { webinar_id: WEB, sem_resposta: true }));
    expect(d.total).toBe(1);
    expect(d.conversas[0]).toMatchObject({ sessaoId: SES, naoRespondidas: 2, ultimaResposta: { autor: "chatbot" }, ultimaMensagem: { previa: "Qual o preço?" } });
    expect((await f.executar(CHAVE, { webinar_id: WEB, de: "21/10/2026" })).content[0].text).toBe("Use datas no formato AAAA-MM-DD.");
  });

  it("ver_conversa: minuto do vídeo em que cada mensagem foi escrita (ao vivo)", async () => {
    banco({
      sessoes: [
        { data: { id: SES, webinar_id: WEB, inicio_sessao: "2026-10-21T22:00:00Z", atendente_id: EU, status_atendimento: "atendendo", participantes: { nome: "Ana", email: null, telefone_e164: null } }, error: null },
        { data: { modo: "ao_vivo", ultimo_sinal_em: null, posicao_replay_seg: null }, error: null },
      ],
      mensagens_suporte: [
        {
          data: [
            { id: MSG, autor: "participante", autor_id: null, texto: "Oi", imagem_url: null, editada: false, apagada: false, created_at: "2026-10-21T22:03:05Z", usuarios: null },
            { id: OUTRO, autor: "atendente", autor_id: EU, texto: "Olá", imagem_url: null, editada: false, apagada: false, created_at: "2026-10-21T22:04:00Z", usuarios: { nome: "Paula" } },
          ],
          error: null,
        },
      ],
      webinar_video: [{ data: { videos: { duracao_seg: 3600 } }, error: null }],
      usuarios: [{ data: { nome: "Paula" }, error: null }],
    });
    const f = await ferramenta("ver_conversa");
    const d = json(await f.executar(CHAVE, { sessao_id: SES }));
    expect(d.mensagens.map((m: { videoNoMinuto: string }) => m.videoNoMinuto)).toEqual(["3:05", "4:00"]);
    expect(d.mensagens[1]).toMatchObject({ autor: "atendente", nome: "Paula", minha: true });
    expect(d).toMatchObject({ atendente: "Paula", souOAtendente: true, modo: "ao_vivo" });
  });
});
