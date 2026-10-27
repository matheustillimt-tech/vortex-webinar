import { beforeEach, describe, expect, it, vi } from "vitest";
import { escaparIlike, filtrosDaLista } from "../src/lib/regras/lista-webinars";

describe("filtrosDaLista", () => {
  it("sem nada: busca vazia, status ativos, tipo todos", () => {
    expect(filtrosDaLista({})).toEqual({ busca: "", status: "ativos", tipo: "todos" });
  });

  it("aceita status e tipo válidos, e corta espaços da busca", () => {
    expect(filtrosDaLista({ busca: "  Aulão  ", status: "arquivados", tipo: "recorrente" })).toEqual({
      busca: "Aulão",
      status: "arquivados",
      tipo: "recorrente",
    });
  });

  it("status ou tipo desconhecido: cai no padrão", () => {
    expect(filtrosDaLista({ status: "lixo", tipo: "lixo" })).toEqual({ busca: "", status: "ativos", tipo: "todos" });
  });

  it("vários valores no mesmo parâmetro: usa o primeiro", () => {
    expect(filtrosDaLista({ busca: ["um", "dois"], status: ["todos", "ativos"] })).toEqual({
      busca: "um",
      status: "todos",
      tipo: "todos",
    });
  });
});

describe("escaparIlike", () => {
  it("escapa %, _ e a própria barra", () => {
    expect(escaparIlike("50% off_agora")).toBe("50\\% off\\_agora");
    expect(escaparIlike("a\\b")).toBe("a\\\\b");
  });

  it("texto sem operadores: devolve igual", () => {
    expect(escaparIlike("Aulão Renda com IA")).toBe("Aulão Renda com IA");
  });
});

// --- duplicarWebinar / arquivarWebinar / reativarWebinar ------------------------------------------------------

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const registrarAuditoria = vi.fn();
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: (...a: unknown[]) => exigirAdmin(...a), dbUsuario: (...a: unknown[]) => dbUsuario(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (...a: [string]) => redirect(...a) }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

/** Fábrica de uma chain estilo Supabase que resolve pro `resultado` dado, aceitando qualquer método encadeado. */
function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "like", "insert", "update", "delete", "single", "maybeSingle"]) p[m] = () => p;
  return p;
}

/** Builder falso de uma tabela com várias linhas, que o `lerTudo` vai paginar: `.select().eq().order()...range()`,
 *  com `order` encadeável (chama-se uma ou duas vezes, conforme a tabela) e `range` devolvendo a página pedida. */
function construtorMultiplo(linhas: unknown[]) {
  const nodo: any = {};
  nodo.select = () => nodo;
  nodo.eq = () => nodo;
  nodo.order = () => nodo;
  nodo.range = (desde: number, ate: number) => Promise.resolve({ data: linhas.slice(desde, ate + 1), error: null });
  return nodo;
}

const ORIGINAL = {
  id: "web-1",
  nome: "Aulão Renda com IA",
  slug: "aulao-renda-com-ia",
  status: "ativo",
  tipo_agenda: "unica",
  titulo: "Título",
  idioma: "pt-BR",
  created_at: "2026-01-01",
  updated_at: "2026-01-02",
};

function webinarsTable(insertCalls: unknown[], opts: { original?: typeof ORIGINAL; erroDelete?: boolean } = {}) {
  const original = opts.original ?? ORIGINAL;
  const obj: any = {};
  let modo: "original" | "slug" | "insert" | "delete" = "original";
  obj.select = (cols: string) => {
    modo = cols === "*" ? "original" : cols === "slug" ? "slug" : "insert";
    return obj;
  };
  obj.eq = () => {
    if (modo === "delete") return Promise.resolve({ error: opts.erroDelete ? { message: "falhou" } : null });
    return obj;
  };
  obj.like = () => Promise.resolve({ data: [] });
  obj.insert = (payload: unknown) => {
    insertCalls.push(payload);
    modo = "insert";
    return obj;
  };
  obj.delete = () => {
    modo = "delete";
    return obj;
  };
  obj.single = () => {
    if (modo === "original") return Promise.resolve({ data: original, error: null });
    return Promise.resolve({ data: { id: "web-copia" }, error: null });
  };
  return obj;
}

