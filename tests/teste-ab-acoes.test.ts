import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const registrarAuditoria = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/src/lib/supabase/usuario", () => ({
  exigirAdmin: (...a: unknown[]) => exigirAdmin(...a),
  dbUsuario: (...a: unknown[]) => dbUsuario(...a),
}));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (...a: [string]) => redirect(...a) }));

type Filtros = Record<string, unknown>;
type Tabela = {
  /** Leitura em lista (await): valor fixo ou função dos filtros `eq`/`neq`/`in` da consulta. */
  lista?: unknown[] | ((f: Filtros) => unknown[]);
  unico?: unknown;
  inserido?: unknown;
  erroEscrita?: unknown;
};
type Chamada = { tabela: string; metodo: string; args: unknown[] };

function criarDb(tabelas: Record<string, Tabela>) {
  const chamadas: Chamada[] = [];
  const from = (tabela: string) => {
    const t = tabelas[tabela] ?? {};
    const filtros: Filtros = {};
    let escrita = false;
    const no: any = {};
    for (const m of ["select", "eq", "neq", "in", "order", "limit", "insert", "update", "delete"]) {
      no[m] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo: m, args });
        if (["insert", "update", "delete"].includes(m)) escrita = true;
        if (m === "eq" || m === "in") filtros[args[0] as string] = args[1];
        if (m === "neq") filtros[`!${args[0] as string}`] = args[1];
        return no;
      };
    }
    const lista = () => (typeof t.lista === "function" ? t.lista(filtros) : (t.lista ?? []));
    const unico = () =>
      Promise.resolve(escrita ? { data: t.erroEscrita ? null : (t.inserido ?? null), error: t.erroEscrita ?? null } : { data: t.unico ?? null, error: null });
    no.single = unico;
    no.maybeSingle = unico;
    no.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
      Promise.resolve(escrita ? { error: t.erroEscrita ?? null } : { data: lista(), error: null }).then(ok, falha);
    return no;
  };
  return {
    db: { from },
    chamadas,
    escritas: (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo).map((c) => c.args),
  };
}

const ID = "11111111-2222-4333-8444-555555555555";
const WA = "aaaaaaaa-0000-4000-8000-000000000001";
const WB = "aaaaaaaa-0000-4000-8000-000000000002";
const WC = "aaaaaaaa-0000-4000-8000-000000000003";

function form(campos: Record<string, string>, variacoes: [string, string][] | null = [[WA, "50"], [WB, "50"]]): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  for (const [w, p] of variacoes ?? []) {
    f.append("variacao_webinar", w);
    f.append("variacao_percentual", p);
  }
  return f;
}

const CAMPOS = { nome: "Headline", slug: "teste-headline", inicio: "2026-10-20T08:00", fim: "2026-10-30T23:59", fuso: "America/Sao_Paulo" };

/** Webinars: consulta por slug (unicidade) devolve `slugsWebinar`; por id+status devolve os ativos pedidos. */
function webinars(ativos: string[], slugsWebinar: string[] = []) {
  return {
    lista: (f: Filtros) => {
      if (f.slug !== undefined) return slugsWebinar.includes(f.slug as string) ? [{ id: "w-x" }] : [];
      return ((f.id as string[]) ?? []).filter((id) => ativos.includes(id)).map((id) => ({ id }));
    },
  };
}

const acoes = () => import("../app/(painel)/testes-ab/actions");

beforeEach(() => {
  vi.resetModules();
  exigirAdmin.mockReset().mockResolvedValue({ id: "admin-1", nome: "Paula", papel: "admin" });
  dbUsuario.mockReset();
  registrarAuditoria.mockReset();
  revalidatePath.mockReset();
  redirect.mockClear();
});

