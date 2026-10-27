import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.SALA_TOKEN_SECRET ??= "segredo-da-sala-para-testes-1234567890";
process.env.NEXT_PUBLIC_SALA_URL ??= "https://sala.x.com";

const dbAdmin = vi.fn();
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));

const AGORA = new Date("2026-11-03T22:00:00Z");
const JIT = new Date("2026-11-03T23:00:00Z");
const CFG = { resendKey: "re_teste", de: "Vórtex Webinar <avisos@x.com>" };

type Envio = { id: string; sessao_id: string; webinar_id: string; tipo: "inscricao" | "lembrete" | "comecando"; tentativas: number };
type Update = { tabela: string; valores: Record<string, unknown>; filtros: [string, string, unknown][] };

/** Supabase falso: guarda os updates (com os filtros) e responde as leituras em lote por tabela. */
function banco(o: {
  pegos?: Envio[];
  sessoes?: unknown[];
  webinars?: unknown[];
  emailsJit?: unknown[];
  jitConfig?: unknown[];
  expirados?: { id: string }[];
}) {
  const updates: Update[] = [];
  const leituras: { tabela: string; colunas: string; filtro: [string, unknown[]] }[] = [];
  const rpc = vi.fn(() => Promise.resolve({ data: o.pegos ?? [], error: null }));
  const dados: Record<string, unknown[]> = {
    sessoes: o.sessoes ?? [],
    webinars: o.webinars ?? [],
    emails_jit: o.emailsJit ?? [],
    jit_config: o.jitConfig ?? [],
  };
  const from = vi.fn((tabela: string) => ({
    select: (colunas: string) => ({
      in: (coluna: string, valores: unknown[]) => {
        leituras.push({ tabela, colunas, filtro: [coluna, valores] });
        return Promise.resolve({ data: dados[tabela] ?? [], error: null });
      },
    }),
    update: (valores: Record<string, unknown>) => {
      const u: Update = { tabela, valores, filtros: [] };
      updates.push(u);
      const q: any = {
        eq: (c: string, v: unknown) => (u.filtros.push(["eq", c, v]), q),
        lt: (c: string, v: unknown) => (u.filtros.push(["lt", c, v]), q),
        select: () => Promise.resolve({ data: tabela === "envios_email" && u.filtros.some((f) => f[1] === "status") ? (o.expirados ?? []) : [], error: null }),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ error: null }).then(res, rej),
      };
      return q;
    },
  }));
  return { db: { from, rpc } as any, updates, leituras, rpc };
}

const SESSAO = { id: "s1", webinar_id: "w1", jit_horario: JIT.toISOString(), modo: "ao_vivo", participantes: { nome: "Ana", email: "ana@x.com" } };
const WEBINAR = { id: "w1", nome: "Aula de IA", slug: "aula-ia", idioma: "pt-BR", status: "ativo" };

function envio(p: Partial<Envio> = {}): Envio {
  return { id: "e1", sessao_id: "s1", webinar_id: "w1", tipo: "inscricao", tentativas: 1, ...p };
}

function updatesDoEnvio(updates: Update[], id: string) {
  return updates.filter((u) => u.tabela === "envios_email" && u.filtros.some((f) => f[1] === "id" && f[2] === id)).map((u) => u.valores);
}

beforeEach(() => {
  vi.resetModules();
  dbAdmin.mockReset();
});