const TABELAS_UNICAS_DADOS: Record<string, unknown> = {
  agendas: { id: "a1", webinar_id: "web-1", fuso: "America/Sao_Paulo", created_at: "x", updated_at: "y" },
  telas_login: null,
  webinar_video: null,
  ofertas: { id: "o1", webinar_id: "web-1", ligada: true, nome: "Oferta", titulo: "T", aparece_seg: 10, created_at: "x", updated_at: "y" },
  audiencias: null,
  agentes_ia: { id: "ag1", webinar_id: "web-1", ligado: true, created_at: "x", updated_at: "y" },
  jit_config: { id: "j1", webinar_id: "web-1", fuso: "participante", exibicao: "proximos_3", created_at: "x", updated_at: "y" },
};

const MENSAGENS = Array.from({ length: 501 }, (_, i) => ({
  id: `m${i}`,
  webinar_id: "web-1",
  segundo: i,
  nome: "Fulano",
  texto: "Oi",
  created_at: "c",
  updated_at: "u",
}));

const TABELAS_MULTIPLAS_DADOS: Record<string, unknown[]> = {
  mensagens_simuladas: MENSAGENS,
  vendas_simuladas: [],
  chatbot: [],
  regras: [{ id: "r1", webinar_id: "web-1", gatilho: "acessou", url: "https://x", headers_enc: "enc123", created_at: "c", updated_at: "u" }],
  jit_horarios: [
    { id: "h1", webinar_id: "web-1", quando: "todo_dia", hora: "19:00:00", intervalo_min: null, data: null, dia_semana: null, created_at: "c", updated_at: "u" },
    { id: "h2", webinar_id: "web-1", quando: "a_cada", hora: null, intervalo_min: 30, data: null, dia_semana: null, created_at: "c", updated_at: "u" },
  ],
  tarjas_aviso: [
    { id: "t1", webinar_id: "web-1", texto: "Não saia da sala!", aparece_seg: 2, duracao_seg: 15, posicao: "topo", cor: "vermelho", ligada: true, created_at: "c", updated_at: "u" },
  ],
  emails_jit: [
    { id: "e1", webinar_id: "web-1", tipo: "lembrete", minutos_antes: 30, remetente_nome: "Vórtex", assunto: "Faltam {{minutos}}", modelo: { texto: "Oi" }, created_at: "c", updated_at: "u" },
  ],
};

function montarFrom(
  opts: { falharEm?: string; multiplas?: Record<string, unknown[]>; original?: typeof ORIGINAL; erroDelete?: boolean } = {},
) {
  const insertCalls: Record<string, unknown[]> = {};
  const tabelasChamadas: string[] = [];
  const webinarsInsertCalls: unknown[] = [];
  const multiplas = opts.multiplas ?? TABELAS_MULTIPLAS_DADOS;

  const from = vi.fn((tabela: string) => {
    tabelasChamadas.push(tabela);
    if (tabela === "webinars") return webinarsTable(webinarsInsertCalls, { original: opts.original, erroDelete: opts.erroDelete });

    const comInsert = (c: any) => {
      c.insert = (payload: unknown) => {
        (insertCalls[tabela] ??= []).push(payload);
        if (opts.falharEm === tabela) return chain({ error: { message: "falhou" } });
        return chain({ error: null });
      };
      return c;
    };

    if (tabela in multiplas) return comInsert(construtorMultiplo(multiplas[tabela]));

    const base = TABELAS_UNICAS_DADOS[tabela];
    return comInsert(chain({ data: base ?? null, error: null }));
  });

  return { from, insertCalls, tabelasChamadas, webinarsInsertCalls };
}

