import { beforeEach, describe, expect, it, vi } from "vitest";
import { cifrar } from "@/src/lib/crypto";

process.env.CRYPTO_KEY ??= Buffer.alloc(32, 3).toString("base64");

const dbAdmin = vi.fn();
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));

type Queues = Record<string, unknown[]>;

/** Cada tabela tem uma fila de resultados — um por chamada a `db.from(tabela)`, na ordem em que `receberVenda`
 *  as faz. O objeto devolvido é chainable (qualquer método encadeia) e também "thenable" (um `await` direto,
 *  sem passar por `maybeSingle`, já resolve). */
function dbComFilas(queues: Queues) {
  const chamadas: { tabela: string; metodo: string; args: unknown[] }[] = [];
  const from = vi.fn((tabela: string) => {
    const fila = queues[tabela];
    if (!fila || fila.length === 0) throw new Error(`chamada inesperada a from("${tabela}")`);
    const resultado = fila.shift();
    const c: any = {};
    for (const m of ["select", "eq", "or", "ilike", "in", "order", "limit", "update", "insert", "upsert"]) {
      c[m] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo: m, args });
        return c;
      };
    }
    c.maybeSingle = () => Promise.resolve(resultado);
    c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(resultado).then(resolve, reject);
    return c;
  });
  return { from, chamadas };
}

type LinhaParticipante = { id: string; webinar_id: string; email: string | null; telefone_e164: string | null };

/** `participantes` em memória: só `select().eq()/in()` (igualdade exata, como o Postgres faz) — sem `ilike` nem
 *  `or`, que não podem ser usados com texto vindo da plataforma. Registra os filtros de cada consulta. */
function participantesEmMemoria(linhas: LinhaParticipante[]) {
  const consultas: { metodo: string; args: unknown[] }[][] = [];
  const select = vi.fn(() => {
    const filtros: { metodo: string; args: unknown[] }[] = [];
    consultas.push(filtros);
    const q: any = {
      then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => {
        const data = linhas
          .filter((l) =>
            filtros.every((f) => {
              const [col, val] = f.args as [keyof LinhaParticipante, unknown];
              return f.metodo === "eq" ? l[col] === val : (val as unknown[]).includes(l[col]);
            }),
          )
          .map((l) => ({ id: l.id }));
        return Promise.resolve({ data, error: null }).then(ok, falha);
      },
    };
    for (const m of ["eq", "in"]) {
      q[m] = (...args: unknown[]) => {
        filtros.push({ metodo: m, args });
        return q;
      };
    }
    return q;
  });
  return { select, consultas };
}

/** `sessoes`: devolve a mais recente (maior `entrou_em`) entre os participantes pedidos no `.in`, nunca em modo
 *  `teste` (o `.neq("modo", "teste")` da consulta real). */
function sessoesEmMemoria(linhas: { id: string; participante_id: string; entrou_em: string; modo?: string }[]) {
  const pedidos: string[][] = [];
  const select = vi.fn(() => {
    let ids: string[] = [];
    const q: any = {};
    q.eq = () => q;
    q.neq = () => q;
    q.in = (_: string, v: string[]) => {
      ids = v;
      pedidos.push(v);
      return q;
    };
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = () => {
      const achada = linhas
        .filter((l) => ids.includes(l.participante_id) && (l.modo ?? "ao_vivo") !== "teste")
        .sort((a, b) => b.entrou_em.localeCompare(a.entrou_em))[0];
      return Promise.resolve({ data: achada ? { id: achada.id } : null });
    };
    return q;
  });
  return { select, pedidos };
}

beforeEach(() => {
  vi.resetModules();
  dbAdmin.mockReset();
});

const WEBINAR_ID = "web-1";
const SEGREDO = "segredo-123";