describe("processarEmails", () => {
  it("sem config do Resend: só expira os vencidos há mais de 2 h e não pega nada", async () => {
    const b = banco({ expirados: [{ id: "x1" }, { id: "x2" }] });
    const enviar = vi.fn();
    const { processarEmails } = await import("@/src/lib/emails");
    const r = await processarEmails(AGORA, 50, { db: b.db, config: () => null, enviar });
    expect(r).toEqual({ enviados: 0, falhas: 0, expirados: 2 });
    expect(b.rpc).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
    const [exp] = b.updates;
    expect(exp.valores).toEqual({ status: "expirado", erro: "Passou do horário sem enviar." });
    expect(exp.filtros).toEqual([
      ["eq", "status", "fila"],
      ["lt", "enviar_em", "2026-11-03T20:00:00.000Z"],
    ]);
  });

  it("envia com o modelo padrão (sem emails_jit) e marca enviado", async () => {
    const b = banco({ pegos: [envio()], sessoes: [SESSAO], webinars: [WEBINAR] });
    const enviar = vi.fn().mockResolvedValue({ id: "re_1" });
    const { processarEmails } = await import("@/src/lib/emails");
    const r = await processarEmails(AGORA, 50, { db: b.db, config: () => CFG, enviar });
    expect(r).toEqual({ enviados: 1, falhas: 0, expirados: 0 });
    expect(b.rpc).toHaveBeenCalledWith("pegar_emails", { p_limite: 50 });
    const [cfg, msg] = enviar.mock.calls[0];
    expect(cfg).toBe(CFG);
    expect(msg.de).toBe("Equipe <avisos@x.com>");
    expect(msg.para).toBe("ana@x.com");
    expect(msg.assunto).toBe("Inscrição confirmada: Aula de IA");
    expect(msg.texto).toContain("Olá, Ana!");
    expect(msg.texto).toContain("20:00"); // 23:00 UTC em Brasília
    expect(msg.texto).toMatch(/https:\/\/sala\.x\.com\/aula-ia\?acesso=/);
    expect(msg.html).toContain("?acesso=");
    expect(updatesDoEnvio(b.updates, "e1")).toEqual([{ status: "enviado", enviado_em: AGORA.toISOString(), erro: null }]);
  });

  it("lê tudo em lote (uma consulta por tabela, nada por envio)", async () => {
    const b = banco({
      pegos: [envio(), envio({ id: "e2", tipo: "lembrete" }), envio({ id: "e3", tipo: "comecando" })],
      sessoes: [SESSAO],
      webinars: [WEBINAR],
    });
    const { processarEmails } = await import("@/src/lib/emails");
    await processarEmails(AGORA, 50, { db: b.db, config: () => CFG, enviar: vi.fn().mockResolvedValue({ id: "x" }) });
    expect(b.leituras.map((l) => l.tabela).sort()).toEqual(["emails_jit", "jit_config", "sessoes", "webinars"]);
    expect(b.leituras.find((l) => l.tabela === "sessoes")!.filtro).toEqual(["id", ["s1"]]);
  });

  it("usa o modelo do webinar, o minutos_antes do lembrete, o fuso do jit_config e o idioma do webinar", async () => {
    const b = banco({
      pegos: [envio({ tipo: "lembrete" })],
      sessoes: [SESSAO],
      webinars: [{ ...WEBINAR, idioma: "en" }],
      emailsJit: [
        { webinar_id: "w1", tipo: "lembrete", remetente_nome: "Equipe Vórtex", assunto: "Em {{minutos}} min: {{webinar}}", modelo: { texto: "Oi {{nome}}, às {{hora}} em {{data}}. {{link}}" }, minutos_antes: 15 },
      ],
      jitConfig: [{ webinar_id: "w1", fuso: "Europe/Lisbon" }],
    });
    const enviar = vi.fn().mockResolvedValue({ id: "re_1" });
    const { processarEmails } = await import("@/src/lib/emails");
    await processarEmails(AGORA, 50, { db: b.db, config: () => CFG, enviar });
    const msg = enviar.mock.calls[0][1];
    expect(msg.de).toBe("Equipe Vórtex <avisos@x.com>");
    expect(msg.assunto).toBe("Em 15 min: Aula de IA");
    expect(msg.texto).toContain("Oi Ana, às 23:00"); // Lisboa = UTC em novembro
    expect(msg.texto).toMatch(/\?acesso=/);
  });

  it("usa o fuso gravado na inscrição (participante em Lisboa) e indica o fuso na hora", async () => {
    const b = banco({
      pegos: [envio()],
      sessoes: [{ ...SESSAO, jit_fuso: "Europe/Lisbon" }],
      webinars: [WEBINAR],
      jitConfig: [{ webinar_id: "w1", fuso: "participante" }],
    });
    const enviar = vi.fn().mockResolvedValue({ id: "re_1" });
    const { processarEmails } = await import("@/src/lib/emails");
    await processarEmails(AGORA, 50, { db: b.db, config: () => CFG, enviar });
    expect(enviar.mock.calls[0][1].texto).toContain("Horário: 23:00 (Lisbon, GMT+0)");
    expect(b.leituras.find((l) => l.tabela === "sessoes")!.colunas).toContain("jit_fuso");
  });

  it("fuso 'participante' cai em Brasília", async () => {
    const b = banco({ pegos: [envio()], sessoes: [SESSAO], webinars: [WEBINAR], jitConfig: [{ webinar_id: "w1", fuso: "participante" }] });
    const enviar = vi.fn().mockResolvedValue({ id: "re_1" });
    const { processarEmails } = await import("@/src/lib/emails");
    await processarEmails(AGORA, 50, { db: b.db, config: () => CFG, enviar });
    expect(enviar.mock.calls[0][1].texto).toContain("20:00");
  });

  it("falha antes da 3ª tentativa: volta pra fila em 5 min com o erro", async () => {
    const b = banco({ pegos: [envio({ tentativas: 2 })], sessoes: [SESSAO], webinars: [WEBINAR] });
    const enviar = vi.fn().mockRejectedValue(new Error("O Resend recusou o e-mail (HTTP 422)."));
    const { processarEmails } = await import("@/src/lib/emails");
    const r = await processarEmails(AGORA, 50, { db: b.db, config: () => CFG, enviar });
    expect(r).toEqual({ enviados: 0, falhas: 1, expirados: 0 });
    expect(updatesDoEnvio(b.updates, "e1")).toEqual([
      { status: "fila", enviar_em: "2026-11-03T22:05:00.000Z", erro: "O Resend recusou o e-mail (HTTP 422)." },
    ]);
  });

  it("falha na 3ª tentativa: erro final", async () => {
    const b = banco({ pegos: [envio({ tentativas: 3 })], sessoes: [SESSAO], webinars: [WEBINAR] });
    const enviar = vi.fn().mockRejectedValue(new Error("O Resend não respondeu."));
    const { processarEmails } = await import("@/src/lib/emails");
    const r = await processarEmails(AGORA, 50, { db: b.db, config: () => CFG, enviar });
    expect(r.falhas).toBe(1);
    expect(updatesDoEnvio(b.updates, "e1")).toEqual([{ status: "erro", erro: "O Resend não respondeu." }]);
  });

  it("sessão sem e-mail ou sem horário: expira com o motivo, sem enviar", async () => {
    const b = banco({
      pegos: [envio(), envio({ id: "e2", sessao_id: "s2" }), envio({ id: "e3", sessao_id: "sumiu" })],
      sessoes: [
        { ...SESSAO, participantes: { nome: "Ana", email: null } },
        { ...SESSAO, id: "s2", jit_horario: null },
      ],
      webinars: [WEBINAR],
    });
    const enviar = vi.fn();
    const { processarEmails } = await import("@/src/lib/emails");
    const r = await processarEmails(AGORA, 50, { db: b.db, config: () => CFG, enviar });
    expect(r).toEqual({ enviados: 0, falhas: 0, expirados: 3 });
    expect(enviar).not.toHaveBeenCalled();
    expect(updatesDoEnvio(b.updates, "e1")).toEqual([{ status: "expirado", erro: "A inscrição não tem e-mail." }]);
    expect(updatesDoEnvio(b.updates, "e2")).toEqual([{ status: "expirado", erro: "A inscrição não tem horário escolhido." }]);
    expect(updatesDoEnvio(b.updates, "e3")).toEqual([{ status: "expirado", erro: "Inscrição não encontrada." }]);
  });

  it("lembrete/começando de webinar arquivado ou de sessão que virou replay: expira com o motivo; a inscrição ainda vai", async () => {
    const b = banco({
      pegos: [
        envio({ id: "e1", tipo: "lembrete", webinar_id: "w2", sessao_id: "s3" }),
        envio({ id: "e2", tipo: "comecando", sessao_id: "s2" }),
        envio({ id: "e3", tipo: "inscricao", sessao_id: "s2" }),
      ],
      sessoes: [
        { ...SESSAO, id: "s2", modo: "replay" },
        { ...SESSAO, id: "s3", webinar_id: "w2" },
      ],
      webinars: [WEBINAR, { ...WEBINAR, id: "w2", status: "arquivado" }],
    });
    const enviar = vi.fn().mockResolvedValue({ id: "x" });
    const { processarEmails } = await import("@/src/lib/emails");
    const r = await processarEmails(AGORA, 50, { db: b.db, config: () => CFG, enviar });
    expect(r).toEqual({ enviados: 1, falhas: 0, expirados: 2 });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(updatesDoEnvio(b.updates, "e1")).toEqual([{ status: "expirado", erro: "O webinar não está ativo." }]);
    expect(updatesDoEnvio(b.updates, "e2")).toEqual([{ status: "expirado", erro: "A sessão não está mais ao vivo." }]);
    expect(updatesDoEnvio(b.updates, "e3")[0]).toMatchObject({ status: "enviado" });
  });

  it("passado o prazo não começa envio novo: devolve à fila desfazendo a tentativa", async () => {
    const b = banco({ pegos: [envio(), envio({ id: "e2", tentativas: 2 })], sessoes: [SESSAO], webinars: [WEBINAR] });
    let t = 0;
    const enviar = vi.fn(async () => {
      t = 100; // o primeiro envio "demora" até passar do prazo
      return { id: "x" };
    });
    const { processarEmails } = await import("@/src/lib/emails");
    const r = await processarEmails(AGORA, 50, { db: b.db, config: () => CFG, enviar, relogio: () => t, prazo: 50, concorrencia: 1 });
    expect(r.enviados).toBe(1);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(updatesDoEnvio(b.updates, "e2")).toEqual([{ tentativas: 1, enviar_em: AGORA.toISOString() }]);
  });

  it("limita os envios simultâneos", async () => {
    const pegos = Array.from({ length: 12 }, (_, i) => envio({ id: `e${i}` }));
    const b = banco({ pegos, sessoes: [SESSAO], webinars: [WEBINAR] });
    let ativos = 0;
    let pico = 0;
    const enviar = vi.fn(async () => {
      ativos += 1;
      pico = Math.max(pico, ativos);
      await new Promise((r) => setTimeout(r, 1));
      ativos -= 1;
      return { id: "x" };
    });
    const { processarEmails } = await import("@/src/lib/emails");
    const r = await processarEmails(AGORA, 50, { db: b.db, config: () => CFG, enviar });
    expect(r.enviados).toBe(12);
    expect(pico).toBe(5);
  });
});

describe("/api/cron/tick com e-mails", () => {
  it("processarEmails lançando não derruba o tick (200, sem detalhe)", async () => {
    vi.doMock("@/src/lib/disparos", () => ({
      processarFila: vi.fn().mockResolvedValue({ processados: 1 }),
      avaliarFimDeSessoes: vi.fn().mockResolvedValue({ avaliadas: 0 }),
    }));
    vi.doMock("@/src/lib/emails", () => ({ processarEmails: vi.fn().mockRejectedValue(new Error("detalhe interno")) }));
    vi.doMock("@/src/lib/env", () => ({ env: () => "segredo-do-cron" }));
    const { GET } = await import("../app/api/cron/tick/route");
    const res = await GET(new Request("https://painel.x.com/api/cron/tick", { headers: { authorization: "Bearer segredo-do-cron" } }));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo).toEqual({ disparos: 1, sessoes: 0, emails: null });
    expect(JSON.stringify(corpo)).not.toContain("detalhe interno");
    vi.doUnmock("@/src/lib/disparos");
    vi.doUnmock("@/src/lib/emails");
    vi.doUnmock("@/src/lib/env");
  });
});