describe("duplicarWebinar", () => {
  beforeEach(() => {
    vi.resetModules();
    exigirAdmin.mockReset();
    exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
    dbUsuario.mockReset();
    redirect.mockClear();
    revalidatePath.mockClear();
    registrarAuditoria.mockReset();
  });

  it("copia as tabelas certas (não as de participantes/dados reais), em lotes de 500, e redireciona pro Início da cópia", async () => {
    const { from, insertCalls, tabelasChamadas } = montarFrom();
    dbUsuario.mockResolvedValue({ from });

    const { duplicarWebinar } = await import("../app/(painel)/webinars/actions");
    await expect(duplicarWebinar("web-1")).rejects.toThrow("REDIRECT:/webinars/web-copia/inicio");

    for (const proibida of ["participantes", "sessoes", "eventos", "vendas", "disparos", "mensagens_suporte", "retencao"]) {
      expect(tabelasChamadas).not.toContain(proibida);
    }

    expect(insertCalls.agendas).toEqual([{ fuso: "America/Sao_Paulo", webinar_id: "web-copia" }]);
    expect(insertCalls.agentes_ia).toEqual([{ ligado: true, webinar_id: "web-copia" }]);
    expect(insertCalls.telas_login).toBeUndefined();
    expect(insertCalls.webinar_video).toBeUndefined();
    expect(insertCalls.audiencias).toBeUndefined();

    // 501 mensagens -> 2 lotes (500 + 1)
    expect(insertCalls.mensagens_simuladas).toHaveLength(2);
    expect((insertCalls.mensagens_simuladas[0] as unknown[]).length).toBe(500);
    expect((insertCalls.mensagens_simuladas[1] as unknown[]).length).toBe(1);
    expect(insertCalls.vendas_simuladas).toBeUndefined();
    expect(insertCalls.chatbot).toBeUndefined();

    // regras: mantém headers_enc como está
    expect(insertCalls.regras).toEqual([[{ gatilho: "acessou", url: "https://x", headers_enc: "enc123", webinar_id: "web-copia" }]]);

    // just in time: configuração, horários e e-mails vão junto
    expect(insertCalls.jit_config).toEqual([{ fuso: "participante", exibicao: "proximos_3", webinar_id: "web-copia" }]);
    expect(insertCalls.jit_horarios).toEqual([
      [
        { quando: "todo_dia", hora: "19:00:00", intervalo_min: null, data: null, dia_semana: null, webinar_id: "web-copia" },
        { quando: "a_cada", hora: null, intervalo_min: 30, data: null, dia_semana: null, webinar_id: "web-copia" },
      ],
    ]);
    expect(insertCalls.emails_jit).toEqual([
      [{ tipo: "lembrete", minutos_antes: 30, remetente_nome: "Vórtex", assunto: "Faltam {{minutos}}", modelo: { texto: "Oi" }, webinar_id: "web-copia" }],
    ]);

    // tarjas de aviso vão junto (sem id/webinar_id/datas)
    expect(insertCalls.tarjas_aviso).toEqual([
      [{ texto: "Não saia da sala!", aparece_seg: 2, duracao_seg: 15, posicao: "topo", cor: "vermelho", ligada: true, webinar_id: "web-copia" }],
    ]);

    expect(revalidatePath).toHaveBeenCalledWith("/webinars");
  });

  it("mais de 1000 mensagens (PostgREST limita a resposta a 1000 por página): pagina com lerTudo e copia tudo", async () => {
    const MUITAS_MENSAGENS = Array.from({ length: 1500 }, (_, i) => ({
      id: `m${i}`,
      webinar_id: "web-1",
      segundo: i,
      nome: "Fulano",
      texto: "Oi",
      created_at: "c",
      updated_at: "u",
    }));
    const { from, insertCalls } = montarFrom({
      multiplas: { mensagens_simuladas: MUITAS_MENSAGENS, vendas_simuladas: [], chatbot: [], regras: [], jit_horarios: [], emails_jit: [], tarjas_aviso: [] },
    });
    dbUsuario.mockResolvedValue({ from });

    const { duplicarWebinar } = await import("../app/(painel)/webinars/actions");
    await expect(duplicarWebinar("web-1")).rejects.toThrow("REDIRECT:/webinars/web-copia/inicio");

    // 1500 linhas lidas em 2 páginas de `lerTudo` (1000 + 500) -> inseridas em 3 lotes de 500 (500+500+500).
    expect(insertCalls.mensagens_simuladas).toHaveLength(3);
    const totalCopiado = (insertCalls.mensagens_simuladas as unknown[][]).reduce((n, lote) => n + lote.length, 0);
    expect(totalCopiado).toBe(1500);
  });

  it("falha no meio (ex.: ofertas): apaga o webinar novo e devolve o erro, sem redirecionar", async () => {
    const { from, webinarsInsertCalls } = montarFrom({ falharEm: "ofertas" });
    dbUsuario.mockResolvedValue({ from });

    const { duplicarWebinar } = await import("../app/(painel)/webinars/actions");
    const r = await duplicarWebinar("web-1");

    expect(r).toEqual({ erro: "Não deu para duplicar o webinar." });
    expect(redirect).not.toHaveBeenCalled();
    // insert de criação da cópia + nenhuma outra inserção na tabela webinars (a de apagar é delete, não insert)
    expect(webinarsInsertCalls).toHaveLength(1);
  });

  it("falha no meio e o rollback (apagar a cópia) também falha: avisa que ficou uma cópia incompleta", async () => {
    const { from } = montarFrom({ falharEm: "ofertas", erroDelete: true });
    dbUsuario.mockResolvedValue({ from });

    const { duplicarWebinar } = await import("../app/(painel)/webinars/actions");
    const r = await duplicarWebinar("web-1");

    expect(r).toEqual({ erro: "Não deu para duplicar. Uma cópia incompleta ficou na lista: arquive ou apague." });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("slug original com 59 caracteres: '-copia' corta exatamente no hífen, que não pode sobrar no final", async () => {
    const slug59 = "a".repeat(59);
    const { from, webinarsInsertCalls } = montarFrom({ original: { ...ORIGINAL, slug: slug59 } });
    dbUsuario.mockResolvedValue({ from });

    const { duplicarWebinar } = await import("../app/(painel)/webinars/actions");
    await expect(duplicarWebinar("web-1")).rejects.toThrow("REDIRECT:");

    const slugInserido = (webinarsInsertCalls[0] as { slug: string }).slug;
    expect(slugInserido.endsWith("-")).toBe(false);
    expect(slugInserido.length).toBeLessThanOrEqual(60);
  });

  it("slug original com 60 caracteres: '-copia' não cabe e é inteiramente cortado, sem hífen sobrando", async () => {
    const slug60 = "a".repeat(60);
    const { from, webinarsInsertCalls } = montarFrom({ original: { ...ORIGINAL, slug: slug60 } });
    dbUsuario.mockResolvedValue({ from });

    const { duplicarWebinar } = await import("../app/(painel)/webinars/actions");
    await expect(duplicarWebinar("web-1")).rejects.toThrow("REDIRECT:");

    const slugInserido = (webinarsInsertCalls[0] as { slug: string }).slug;
    expect(slugInserido.endsWith("-")).toBe(false);
    expect(slugInserido.length).toBeLessThanOrEqual(60);
    expect(slugInserido).toBe(slug60);
  });
});

describe("arquivarWebinar / reativarWebinar", () => {
  beforeEach(() => {
    vi.resetModules();
    exigirAdmin.mockReset();
    exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
    dbUsuario.mockReset();
    revalidatePath.mockClear();
    registrarAuditoria.mockReset();
  });

  it("arquivarWebinar: atualiza status para arquivado", async () => {
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockReturnValue({ update });
    dbUsuario.mockResolvedValue({ from });

    const { arquivarWebinar } = await import("../app/(painel)/webinars/actions");
    const r = await arquivarWebinar("web-1");

    expect(r).toEqual({});
    expect(update).toHaveBeenCalledWith({ status: "arquivado" });
    expect(revalidatePath).toHaveBeenCalledWith("/webinars");
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: "admin-1", webinarId: "web-1", acao: "editou" }),
    );
  });

  it("reativarWebinar: atualiza status para ativo", async () => {
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockReturnValue({ update });
    dbUsuario.mockResolvedValue({ from });

    const { reativarWebinar } = await import("../app/(painel)/webinars/actions");
    const r = await reativarWebinar("web-1");

    expect(r).toEqual({});
    expect(update).toHaveBeenCalledWith({ status: "ativo" });
  });

  it("erro do banco: devolve mensagem e não revalida", async () => {
    const update = vi.fn().mockReturnValue(chain({ error: { message: "falhou" } }));
    const from = vi.fn().mockReturnValue({ update });
    dbUsuario.mockResolvedValue({ from });

    const { arquivarWebinar } = await import("../app/(painel)/webinars/actions");
    const r = await arquivarWebinar("web-1");

    expect(r).toEqual({ erro: "Não deu para arquivar o webinar." });
  });
});