describe("criarTesteAb", () => {
  it("cria o teste e as variações na ordem, audita e vai para o resumo", async () => {
    const fake = criarDb({ webinars: webinars([WA, WB]), testes_ab: { lista: [], inserido: { id: ID } }, testes_ab_variacoes: {} });
    dbUsuario.mockResolvedValue(fake.db);
    const { criarTesteAb } = await acoes();
    await expect(criarTesteAb({}, form(CAMPOS, [[WA, "70"], [WB, "30"]]))).rejects.toThrow(`REDIRECT:/testes-ab/${ID}?criado=1`);

    expect(fake.escritas("testes_ab", "insert")[0][0]).toMatchObject({
      nome: "Headline",
      slug: "teste-headline",
      inicio: "2026-10-20T11:00:00.000Z",
      fuso: "America/Sao_Paulo",
    });
    expect(fake.escritas("testes_ab_variacoes", "insert")[0][0]).toEqual([
      { teste_id: ID, webinar_id: WA, ordem: 0, percentual: 70 },
      { teste_id: ID, webinar_id: WB, ordem: 1, percentual: 30 },
    ]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: "admin-1", acao: "criou", descricao: 'Criou o teste A/B "Headline"' }));
  });

  it("percentuais que não somam 100: erro com quanto falta, sem gravar", async () => {
    const fake = criarDb({ webinars: webinars([WA, WB]), testes_ab: { lista: [] } });
    dbUsuario.mockResolvedValue(fake.db);
    const { criarTesteAb } = await acoes();
    const r = await criarTesteAb({}, form(CAMPOS, [[WA, "50"], [WB, "40"]]));
    expect(r.erro).toBe("Os percentuais precisam somar 100% (faltam 10%).");
    expect(r.valores?.nome).toBe("Headline");
    expect(fake.escritas("testes_ab", "insert")).toHaveLength(0);
  });

  it("link usado por um webinar ou por outro teste: recusa", async () => {
    let fake = criarDb({ webinars: webinars([WA, WB], ["teste-headline"]), testes_ab: { lista: [] } });
    dbUsuario.mockResolvedValue(fake.db);
    let { criarTesteAb } = await acoes();
    expect((await criarTesteAb({}, form(CAMPOS))).erro).toBe("Este link já está em uso.");

    vi.resetModules();
    fake = criarDb({ webinars: webinars([WA, WB]), testes_ab: { lista: [{ id: "outro" }] } });
    dbUsuario.mockResolvedValue(fake.db);
    ({ criarTesteAb } = await acoes());
    expect((await criarTesteAb({}, form(CAMPOS))).erro).toBe("Este link já está em uso.");
    expect(fake.escritas("testes_ab", "insert")).toHaveLength(0);
  });

  it("webinar arquivado numa variação: recusa", async () => {
    dbUsuario.mockResolvedValue(criarDb({ webinars: webinars([WA]), testes_ab: { lista: [] } }).db);
    const { criarTesteAb } = await acoes();
    expect((await criarTesteAb({}, form(CAMPOS))).erro).toBe("O webinar da variação B não está ativo.");
  });

  it("falha ao gravar as variações: desfaz o teste", async () => {
    const fake = criarDb({ webinars: webinars([WA, WB]), testes_ab: { lista: [], inserido: { id: ID } }, testes_ab_variacoes: { erroEscrita: { message: "x" } } });
    dbUsuario.mockResolvedValue(fake.db);
    const { criarTesteAb } = await acoes();
    expect((await criarTesteAb({}, form(CAMPOS))).erro).toBe("Não deu para salvar as variações do teste.");
    expect(fake.escritas("testes_ab", "delete")).toHaveLength(1);
  });

  it("só admin", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { criarTesteAb } = await acoes();
    await expect(criarTesteAb({}, form(CAMPOS))).rejects.toThrow("Só administradores");
  });
});

