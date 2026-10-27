import { beforeEach, describe, expect, it, vi } from "vitest";
import { cifrar } from "@/src/lib/crypto";

process.env.CRYPTO_KEY ??= Buffer.alloc(32, 7).toString("base64");

const dbAdmin = vi.fn();
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));

/** Fábrica de uma chain estilo Supabase: registra cada chamada (`chamadas`) e resolve pro `resultado` dado em
 *  `maybeSingle`/`single`, ou direto (thenable) se o código nunca chama um desses. */
function chain(resultado: unknown, chamadas: { metodo: string; args: unknown[] }[] = []) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "neq", "is", "in", "lte", "lt", "or", "limit", "upsert", "insert", "update"]) {
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
  dbAdmin.mockReset();
});

describe("enfileirarPorEvento", () => {
  it("insere disparos pras regras ativas do gatilho que o evento mapeia", async () => {
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    const upsert = vi.fn(() => {
      chamadas.push({ metodo: "upsert-chamado", args: [] });
      return chain({ error: null });
    });
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes") return chain({ data: { modo: "ao_vivo" } }, chamadas);
      if (tabela === "regras") return chain({ data: [{ id: "r1" }, { id: "r2" }] }, chamadas);
      if (tabela === "disparos") return { upsert };
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    dbAdmin.mockReturnValue({ from });

    const { enfileirarPorEvento } = await import("@/src/lib/disparos");
    await enfileirarPorEvento("sessao-1", "web-1", "acessou_sala");

    expect(upsert).toHaveBeenCalledWith(
      [
        { regra_id: "r1", sessao_id: "sessao-1" },
        { regra_id: "r2", sessao_id: "sessao-1" },
      ],
      { onConflict: "regra_id,sessao_id", ignoreDuplicates: true },
    );
    expect(chamadas.filter((c) => c.metodo === "eq")).toEqual(
      expect.arrayContaining([
        { metodo: "eq", args: ["id", "sessao-1"] },
        { metodo: "eq", args: ["webinar_id", "web-1"] },
        { metodo: "eq", args: ["ativa", true] },
      ]),
    );
    expect(chamadas).toEqual(expect.arrayContaining([{ metodo: "in", args: ["gatilho", ["acessou"]] }]));
  });

  it("evento sem gatilho mapeado não consulta nada", async () => {
    const from = vi.fn();
    dbAdmin.mockReturnValue({ from });
    const { enfileirarPorEvento } = await import("@/src/lib/disparos");
    await enfileirarPorEvento("sessao-1", "web-1", "min_15");
    expect(from).not.toHaveBeenCalled();
  });

  it("modo teste não enfileira nada", async () => {
    const upsert = vi.fn();
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes") return chain({ data: { modo: "teste" } });
      if (tabela === "regras") throw new Error("não devia consultar regras em modo teste");
      if (tabela === "disparos") return { upsert };
      throw new Error("tabela inesperada");
    });
    dbAdmin.mockReturnValue({ from });
    const { enfileirarPorEvento } = await import("@/src/lib/disparos");
    await enfileirarPorEvento("sessao-1", "web-1", "acessou_sala");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("modo teste enfileira os eventos da oferta (pra testar o webhook na mão)", async () => {
    const upsert = vi.fn(() => chain({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes") return chain({ data: { modo: "teste" } });
      if (tabela === "regras") return chain({ data: [{ id: "r-oferta" }] });
      if (tabela === "disparos") return { upsert };
      throw new Error("tabela inesperada");
    });
    dbAdmin.mockReturnValue({ from });
    const { enfileirarPorEvento } = await import("@/src/lib/disparos");
    await enfileirarPorEvento("sessao-1", "web-1", "oferta");
    expect(upsert).toHaveBeenCalledWith([{ regra_id: "r-oferta", sessao_id: "sessao-1" }], expect.anything());
  });
});

describe("enfileirarPermaneceu", () => {
  it("filtra regras 'permaneceu' com valor_seg <= segundo e enfileira", async () => {
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    const upsert = vi.fn(() => chain({ error: null }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "regras") return chain({ data: [{ id: "r1" }] }, chamadas);
      if (tabela === "disparos") return { upsert };
      throw new Error("tabela inesperada");
    });
    dbAdmin.mockReturnValue({ from });

    const { enfileirarPermaneceu } = await import("@/src/lib/disparos");
    await enfileirarPermaneceu({ sessaoId: "s1", webinarId: "w1", modo: "ao_vivo" }, 120);

    expect(upsert).toHaveBeenCalledWith([{ regra_id: "r1", sessao_id: "s1" }], { onConflict: "regra_id,sessao_id", ignoreDuplicates: true });
    expect(chamadas).toEqual(
      expect.arrayContaining([
        { metodo: "eq", args: ["gatilho", "permaneceu"] },
        { metodo: "lte", args: ["valor_seg", 120] },
      ]),
    );
  });

  it("modo teste não enfileira", async () => {
    const from = vi.fn();
    dbAdmin.mockReturnValue({ from });
    const { enfileirarPermaneceu } = await import("@/src/lib/disparos");
    await enfileirarPermaneceu({ sessaoId: "s1", webinarId: "w1", modo: "teste" }, 120);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("processarFila", () => {
  function regraEnc(headers: [string, string][]) {
    return cifrar(JSON.stringify(headers));
  }

  function montarDb(detalhes: unknown[], opcoes: { atualizacoes: { id: string; valores: Record<string, unknown> }[] }) {
    const rpc = vi.fn(() => Promise.resolve({ data: detalhes.map((d: any) => ({ id: d.id, tentativas: d.tentativas })) }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "disparos") {
        return {
          select: () => ({ in: () => Promise.resolve({ data: detalhes }) }),
          update: (valores: Record<string, unknown>) => ({
            eq: (_: string, id: string) => {
              opcoes.atualizacoes.push({ id, valores });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    return { from, rpc };
  }

  const SESSAO = {
    webinar_id: "w1",
    max_segundo: 90,
    utms: { utm_source: "ig" },
    participantes: { nome: "Ana", email: "ana@x.com", telefone_e164: "+5511999999999" },
    webinars: { nome: "Aula" },
  };

  it("sucesso (2xx): status ok, sem nova tentativa", async () => {
    const detalhes = [
      { id: "d1", tentativas: 1, regras: { gatilho: "acessou", url: "https://x.com/hook", metodo: "POST", headers_enc: regraEnc([["X-A", "1"]]), params: {}, corpo: null, ativa: true }, sessoes: SESSAO },
    ];
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    dbAdmin.mockReturnValue(montarDb(detalhes, { atualizacoes }));

    const fetchFn = vi.fn(async () => new Response("ok", { status: 200 }));
    const { processarFila } = await import("@/src/lib/disparos");
    const r = await processarFila(10, new Date(), fetchFn as unknown as typeof fetch);

    expect(r).toEqual({ processados: 1, adiados: 0 });
    expect(atualizacoes).toHaveLength(1);
    expect(atualizacoes[0].id).toBe("d1");
    expect(atualizacoes[0].valores.status).toBe("ok");
    expect(atualizacoes[0].valores.erro).toBeNull();
  });

  it("erro (5xx): volta pra fila com a espera da tentativa (esperaTentativa)", async () => {
    const detalhes = [
      { id: "d1", tentativas: 1, regras: { gatilho: "oferta", url: "https://x.com/hook", metodo: "GET", headers_enc: null, params: {}, corpo: null, ativa: true }, sessoes: SESSAO },
    ];
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    dbAdmin.mockReturnValue(montarDb(detalhes, { atualizacoes }));

    const fetchFn = vi.fn(async () => new Response("deu erro", { status: 500 }));
    const agora = new Date("2026-10-20T12:00:00.000Z");
    const { processarFila } = await import("@/src/lib/disparos");
    await processarFila(10, agora, fetchFn as unknown as typeof fetch);

    expect(atualizacoes[0].valores.status).toBe("fila");
    expect(atualizacoes[0].valores.enviar_apos).toBe(new Date(agora.getTime() + 60_000).toISOString()); // esperaTentativa(1)
    expect(atualizacoes[0].valores.erro).toBe("Resposta HTTP 500.");
  });

  it("3xx: erro 'Redirecionamento não seguido.'", async () => {
    const detalhes = [
      { id: "d1", tentativas: 1, regras: { gatilho: "oferta", url: "https://x.com/hook", metodo: "GET", headers_enc: null, params: {}, corpo: null, ativa: true }, sessoes: SESSAO },
    ];
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    dbAdmin.mockReturnValue(montarDb(detalhes, { atualizacoes }));

    const fetchFn = vi.fn(async () => new Response(null, { status: 302 }));
    const { processarFila } = await import("@/src/lib/disparos");
    await processarFila(10, new Date(), fetchFn as unknown as typeof fetch);

    expect(atualizacoes[0].valores.erro).toBe("Redirecionamento não seguido.");
  });

  it("desistência: na tentativa 3, esperaTentativa(3) é a última espera; na 4ª dá erro final", async () => {
    const detalhes = [
      { id: "d1", tentativas: 4, regras: { gatilho: "oferta", url: "https://x.com/hook", metodo: "GET", headers_enc: null, params: {}, corpo: null, ativa: true }, sessoes: SESSAO },
    ];
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    dbAdmin.mockReturnValue(montarDb(detalhes, { atualizacoes }));

    const fetchFn = vi.fn(async () => new Response("erro", { status: 500 }));
    const { processarFila } = await import("@/src/lib/disparos");
    await processarFila(10, new Date(), fetchFn as unknown as typeof fetch);

    expect(atualizacoes[0].valores.status).toBe("erro");
    expect(atualizacoes[0].valores.enviar_apos).toBeUndefined();
  });

  it("regra ou sessão não encontrada: erro final direto", async () => {
    const detalhes = [{ id: "d1", tentativas: 1, regras: null, sessoes: SESSAO }];
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    dbAdmin.mockReturnValue(montarDb(detalhes, { atualizacoes }));

    const fetchFn = vi.fn();
    const { processarFila } = await import("@/src/lib/disparos");
    await processarFila(10, new Date(), fetchFn as unknown as typeof fetch);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(atualizacoes[0].valores.status).toBe("erro");
  });

  it("fila vazia: não consulta detalhes nem envia nada", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: [] }));
    const from = vi.fn();
    dbAdmin.mockReturnValue({ from, rpc });
    const fetchFn = vi.fn();
    const { processarFila } = await import("@/src/lib/disparos");
    const r = await processarFila(10, new Date(), fetchFn as unknown as typeof fetch);
    expect(r).toEqual({ processados: 0, adiados: 0 });
    expect(from).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });
  function regraBase(extra: Record<string, unknown> = {}) {
    return { gatilho: "oferta", url: "https://x.com/hook", metodo: "POST", headers_enc: null, params: {}, corpo: '{"a":"{{NOME}}"}', ativa: true, ...extra };
  }

  it("envia o id do disparo no header X-VortexWebinar-Disparo (idempotência no receptor)", async () => {
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    dbAdmin.mockReturnValue(montarDb([{ id: "d-42", tentativas: 1, regras: regraBase(), sessoes: SESSAO }], { atualizacoes }));
    const fetchFn = vi.fn(async (..._a: unknown[]) => new Response("ok", { status: 200 }));
    const { processarFila } = await import("@/src/lib/disparos");
    await processarFila(10, new Date(), fetchFn as unknown as typeof fetch);
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-VortexWebinar-Disparo"]).toBe("d-42");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("Content-Type do usuário (qualquer caixa) ganha do nosso", async () => {
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    const regra = regraBase({ headers_enc: regraEnc([["Content-TYPE", "application/x-www-form-urlencoded"]]) });
    dbAdmin.mockReturnValue(montarDb([{ id: "d1", tentativas: 1, regras: regra, sessoes: SESSAO }], { atualizacoes }));
    const fetchFn = vi.fn(async (..._a: unknown[]) => new Response("ok", { status: 200 }));
    const { processarFila } = await import("@/src/lib/disparos");
    await processarFila(10, new Date(), fetchFn as unknown as typeof fetch);
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["Content-TYPE"]).toBe("application/x-www-form-urlencoded");
    expect(headers["content-type"]).toBeUndefined();
  });

  it("regra desativada depois de entrar na fila: erro final 'Regra desativada.', sem enviar", async () => {
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    dbAdmin.mockReturnValue(montarDb([{ id: "d1", tentativas: 1, regras: regraBase({ ativa: false }), sessoes: SESSAO }], { atualizacoes }));
    const fetchFn = vi.fn();
    const { processarFila } = await import("@/src/lib/disparos");
    await processarFila(10, new Date(), fetchFn as unknown as typeof fetch);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(atualizacoes[0].valores).toEqual({ status: "erro", erro: "Regra desativada." });
  });

  it("URL que não passa mais na validação: erro final, sem enviar", async () => {
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    dbAdmin.mockReturnValue(montarDb([{ id: "d1", tentativas: 1, regras: regraBase({ url: "https://169.254.169.254/latest" }), sessoes: SESSAO }], { atualizacoes }));
    const fetchFn = vi.fn();
    const { processarFila } = await import("@/src/lib/disparos");
    await processarFila(10, new Date(), fetchFn as unknown as typeof fetch);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(atualizacoes[0].valores).toEqual({ status: "erro", erro: "Use um endereço https público." });
  });

  it("resposta gigante: guarda só 2000 bytes e cancela o resto do stream", async () => {
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    dbAdmin.mockReturnValue(montarDb([{ id: "d1", tentativas: 1, regras: regraBase(), sessoes: SESSAO }], { atualizacoes }));
    let pedacosLidos = 0;
    let cancelado = false;
    const corpoInfinito = new ReadableStream<Uint8Array>({
      pull(controller) {
        pedacosLidos += 1;
        controller.enqueue(new Uint8Array(1024).fill(97)); // "a" x 1024, pra sempre
      },
      cancel() {
        cancelado = true;
      },
    });
    const fetchFn = vi.fn(async () => new Response(corpoInfinito, { status: 200 }));
    const { processarFila } = await import("@/src/lib/disparos");
    await processarFila(10, new Date(), fetchFn as unknown as typeof fetch);
    const resposta = atualizacoes[0].valores.resposta as { status: number; corpo: string };
    expect(resposta.corpo).toBe("a".repeat(2000));
    expect(cancelado).toBe(true);
    expect(pedacosLidos).toBeLessThan(10);
  });

  it("envia no máximo 10 ao mesmo tempo", async () => {
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    const detalhes = Array.from({ length: 25 }, (_, i) => ({ id: `d${i}`, tentativas: 1, regras: regraBase(), sessoes: SESSAO }));
    dbAdmin.mockReturnValue(montarDb(detalhes, { atualizacoes }));
    let emVoo = 0;
    let pico = 0;
    const fetchFn = vi.fn(async () => {
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo -= 1;
      return new Response("ok", { status: 200 });
    });
    const { processarFila } = await import("@/src/lib/disparos");
    const r = await processarFila(50, new Date(), fetchFn as unknown as typeof fetch);
    expect(r).toEqual({ processados: 25, adiados: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(25);
    expect(pico).toBe(10);
  });

  it("passado o prazo, não começa envio novo: devolve o resto à fila desfazendo a tentativa", async () => {
    const atualizacoes: { id: string; valores: Record<string, unknown> }[] = [];
    const detalhes = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, tentativas: 2, regras: regraBase(), sessoes: SESSAO }));
    dbAdmin.mockReturnValue(montarDb(detalhes, { atualizacoes }));
    let relogio = 0;
    const fetchFn = vi.fn(async () => {
      relogio += 20_000; // cada envio "leva" 20 s
      return new Response("ok", { status: 200 });
    });
    const agora = new Date("2026-10-20T12:00:00.000Z");
    const { processarFila } = await import("@/src/lib/disparos");
    const r = await processarFila(50, agora, fetchFn as unknown as typeof fetch, { prazo: 40_000, relogio: () => relogio, concorrencia: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(2); // 0 s e 20 s começam; em 40 s o prazo venceu
    expect(r).toEqual({ processados: 2, adiados: 3 });
    const devolvidos = atualizacoes.filter((a) => a.valores.tentativas !== undefined);
    expect(devolvidos.map((a) => a.id)).toEqual(["d2", "d3", "d4"]);
    expect(devolvidos.every((a) => a.valores.tentativas === 1 && a.valores.enviar_apos === agora.toISOString())).toBe(true);
  });

  it("erro ao pegar a fila: lança (o cron registra o nome do erro)", async () => {
    dbAdmin.mockReturnValue({ from: vi.fn(), rpc: vi.fn(() => Promise.resolve({ data: null, error: { message: "x" } })) });
    const { processarFila } = await import("@/src/lib/disparos");
    await expect(processarFila(10, new Date(), vi.fn() as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("lerCorpoLimitado", () => {
  it("corta em bytes (não em caracteres) e lê corpo pequeno inteiro", async () => {
    const { lerCorpoLimitado } = await import("@/src/lib/disparos");
    expect(await lerCorpoLimitado(new Response("olá"), 2000)).toBe("olá");
    expect(new TextEncoder().encode(await lerCorpoLimitado(new Response("é".repeat(3000)), 2000)).byteLength).toBeLessThanOrEqual(2000);
    expect(await lerCorpoLimitado(new Response(null, { status: 204 }), 2000)).toBe("");
  });
});

describe("avaliarFimDeSessoes", () => {
  type Chamada = { metodo: string; args: unknown[] };

  /** Banco falso: `sessoes` devolve primeiro as com sinal, depois as sem sinal; `regras` e `eventos` vêm de
   *  funções (pra simular erro e contar consultas). */
  function montar(opcoes: {
    comSinal?: unknown[];
    semSinal?: unknown[];
    regras?: (webinarId: string) => { data?: unknown; error?: unknown };
    eventos?: (sessaoId: string) => { data?: unknown; error?: unknown };
  }) {
    const chamadasSessoes: Chamada[][] = [];
    const updates: { valores: unknown; id: string }[] = [];
    const upserts: unknown[] = [];
    let consultasRegras = 0;
    let buscaSessoes = 0;
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes") {
        const chamadas: Chamada[] = [];
        chamadasSessoes.push(chamadas);
        const resultado = buscaSessoes++ === 0 ? { data: opcoes.comSinal ?? [] } : { data: opcoes.semSinal ?? [] };
        const p: any = chain(resultado, chamadas);
        p.update = (valores: unknown) => ({
          eq: (_: string, id: string) => {
            updates.push({ valores, id });
            return Promise.resolve({ error: null });
          },
        });
        return p;
      }
      if (tabela === "regras") {
        consultasRegras += 1;
        // Thenable comum (não uma Promise nativa, cujo `then` próprio o `await` ignora): resolve com o resultado
        // do webinar consultado (o `eq("webinar_id", ...)` registra qual é).
        let webinar = "";
        const q: any = {
          then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
            Promise.resolve(opcoes.regras ? opcoes.regras(webinar) : { data: [] }).then(ok, falha),
        };
        for (const m of ["select", "eq", "in"]) {
          q[m] = (...args: unknown[]) => {
            if (m === "eq" && args[0] === "webinar_id") webinar = args[1] as string;
            return q;
          };
        }
        return q;
      }
      if (tabela === "eventos") {
        const chamadas: Chamada[] = [];
        const p: any = chain(null, chamadas);
        p.maybeSingle = () => {
          const sid = chamadas.find((c) => c.metodo === "eq" && c.args[0] === "sessao_id")?.args[1] as string;
          return Promise.resolve(opcoes.eventos ? opcoes.eventos(sid) : { data: null });
        };
        return p;
      }
      if (tabela === "disparos") return { upsert: (linhas: unknown) => (upserts.push(linhas), chain({ error: null })) };
      throw new Error(`tabela inesperada: ${tabela}`);
    });
    return { db: { from }, chamadasSessoes, updates, upserts, consultasRegras: () => consultasRegras };
  }

  it("abandonou (max_segundo < valor_seg) e nao_viu_oferta (sem evento oferta): enfileira as duas e marca avaliada_fim", async () => {
    const f = montar({
      comSinal: [{ id: "s1", webinar_id: "w1", max_segundo: 10, modo: "ao_vivo" }],
      regras: () => ({ data: [{ id: "ra", gatilho: "abandonou", valor_seg: 30 }, { id: "rb", gatilho: "abandonou", valor_seg: 5 }, { id: "rn", gatilho: "nao_viu_oferta", valor_seg: null }] }),
    });
    dbAdmin.mockReturnValue(f.db);

    const { avaliarFimDeSessoes } = await import("@/src/lib/disparos");
    const r = await avaliarFimDeSessoes(200, new Date("2026-10-20T12:10:00.000Z"));

    expect(r).toEqual({ avaliadas: 1 });
    expect(f.upserts).toEqual([[{ regra_id: "ra", sessao_id: "s1" }, { regra_id: "rn", sessao_id: "s1" }]]);
    expect(f.updates).toEqual([{ valores: { avaliada_fim: true }, id: "s1" }]);
  });

  it("busca as com sinal velho e as que nunca mandaram sinal (entrou_em velho), sempre sem o modo teste", async () => {
    const f = montar({
      comSinal: [{ id: "s1", webinar_id: "w1", max_segundo: 10, modo: "ao_vivo" }],
      semSinal: [{ id: "s2", webinar_id: "w1", max_segundo: 0, modo: "replay" }],
    });
    dbAdmin.mockReturnValue(f.db);
    const { avaliarFimDeSessoes } = await import("@/src/lib/disparos");
    const r = await avaliarFimDeSessoes(200, new Date("2026-10-20T12:10:00.000Z"));
    expect(r).toEqual({ avaliadas: 2 });
    const limiar = "2026-10-20T12:05:00.000Z";
    const [busca1, busca2] = f.chamadasSessoes;
    expect(busca1).toEqual(expect.arrayContaining([{ metodo: "neq", args: ["modo", "teste"] }, { metodo: "lt", args: ["ultimo_sinal_em", limiar] }]));
    expect(busca2).toEqual(
      expect.arrayContaining([
        { metodo: "neq", args: ["modo", "teste"] },
        { metodo: "is", args: ["ultimo_sinal_em", null] },
        { metodo: "lt", args: ["entrou_em", limiar] },
      ]),
    );
  });

  it("inscrição do JIT sem sinal só é avaliada 2 h depois do horário escolhido (não logo depois da inscrição)", async () => {
    const f = montar({});
    dbAdmin.mockReturnValue(f.db);
    const { avaliarFimDeSessoes } = await import("@/src/lib/disparos");
    await avaliarFimDeSessoes(200, new Date("2026-10-20T12:10:00.000Z"));
    const [, busca2] = f.chamadasSessoes;
    expect(busca2).toEqual(
      expect.arrayContaining([{ metodo: "or", args: ['jit_horario.is.null,jit_horario.lt."2026-10-20T10:10:00.000Z"'] }]),
    );
  });

  it("regras lidas uma vez por webinar na execução", async () => {
    const f = montar({
      comSinal: [
        { id: "s1", webinar_id: "w1", max_segundo: 10, modo: "ao_vivo" },
        { id: "s2", webinar_id: "w1", max_segundo: 10, modo: "ao_vivo" },
        { id: "s3", webinar_id: "w2", max_segundo: 10, modo: "ao_vivo" },
      ],
    });
    dbAdmin.mockReturnValue(f.db);
    const { avaliarFimDeSessoes } = await import("@/src/lib/disparos");
    await avaliarFimDeSessoes(200, new Date());
    expect(f.consultasRegras()).toBe(2);
  });

  it("erro ao ler os eventos: pula a sessão (não marca nem dispara nao_viu_oferta)", async () => {
    const f = montar({
      comSinal: [{ id: "s1", webinar_id: "w1", max_segundo: 10, modo: "ao_vivo" }],
      regras: () => ({ data: [{ id: "rn", gatilho: "nao_viu_oferta", valor_seg: null }] }),
      eventos: () => ({ data: null, error: { message: "caiu" } }),
    });
    dbAdmin.mockReturnValue(f.db);
    const { avaliarFimDeSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarFimDeSessoes(200, new Date())).toEqual({ avaliadas: 0 });
    expect(f.upserts).toEqual([]);
    expect(f.updates).toEqual([]);
  });

  it("erro ao ler as regras: pula as sessões do webinar sem marcar", async () => {
    const f = montar({
      comSinal: [
        { id: "s1", webinar_id: "w1", max_segundo: 10, modo: "ao_vivo" },
        { id: "s2", webinar_id: "w2", max_segundo: 10, modo: "ao_vivo" },
      ],
      regras: (w) => (w === "w1" ? { data: null, error: { message: "caiu" } } : { data: [] }),
    });
    dbAdmin.mockReturnValue(f.db);
    const { avaliarFimDeSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarFimDeSessoes(200, new Date())).toEqual({ avaliadas: 1 });
    expect(f.updates).toEqual([{ valores: { avaliada_fim: true }, id: "s2" }]);
  });

  it("com evento oferta: não enfileira nao_viu_oferta, mas marca", async () => {
    const f = montar({
      comSinal: [{ id: "s1", webinar_id: "w1", max_segundo: 10, modo: "ao_vivo" }],
      regras: () => ({ data: [{ id: "rn", gatilho: "nao_viu_oferta", valor_seg: null }] }),
      eventos: () => ({ data: { id: "e1" } }),
    });
    dbAdmin.mockReturnValue(f.db);
    const { avaliarFimDeSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarFimDeSessoes(200, new Date())).toEqual({ avaliadas: 1 });
    expect(f.upserts).toEqual([]);
  });

  it("sem sessão pra avaliar: devolve 0", async () => {
    const f = montar({});
    dbAdmin.mockReturnValue(f.db);
    const { avaliarFimDeSessoes } = await import("@/src/lib/disparos");
    expect(await avaliarFimDeSessoes(200, new Date())).toEqual({ avaliadas: 0 });
  });
});

describe("enviarTeste", () => {
  it("envia com dados fictícios e devolve status/corpo, sem gravar em disparos", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela === "regras") return chain({ data: { gatilho: "oferta", url: "https://x.com/hook", metodo: "POST", headers_enc: null, params: {}, corpo: '{"nome":"{{NOME}}"}' } });
      throw new Error(`não devia gravar em ${tabela}`);
    });
    dbAdmin.mockReturnValue({ from });

    const fetchFn = vi.fn(async (..._a: unknown[]) => new Response("recebido", { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);

    const { enviarTeste } = await import("@/src/lib/disparos");
    const r = await enviarTeste("r1");

    expect(r).toEqual({ status: 200, corpo: "recebido" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ nome: "Teste Vórtex Webinar" });
    expect((init.headers as Record<string, string>)["X-VortexWebinar-Disparo"]).toBe("teste");

    vi.unstubAllGlobals();
  });

  it("regra não encontrada: erro", async () => {
    const from = vi.fn(() => chain({ data: null }));
    dbAdmin.mockReturnValue({ from });
    const { enviarTeste } = await import("@/src/lib/disparos");
    expect(await enviarTeste("inexistente")).toEqual({ erro: "Regra não encontrada." });
  });
});