// --- ordenação, período e paginação ---------------------------------------------------------------------------

describe("navegacaoDaLista", () => {
  it("padrão: mais recentes, sem período, página 1", async () => {
    const { navegacaoDaLista } = await import("../src/lib/regras/lista-webinars");
    expect(navegacaoDaLista({})).toEqual({ ordem: "recentes", de: "", ate: "", pagina: 1 });
  });

  it("aceita ordem, datas válidas e página", async () => {
    const { navegacaoDaLista } = await import("../src/lib/regras/lista-webinars");
    expect(navegacaoDaLista({ ordem: "antigos", de: "2026-10-01", ate: "2026-10-20", pagina: "3" })).toEqual({
      ordem: "antigos",
      de: "2026-10-01",
      ate: "2026-10-20",
      pagina: 3,
    });
  });

  it("descarta lixo: ordem desconhecida, data inválida (inclusive 31/02) e página fora", async () => {
    const { navegacaoDaLista } = await import("../src/lib/regras/lista-webinars");
    expect(navegacaoDaLista({ ordem: "x", de: "2026-02-31", ate: "ontem", pagina: "-2" })).toEqual({ ordem: "recentes", de: "", ate: "", pagina: 1 });
    expect(navegacaoDaLista({ pagina: "1.5" }).pagina).toBe(1);
  });

  it("período invertido: troca as pontas", async () => {
    const { navegacaoDaLista } = await import("../src/lib/regras/lista-webinars");
    const r = navegacaoDaLista({ de: "2026-10-20", ate: "2026-10-01" });
    expect([r.de, r.ate]).toEqual(["2026-10-01", "2026-10-20"]);
  });
});