describe("editarTesteAb", () => {
  const ANTES = { nome: "Headline", slug: "teste-headline", inicio: "2026-10-20T11:00:00Z", fim: "2026-10-31T02:59:00Z", fuso: "America/Sao_Paulo" };
  const ATUAIS = [
    { webinar_id: WA, percentual: 50, ordem: 0 },
    { webinar_id: WB, percentual: 50, ordem: 1 },
  ];

  it("sem participantes: troca as variações (apaga e insere) e o slug não conflita consigo mesmo", async () => {
    const fake = criarDb({
      webinars: webinars([WA, WB, WC]),
      testes_ab: { unico: ANTES, lista: (f) => (f["!id"] === ID ? [] : [{ id: ID }]) },
      sessoes: { lista: [] },
      testes_ab_variacoes: { lista: ATUAIS },
    });
    dbUsuario.mockResolvedValue(fake.db);
    const { editarTesteAb } = await acoes();
    await expect(editarTesteAb(ID, {}, form(CAMPOS, [[WA, "40"], [WB, "30"], [WC, "30"]]))).rejects.toThrow(`REDIRECT:/testes-ab/${ID}`);

    expect(fake.escritas("testes_ab", "update")).toHaveLength(1);
    expect(fake.escritas("testes_ab_variacoes", "delete")).toHaveLength(1);
    expect(fake.escritas("testes_ab_variacoes", "insert")[0][0]).toHaveLength(3);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "editou" }));
  });

  it("com participantes: variações diferentes são recusadas, sem gravar nada", async () => {
    const fake = criarDb({
      webinars: webinars([WA, WB, WC]),
      testes_ab: { unico: ANTES, lista: [] },
      sessoes: { lista: [{ id: "s-1" }] },
      testes_ab_variacoes: { lista: ATUAIS },
    });
    dbUsuario.mockResolvedValue(fake.db);
    const { editarTesteAb } = await acoes();
    const r = await editarTesteAb(ID, {}, form(CAMPOS, [[WA, "60"], [WB, "40"]]));
    expect(r.erro).toBe("Este teste já tem participantes; as variações não podem mudar.");
    expect(fake.escritas("testes_ab", "update")).toHaveLength(0);
    expect(fake.escritas("testes_ab_variacoes", "delete")).toHaveLength(0);
  });

  it("com participantes e variações travadas (não enviadas): muda só nome/datas, sem tocar nas variações", async () => {
    const fake = criarDb({
      webinars: webinars([]),
      testes_ab: { unico: ANTES, lista: [] },
      sessoes: { lista: [{ id: "s-1" }] },
      testes_ab_variacoes: { lista: ATUAIS },
    });
    dbUsuario.mockResolvedValue(fake.db);
    const { editarTesteAb } = await acoes();
    await expect(editarTesteAb(ID, {}, form({ ...CAMPOS, nome: "Headline 2" }, null))).rejects.toThrow("REDIRECT:");
    expect(fake.escritas("testes_ab", "update")[0][0]).toMatchObject({ nome: "Headline 2" });
    expect(fake.escritas("testes_ab_variacoes", "delete")).toHaveLength(0);
    expect(fake.escritas("testes_ab_variacoes", "insert")).toHaveLength(0);
  });

  it("teste inexistente ou id inválido", async () => {
    dbUsuario.mockResolvedValue(criarDb({ testes_ab: { unico: null } }).db);
    const { editarTesteAb } = await acoes();
    expect((await editarTesteAb("nao-e-uuid", {}, form(CAMPOS))).erro).toBe("Teste não encontrado.");
    expect((await editarTesteAb(ID, {}, form(CAMPOS))).erro).toBe("Teste não encontrado.");
  });
});

describe("arquivar e reativar", () => {
  it("arquivar marca arquivado e audita; reativar desfaz", async () => {
    const fake = criarDb({ testes_ab: { unico: { nome: "Headline", arquivado: false } } });
    dbUsuario.mockResolvedValue(fake.db);
    const { arquivarTesteAb, reativarTesteAb } = await acoes();
    expect(await arquivarTesteAb(ID)).toEqual({});
    expect(await reativarTesteAb(ID)).toEqual({});
    expect(fake.escritas("testes_ab", "update").map((a) => a[0])).toEqual([{ arquivado: true }, { arquivado: false }]);
    expect(registrarAuditoria).toHaveBeenNthCalledWith(1, expect.objectContaining({ descricao: 'Arquivou o teste A/B "Headline"' }));
    expect(registrarAuditoria).toHaveBeenNthCalledWith(2, expect.objectContaining({ descricao: 'Reativou o teste A/B "Headline"' }));
  });

  it("teste inexistente: erro, sem gravar", async () => {
    const fake = criarDb({ testes_ab: { unico: null } });
    dbUsuario.mockResolvedValue(fake.db);
    const { arquivarTesteAb } = await acoes();
    expect(await arquivarTesteAb(ID)).toEqual({ erro: "Teste não encontrado." });
    expect(fake.escritas("testes_ab", "update")).toHaveLength(0);
  });
});