function webhookVortexpay(overrides: Partial<{ ligado: boolean; filtro_src: string | null; segredo_enc: string | null }> = {}) {
  return {
    id: "webhook-1",
    webinar_id: WEBINAR_ID,
    filtro_src: "filtro_src" in overrides ? overrides.filtro_src ?? null : null,
    checkouts: {
      plataforma: "vortexpay",
      segredo_enc: "segredo_enc" in overrides ? overrides.segredo_enc ?? null : cifrar(SEGREDO),
      ligado: overrides.ligado ?? true,
    },
  };
}

function corpoVortexpay(over: Partial<{ idTransacao: string; email: string | null; telefone: string | null; src: string | null }> = {}) {
  return JSON.stringify({
    evento: "venda_aprovada",
    id_transacao: over.idTransacao ?? "tx-1",
    valor_centavos: 19700,
    comprador: { email: "email" in over ? over.email : "ana@x.com", telefone: "telefone" in over ? over.telefone : null },
    src: "src" in over ? over.src : null,
    utms: {},
  });
}

describe("receberVenda", () => {
  it("token inexistente → nao_encontrado, sem gravar log", async () => {
    const { from, chamadas } = dbComFilas({ checkout_webhooks: [{ data: null }] });
    dbAdmin.mockReturnValue({ from });

    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-errado", corpoVortexpay(), {});
    expect(r).toEqual({ tipo: "nao_encontrado" });
    expect(chamadas.some((c) => c.tabela === "checkout_logs")).toBe(false);
  });

  it("plataforma da URL não bate com a do webhook → nao_encontrado", async () => {
    const { from } = dbComFilas({ checkout_webhooks: [{ data: webhookVortexpay() }] });
    dbAdmin.mockReturnValue({ from });

    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("kiwify", "token-1", corpoVortexpay(), {});
    expect(r).toEqual({ tipo: "nao_encontrado" });
  });

  it("checkout desligado → ignorada (mas grava o log)", async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const { from } = dbComFilas({ checkout_webhooks: [{ data: webhookVortexpay({ ligado: false }) }] });
    from.mockImplementation((tabela: string) => {
      if (tabela === "checkout_webhooks") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: webhookVortexpay({ ligado: false }) }) }) }) };
      if (tabela === "checkout_logs") return { insert };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-1", corpoVortexpay(), {});
    expect(r).toEqual({ tipo: "ignorada" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ webhook_id: "webhook-1", resultado: "ignorada" }));
  });

  it("segredo errado → nao_autorizada (e grava o log)", async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "checkout_webhooks") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: webhookVortexpay() }) }) }) };
      if (tabela === "checkout_logs") return { insert };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-1", corpoVortexpay(), { "x-vortexwebinar-secret": "errado" });
    expect(r).toEqual({ tipo: "nao_autorizada" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ resultado: "nao_autorizada" }));
  });

  it("evento que não é venda aprovada → ignorada", async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "checkout_webhooks") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: webhookVortexpay() }) }) }) };
      if (tabela === "checkout_logs") return { insert };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { receberVenda } = await import("@/src/lib/checkout");
    const corpo = JSON.stringify({ evento: "venda_pendente" });
    const r = await receberVenda("vortexpay", "token-1", corpo, { "x-vortexwebinar-secret": SEGREDO });
    expect(r).toEqual({ tipo: "ignorada" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ resultado: "ignorada" }));
  });

  it("filtro de src não bate → ignorada, não insere venda", async () => {
    const insertLog = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const insertVenda = vi.fn();
    const from = vi.fn((tabela: string) => {
      if (tabela === "checkout_webhooks") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: webhookVortexpay({ filtro_src: "ig-story" }) }) }) }) };
      if (tabela === "checkout_logs") return { insert: insertLog };
      if (tabela === "vendas") return { insert: insertVenda };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { receberVenda } = await import("@/src/lib/checkout");
    const corpo = corpoVortexpay({ src: "youtube-ads" });
    const r = await receberVenda("vortexpay", "token-1", corpo, { "x-vortexwebinar-secret": SEGREDO });
    expect(r).toEqual({ tipo: "ignorada" });
    expect(insertVenda).not.toHaveBeenCalled();
    expect(insertLog).toHaveBeenCalledWith(expect.objectContaining({ resultado: "ignorada" }));
  });

  it("venda duplicada (conflito plataforma+id_transacao) → aceita, sem tentar casar sessão de novo", async () => {
    const insertLog = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const insertVenda = vi.fn().mockReturnValue(Promise.resolve({ error: { code: "23505", message: "duplicate" } }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "checkout_webhooks") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: webhookVortexpay() }) }) }) };
      if (tabela === "checkout_logs") return { insert: insertLog };
      if (tabela === "vendas") return { insert: insertVenda };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-1", corpoVortexpay(), { "x-vortexwebinar-secret": SEGREDO });
    expect(r).toEqual({ tipo: "aceita" });
    expect(insertLog).toHaveBeenCalledWith(expect.objectContaining({ resultado: "aceita" }));
  });

  /** Banco com webhook vortexpay, venda inserida sem erro e participantes/sessões em memória. */
  function bancoComComprador(
    participantes: LinhaParticipante[],
    sessoes: { id: string; participante_id: string; entrou_em: string; modo?: string }[],
  ) {
    const insertLog = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const insertVenda = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const updateVenda = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) });
    const insertEvento = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const part = participantesEmMemoria(participantes);
    const sess = sessoesEmMemoria(sessoes);
    const from = vi.fn((tabela: string) => {
      if (tabela === "checkout_webhooks") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: webhookVortexpay() }) }) }) };
      if (tabela === "checkout_logs") return { insert: insertLog };
      if (tabela === "vendas") return { insert: insertVenda, update: updateVenda };
      if (tabela === "participantes") return { select: part.select };
      if (tabela === "sessoes") return { select: sess.select };
      if (tabela === "eventos") return { insert: insertEvento };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });
    return { insertLog, insertVenda, updateVenda, insertEvento, part, sess };
  }

  it("aceita sem participante correspondente → aceita, sem casar sessão", async () => {
    const b = bancoComComprador([], []);
    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-1", corpoVortexpay(), { "x-vortexwebinar-secret": SEGREDO });
    expect(r).toEqual({ tipo: "aceita" });
    expect(b.insertVenda).toHaveBeenCalledWith(
      expect.objectContaining({ webinar_id: WEBINAR_ID, plataforma: "vortexpay", id_transacao: "tx-1", valor_centavos: 19700, comprador_email: "ana@x.com" }),
    );
    expect(b.insertEvento).not.toHaveBeenCalled();
  });

  it("casa por e-mail: acha a sessão mais recente, grava sessao_id e o evento comprou", async () => {
    const b = bancoComComprador(
      [{ id: "part-1", webinar_id: WEBINAR_ID, email: "ana@x.com", telefone_e164: null }],
      [
        { id: "sessao-velha", participante_id: "part-1", entrou_em: "2026-10-19T10:00:00Z" },
        { id: "sessao-1", participante_id: "part-1", entrou_em: "2026-10-20T10:00:00Z" },
      ],
    );
    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-1", corpoVortexpay({ email: "Ana@X.com", telefone: null }), { "x-vortexwebinar-secret": SEGREDO });

    expect(r).toEqual({ tipo: "aceita" });
    // Uma consulta, igualdade exata com o e-mail minúsculo (como o cadastro grava).
    expect(b.part.consultas).toEqual([[{ metodo: "eq", args: ["webinar_id", WEBINAR_ID] }, { metodo: "eq", args: ["email", "ana@x.com"] }]]);
    expect(b.updateVenda).toHaveBeenCalledWith({ sessao_id: "sessao-1" });
    expect(b.insertEvento).toHaveBeenCalledWith({ sessao_id: "sessao-1", webinar_id: WEBINAR_ID, tipo: "comprou" });
  });

  it("sessão em modo teste, mesmo sendo a mais recente, nunca casa com a venda", async () => {
    const b = bancoComComprador(
      [{ id: "part-1", webinar_id: WEBINAR_ID, email: "ana@x.com", telefone_e164: null }],
      [
        { id: "sessao-real", participante_id: "part-1", entrou_em: "2026-10-19T10:00:00Z" },
        { id: "sessao-teste", participante_id: "part-1", entrou_em: "2026-10-20T10:00:00Z", modo: "teste" },
      ],
    );
    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-1", corpoVortexpay({ email: "ana@x.com", telefone: null }), { "x-vortexwebinar-secret": SEGREDO });

    expect(r).toEqual({ tipo: "aceita" });
    expect(b.updateVenda).toHaveBeenCalledWith({ sessao_id: "sessao-real" });
    expect(b.insertEvento).toHaveBeenCalledWith({ sessao_id: "sessao-real", webinar_id: WEBINAR_ID, tipo: "comprou" });
  });

  it("só existe sessão em modo teste: não casa com nenhuma sessão", async () => {
    const b = bancoComComprador(
      [{ id: "part-1", webinar_id: WEBINAR_ID, email: "ana@x.com", telefone_e164: null }],
      [{ id: "sessao-teste", participante_id: "part-1", entrou_em: "2026-10-20T10:00:00Z", modo: "teste" }],
    );
    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-1", corpoVortexpay({ email: "ana@x.com", telefone: null }), { "x-vortexwebinar-secret": SEGREDO });

    expect(r).toEqual({ tipo: "aceita" });
    expect(b.updateVenda).not.toHaveBeenCalled();
    expect(b.insertEvento).not.toHaveBeenCalled();
  });

  it("e-mail com _ não casa com outro e-mail (sem curinga): joao_silva@x.com ≠ joaoxsilva@x.com", async () => {
    const b = bancoComComprador(
      [{ id: "part-x", webinar_id: WEBINAR_ID, email: "joaoxsilva@x.com", telefone_e164: null }],
      [{ id: "sessao-x", participante_id: "part-x", entrou_em: "2026-10-20T10:00:00Z" }],
    );
    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-1", corpoVortexpay({ email: "joao_silva@x.com", telefone: null }), { "x-vortexwebinar-secret": SEGREDO });
    expect(r).toEqual({ tipo: "aceita" });
    expect(b.insertEvento).not.toHaveBeenCalled();
    expect(b.updateVenda).not.toHaveBeenCalled();
  });

  it("casa por telefone quando não há e-mail (telefone da plataforma normalizado pra E.164)", async () => {
    const b = bancoComComprador(
      [{ id: "part-2", webinar_id: WEBINAR_ID, email: null, telefone_e164: "+5511999999999" }],
      [{ id: "sessao-2", participante_id: "part-2", entrou_em: "2026-10-20T10:00:00Z" }],
    );
    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-1", corpoVortexpay({ email: null, telefone: "(11) 99999-9999" }), { "x-vortexwebinar-secret": SEGREDO });

    expect(r).toEqual({ tipo: "aceita" });
    expect(b.part.consultas).toEqual([[{ metodo: "eq", args: ["webinar_id", WEBINAR_ID] }, { metodo: "eq", args: ["telefone_e164", "+5511999999999"] }]]);
    expect(b.insertEvento).toHaveBeenCalledWith({ sessao_id: "sessao-2", webinar_id: WEBINAR_ID, tipo: "comprou" });
  });

  it("e-mail e telefone casam com participantes diferentes: junta os dois e pega a sessão mais recente", async () => {
    const b = bancoComComprador(
      [
        { id: "part-email", webinar_id: WEBINAR_ID, email: "ana@x.com", telefone_e164: null },
        { id: "part-tel", webinar_id: WEBINAR_ID, email: "outro@x.com", telefone_e164: "+5511999999999" },
      ],
      [
        { id: "sessao-email", participante_id: "part-email", entrou_em: "2026-10-19T10:00:00Z" },
        { id: "sessao-tel", participante_id: "part-tel", entrou_em: "2026-10-20T10:00:00Z" },
      ],
    );
    const { receberVenda } = await import("@/src/lib/checkout");
    await receberVenda("vortexpay", "token-1", corpoVortexpay({ email: "ana@x.com", telefone: "+5511999999999" }), { "x-vortexwebinar-secret": SEGREDO });
    expect(b.part.consultas).toHaveLength(2);
    expect(b.sess.pedidos[0].sort()).toEqual(["part-email", "part-tel"]);
    expect(b.updateVenda).toHaveBeenCalledWith({ sessao_id: "sessao-tel" });
  });

  it("erro ao inserir a venda (não é conflito) → erro (a rota responde 500 pra plataforma reenviar)", async () => {
    const insertLog = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const insertVenda = vi.fn().mockReturnValue(Promise.resolve({ error: { code: "08006", message: "conexão caiu" } }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "checkout_webhooks") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: webhookVortexpay() }) }) }) };
      if (tabela === "checkout_logs") return { insert: insertLog };
      if (tabela === "vendas") return { insert: insertVenda };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });
    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-1", corpoVortexpay(), { "x-vortexwebinar-secret": SEGREDO });
    expect(r).toEqual({ tipo: "erro" });
    expect(insertLog).toHaveBeenCalledWith(expect.objectContaining({ resultado: "erro" }));
  });

  it("venda sem id: ignorada, com o motivo no log", async () => {
    const insertLog = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "checkout_webhooks") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: webhookVortexpay() }) }) }) };
      if (tabela === "checkout_logs") return { insert: insertLog };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });
    const { receberVenda } = await import("@/src/lib/checkout");
    const corpo = JSON.stringify({ evento: "venda_aprovada", valor_centavos: 100, comprador: {} });
    const r = await receberVenda("vortexpay", "token-1", corpo, { "x-vortexwebinar-secret": SEGREDO });
    expect(r).toEqual({ tipo: "ignorada" });
    expect(insertLog.mock.calls[0][0].bruto.motivo).toBe("Venda sem id da transação.");
  });

  it("segredos do corpo (hottok, token, signature, secret) não vão pro log nem pra vendas.bruto", async () => {
    const b = bancoComComprador([], []);
    const corpo = JSON.stringify({ ...JSON.parse(corpoVortexpay()), token: "tk", secret: "sss", extra: { signature: "x", hottok: "h", ok: 1 } });
    const { receberVenda } = await import("@/src/lib/checkout");
    await receberVenda("vortexpay", "token-1", corpo, { "x-vortexwebinar-secret": SEGREDO });
    const brutoVenda = JSON.stringify(b.insertVenda.mock.calls[0][0].bruto);
    const brutoLog = JSON.stringify(b.insertLog.mock.calls[0][0].bruto);
    for (const texto of [brutoVenda, brutoLog]) {
      expect(texto).not.toMatch(/"(token|secret|signature|hottok)"/);
      expect(texto).toContain('"ok":1');
    }
  });

  it("segredo não configurado (vazio): aceita sem conferir cabeçalho nenhum", async () => {
    const insertLog = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const insertVenda = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    const selectParticipantes = participantesEmMemoria([]).select;
    const from = vi.fn((tabela: string) => {
      if (tabela === "checkout_webhooks") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: webhookVortexpay({ segredo_enc: null }) }) }) }) };
      if (tabela === "checkout_logs") return { insert: insertLog };
      if (tabela === "vendas") return { insert: insertVenda };
      if (tabela === "participantes") return { select: selectParticipantes };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { receberVenda } = await import("@/src/lib/checkout");
    const r = await receberVenda("vortexpay", "token-1", corpoVortexpay(), {});
    expect(r).toEqual({ tipo: "aceita" });
  });
});