describe("faixaDaPagina / periodoEmUtc / hrefDaLista", () => {
  it("faixa da página (10 por página)", async () => {
    const { faixaDaPagina } = await import("../src/lib/regras/lista-webinars");
    expect(faixaDaPagina(1)).toEqual([0, 9]);
    expect(faixaDaPagina(3)).toEqual([20, 29]);
    expect(faixaDaPagina(0)).toEqual([0, 9]);
  });

  it("período no horário de Brasília, até o fim do último dia", async () => {
    const { periodoEmUtc } = await import("../src/lib/regras/lista-webinars");
    expect(periodoEmUtc("2026-10-01", "2026-10-20")).toEqual({ desde: "2026-10-01T03:00:00.000Z", ateAntes: "2026-10-21T03:00:00.000Z" });
    expect(periodoEmUtc("", "")).toEqual({ desde: null, ateAntes: null });
  });

  it("link mantém os filtros e omite os padrões", async () => {
    const { hrefDaLista } = await import("../src/lib/regras/lista-webinars");
    const filtros = { busca: "aula", status: "ativos" as const, tipo: "jit" as const };
    const nav = { ordem: "recentes" as const, de: "", ate: "", pagina: 1 };
    expect(hrefDaLista(filtros, nav)).toBe("/webinars?busca=aula&tipo=jit");
    expect(hrefDaLista(filtros, nav, { pagina: 2 })).toBe("/webinars?busca=aula&tipo=jit&pagina=2");
    expect(hrefDaLista({ busca: "", status: "ativos", tipo: "todos" }, nav)).toBe("/webinars");
  });
});
