import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const membroApi = vi.fn();
const revalidatePath = vi.fn();
const lerXlsx = vi.fn();
const gerarXlsx = vi.fn();
const registrarAuditoria = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({
  exigirAdmin: (...a: unknown[]) => exigirAdmin(...a),
  dbUsuario: (...a: unknown[]) => dbUsuario(...a),
  membroApi: (...a: unknown[]) => membroApi(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/src/lib/planilha", () => ({ lerXlsx: (...a: unknown[]) => lerXlsx(...a), gerarXlsx: (...a: unknown[]) => gerarXlsx(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));

/** Fábrica de uma chain estilo Supabase que resolve pro `resultado` dado, aceitando qualquer método encadeado. */
function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "neq", "upsert", "update", "maybeSingle", "order"]) p[m] = () => p;
  return p;
}

/** Builder falso de uma tabela com várias linhas, pra `lerTudo` paginar: `.select().eq().order()...range()`.
 *  O `lerTudo` chama `db.from(tabela)` de novo a cada página (builder de uso único), então quem decide se UMA
 *  página específica falha é o mock de `from` (via `opts.falhar` nesta chamada), não um contador aqui dentro. */
function construtorMultiplo(linhas: unknown[], opts: { falhar?: boolean } = {}) {
  const nodo: any = {};
  nodo.select = () => nodo;
  nodo.eq = () => nodo;
  nodo.order = () => nodo;
  nodo.range = (desde: number, ate: number) => {
    if (opts.falhar) return Promise.resolve({ data: null, error: { message: "falhou" } });
    return Promise.resolve({ data: linhas.slice(desde, ate + 1), error: null });
  };
  return nodo;
}

function form(campos: Record<string, string>, arquivos: Record<string, File> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  for (const [k, v] of Object.entries(arquivos)) f.set(k, v);
  return f;
}

function arquivoXlsxFalso(bytes: number): File {
  return new File([new Uint8Array(bytes)], "chat.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

beforeEach(() => {
  vi.resetModules();
  exigirAdmin.mockReset();
  exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
  dbUsuario.mockReset();
  membroApi.mockReset();
  revalidatePath.mockReset();
  lerXlsx.mockReset();
  gerarXlsx.mockReset();
  registrarAuditoria.mockReset();
});

const CABECALHO_MENSAGENS = ["Hora", "Minuto", "Segundo", "Nome", "Texto", "Suporte"];
const CABECALHO_VENDAS = ["Hora", "Minuto", "Segundo", "Texto"];

describe("importarMensagens", () => {
  it("planilha com erro → não grava nada e devolve até 20 erros", async () => {
    lerXlsx.mockResolvedValue([CABECALHO_MENSAGENS, [0, 0, 1, "", "Oi", ""]]);
    const insert = vi.fn();
    const from = vi.fn().mockImplementation(() => ({ insert }));
    dbUsuario.mockResolvedValue({ from });

    const { importarMensagens } = await import("../app/(painel)/webinars/[id]/chat/actions");
    const r = await importarMensagens("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(100) }));

    expect(r.erros).toEqual(["Linha 2: falta o nome."]);
    expect(insert).not.toHaveBeenCalled();
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("planilha com mais de 20 linhas de erro → corta em 20", async () => {
    const linhas: unknown[][] = [CABECALHO_MENSAGENS];
    for (let i = 0; i < 25; i++) linhas.push([0, 0, 1, "", "Oi", ""]);
    lerXlsx.mockResolvedValue(linhas);
    dbUsuario.mockResolvedValue({ from: vi.fn() });

    const { importarMensagens } = await import("../app/(painel)/webinars/[id]/chat/actions");
    const r = await importarMensagens("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(100) }));

    expect(r.erros).toHaveLength(20);
  });

  it("planilha ok com mais de 500 linhas → insere em lotes de até 500", async () => {
    const linhas: unknown[][] = [CABECALHO_MENSAGENS];
    for (let i = 0; i < 1200; i++) linhas.push([0, 0, 1, "Ana", "Oi", ""]);
    lerXlsx.mockResolvedValue(linhas);

    const insert = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "mensagens_simuladas") return { insert };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { importarMensagens } = await import("../app/(painel)/webinars/[id]/chat/actions");
    const r = await importarMensagens("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(100) }));

    expect(r.importadas).toBe(1200);
    expect(insert).toHaveBeenCalledTimes(3); // 500 + 500 + 200
    expect(insert.mock.calls[0][0]).toHaveLength(500);
    expect(insert.mock.calls[2][0]).toHaveLength(200);
    expect(insert.mock.calls[0][0][0]).toEqual(
      expect.objectContaining({ webinar_id: "webinar-1", segundo: 1, nome: "Ana", texto: "Oi", suporte: false }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/webinars/webinar-1/chat");
  });

  it("arquivo maior que 4 MB → erro sem ler a planilha (teto da Vercel é 4.5 MB)", async () => {
    dbUsuario.mockResolvedValue({ from: vi.fn() });
    const { importarMensagens } = await import("../app/(painel)/webinars/[id]/chat/actions");
    const r = await importarMensagens("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(4 * 1024 * 1024 + 1) }));
    expect(r.erro).toBe("A planilha passa de 4 MB. Divida em arquivos menores.");
    expect(lerXlsx).not.toHaveBeenCalled();
  });

  it("mais de 5000 mensagens na planilha → erro de limite, nada é gravado", async () => {
    const linhas: unknown[][] = [CABECALHO_MENSAGENS];
    for (let i = 0; i < 5001; i++) linhas.push([0, 0, 1, "Ana", "Oi", ""]);
    lerXlsx.mockResolvedValue(linhas);
    const insert = vi.fn();
    const from = vi.fn().mockImplementation(() => ({ insert }));
    dbUsuario.mockResolvedValue({ from });

    const { importarMensagens } = await import("../app/(painel)/webinars/[id]/chat/actions");
    const r = await importarMensagens("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(100) }));

    expect(r.erros).toEqual(["A planilha passa de 5000 mensagens."]);
    expect(insert).not.toHaveBeenCalled();
  });

  it("lote do meio falha → erro de importação parcial (lotes anteriores já gravaram)", async () => {
    const linhas: unknown[][] = [CABECALHO_MENSAGENS];
    for (let i = 0; i < 1200; i++) linhas.push([0, 0, 1, "Ana", "Oi", ""]);
    lerXlsx.mockResolvedValue(linhas);

    let chamada = 0;
    const insert = vi.fn().mockImplementation(() => {
      chamada++;
      return chain({ error: chamada === 2 ? { message: "boom" } : null });
    });
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "mensagens_simuladas") return { insert };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { importarMensagens } = await import("../app/(painel)/webinars/[id]/chat/actions");
    const r = await importarMensagens("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(100) }));

    expect(r.erro).toBe("A importação parou no meio: algumas mensagens podem ter sido gravadas. Confira a lista.");
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("primeiro lote falha → erro comum (nada foi gravado ainda)", async () => {
    const linhas: unknown[][] = [CABECALHO_MENSAGENS, [0, 0, 1, "Ana", "Oi", ""]];
    lerXlsx.mockResolvedValue(linhas);
    const insert = vi.fn().mockReturnValue(chain({ error: { message: "boom" } }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "mensagens_simuladas") return { insert };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { importarMensagens } = await import("../app/(painel)/webinars/[id]/chat/actions");
    const r = await importarMensagens("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(100) }));

    expect(r.erro).toBe("Não deu para importar as mensagens.");
  });

  it("exige admin antes de tudo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { importarMensagens } = await import("../app/(painel)/webinars/[id]/chat/actions");
    await expect(importarMensagens("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(100) }))).rejects.toThrow(
      "Só administradores podem fazer isso.",
    );
    expect(lerXlsx).not.toHaveBeenCalled();
  });
});

describe("editarMensagem / excluirMensagem", () => {
  it("editarMensagem confere o webinar_id ao atualizar e grava antes/depois na auditoria", async () => {
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "mensagens_simuladas") {
        const c: any = {};
        c.select = () => c;
        c.maybeSingle = () => Promise.resolve({ data: { segundo: 1, nome: "Ana", texto: "Oi antigo", suporte: false } });
        c.update = update;
        c.eq = () => c;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { editarMensagem } = await import("../app/(painel)/webinars/[id]/chat/actions");
    const r = await editarMensagem("webinar-1", "item-1", {}, form({ momento: "0:05", nome: "Ana", texto: "Oi" }));

    expect(r.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ segundo: 5, nome: "Ana", texto: "Oi", suporte: false }));
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        antes: { segundo: 1, nome: "Ana", texto: "Oi antigo", suporte: false },
        depois: { segundo: 5, nome: "Ana", texto: "Oi", suporte: false },
      }),
    );
  });

  it("excluirMensagem exclui filtrando por id e webinar_id", async () => {
    const eq1 = vi.fn();
    const eq2 = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    eq1.mockReturnValue({ eq: eq2 });
    const del = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "mensagens_simuladas") return { delete: del };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { excluirMensagem } = await import("../app/(painel)/webinars/[id]/chat/actions");
    await excluirMensagem("webinar-1", form({ id: "item-1" }));

    expect(del).toHaveBeenCalled();
    expect(eq1).toHaveBeenCalledWith("id", "item-1");
    expect(eq2).toHaveBeenCalledWith("webinar_id", "webinar-1");
    expect(revalidatePath).toHaveBeenCalledWith("/webinars/webinar-1/chat");
  });
});

describe("importarVendas", () => {
  it("planilha com erro → não grava nada", async () => {
    lerXlsx.mockResolvedValue([CABECALHO_VENDAS, [0, 0, 1, ""]]);
    const insert = vi.fn();
    const from = vi.fn().mockImplementation(() => ({ insert }));
    dbUsuario.mockResolvedValue({ from });

    const { importarVendas } = await import("../app/(painel)/webinars/[id]/vendas/actions");
    const r = await importarVendas("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(100) }));

    expect(r.erros).toEqual(["Linha 2: falta o texto."]);
    expect(insert).not.toHaveBeenCalled();
  });

  it("planilha ok → insere em lotes", async () => {
    const linhas: unknown[][] = [CABECALHO_VENDAS];
    for (let i = 0; i < 600; i++) linhas.push([0, 0, 1, "Venda"]);
    lerXlsx.mockResolvedValue(linhas);

    const insert = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "vendas_simuladas") return { insert };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { importarVendas } = await import("../app/(painel)/webinars/[id]/vendas/actions");
    const r = await importarVendas("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(100) }));

    expect(r.importadas).toBe(600);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("lote do meio falha → erro de importação parcial (lotes anteriores já gravaram)", async () => {
    // Fica abaixo do limite de 1000 vendas da planilha (senão `linhasParaVendas` já devolve erro antes do insert).
    const linhas: unknown[][] = [CABECALHO_VENDAS];
    for (let i = 0; i < 600; i++) linhas.push([0, 0, 1, "Venda"]);
    lerXlsx.mockResolvedValue(linhas);

    let chamada = 0;
    const insert = vi.fn().mockImplementation(() => {
      chamada++;
      return chain({ error: chamada === 2 ? { message: "boom" } : null });
    });
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "vendas_simuladas") return { insert };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { importarVendas } = await import("../app/(painel)/webinars/[id]/vendas/actions");
    const r = await importarVendas("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(100) }));

    expect(r.erro).toBe("A importação parou no meio: algumas vendas podem ter sido gravadas. Confira a lista.");
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("mais de 1000 vendas na planilha → erro de limite, nada é gravado", async () => {
    const linhas: unknown[][] = [CABECALHO_VENDAS];
    for (let i = 0; i < 1001; i++) linhas.push([0, 0, 1, "Venda"]);
    lerXlsx.mockResolvedValue(linhas);
    const insert = vi.fn();
    const from = vi.fn().mockImplementation(() => ({ insert }));
    dbUsuario.mockResolvedValue({ from });

    const { importarVendas } = await import("../app/(painel)/webinars/[id]/vendas/actions");
    const r = await importarVendas("webinar-1", {}, form({}, { arquivo: arquivoXlsxFalso(100) }));

    expect(r.erros).toEqual(["A planilha passa de 1000 vendas."]);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("editarVenda / excluirVenda", () => {
  it("editarVenda confere o webinar_id ao atualizar e grava antes/depois na auditoria", async () => {
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "vendas_simuladas") {
        const c: any = {};
        c.select = () => c;
        c.maybeSingle = () => Promise.resolve({ data: { segundo: 10, texto: "Venda antiga" } });
        c.update = update;
        c.eq = () => c;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { editarVenda } = await import("../app/(painel)/webinars/[id]/vendas/actions");
    const r = await editarVenda("webinar-1", "item-1", {}, form({ momento: "0:30", texto: "Venda" }));

    expect(r.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ segundo: 30, texto: "Venda" }));
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        antes: { segundo: 10, texto: "Venda antiga" },
        depois: { segundo: 30, texto: "Venda" },
      }),
    );
  });

  it("excluirVenda exclui filtrando por id e webinar_id", async () => {
    const eq1 = vi.fn();
    const eq2 = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    eq1.mockReturnValue({ eq: eq2 });
    const del = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "vendas_simuladas") return { delete: del };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { excluirVenda } = await import("../app/(painel)/webinars/[id]/vendas/actions");
    await excluirVenda("webinar-1", form({ id: "item-1" }));

    expect(del).toHaveBeenCalled();
    expect(eq1).toHaveBeenCalledWith("id", "item-1");
    expect(eq2).toHaveBeenCalledWith("webinar_id", "webinar-1");
  });
});

describe("salvarTituloNotificacaoCompra", () => {
  it("vazio → grava o padrão 'Venda confirmada!' e audita antes/depois", async () => {
    const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: { titulo_notificacao_compra: "Antigo" } });
        c.update = update;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarTituloNotificacaoCompra } = await import("../app/(painel)/webinars/[id]/vendas/actions");
    const r = await salvarTituloNotificacaoCompra("webinar-1", {}, form({ titulo_notificacao_compra: "" }));

    expect(r.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ titulo_notificacao_compra: "Venda confirmada!" });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        antes: { titulo_notificacao_compra: "Antigo" },
        depois: { titulo_notificacao_compra: "Venda confirmada!" },
      }),
    );
  });

  it("acima de 150 caracteres → erro", async () => {
    dbUsuario.mockResolvedValue({ from: vi.fn() });
    const { salvarTituloNotificacaoCompra } = await import("../app/(painel)/webinars/[id]/vendas/actions");
    const r = await salvarTituloNotificacaoCompra("webinar-1", {}, form({ titulo_notificacao_compra: "a".repeat(151) }));
    expect(r.erro).toBe("Use até 150 caracteres.");
  });
});

describe("exportação xlsx sem admin → 401", () => {
  it("chat.xlsx", async () => {
    membroApi.mockResolvedValue(null);
    const { GET } = await import("../app/api/webinars/[id]/chat.xlsx/route");
    const res = await GET(new Request("https://x/api/webinars/webinar-1/chat.xlsx"), { params: Promise.resolve({ id: "webinar-1" }) });
    expect(res.status).toBe(401);
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("chat.xlsx com membro não admin → 401", async () => {
    membroApi.mockResolvedValue({ id: "u1", nome: "Fulano", papel: "atendente" });
    const { GET } = await import("../app/api/webinars/[id]/chat.xlsx/route");
    const res = await GET(new Request("https://x/api/webinars/webinar-1/chat.xlsx"), { params: Promise.resolve({ id: "webinar-1" }) });
    expect(res.status).toBe(401);
  });

  it("vendas.xlsx sem admin → 401", async () => {
    membroApi.mockResolvedValue(null);
    const { GET } = await import("../app/api/webinars/[id]/vendas.xlsx/route");
    const res = await GET(new Request("https://x/api/webinars/webinar-1/vendas.xlsx"), { params: Promise.resolve({ id: "webinar-1" }) });
    expect(res.status).toBe(401);
    expect(dbUsuario).not.toHaveBeenCalled();
  });
});

describe("exportação xlsx com mais de 1000 linhas (o PostgREST limita cada resposta a 1000)", () => {
  it("chat.xlsx: lê em páginas com lerTudo e manda tudo pro gerarXlsx", async () => {
    membroApi.mockResolvedValue({ id: "u1", nome: "Admin", papel: "admin" });
    const MENSAGENS = Array.from({ length: 1500 }, (_, i) => ({ id: `m${i}`, segundo: i, nome: "Fulano", texto: "Oi", suporte: false }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "webinars") return chain({ data: { slug: "aula" }, error: null });
      if (tabela === "mensagens_simuladas") return construtorMultiplo(MENSAGENS);
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { GET } = await import("../app/api/webinars/[id]/chat.xlsx/route");
    const res = await GET(new Request("https://x/api/webinars/webinar-1/chat.xlsx"), { params: Promise.resolve({ id: "webinar-1" }) });

    expect(res.status).toBe(200);
    expect(gerarXlsx).toHaveBeenCalledTimes(1);
    const linhas = gerarXlsx.mock.calls[0][0] as unknown[][];
    expect(linhas).toHaveLength(1501); // cabeçalho + 1500 mensagens
    expect(linhas[0]).toEqual(CABECALHO_MENSAGENS);
  });

  it("vendas.xlsx: lê em páginas com lerTudo e manda tudo pro gerarXlsx", async () => {
    membroApi.mockResolvedValue({ id: "u1", nome: "Admin", papel: "admin" });
    const VENDAS = Array.from({ length: 1200 }, (_, i) => ({ id: `v${i}`, segundo: i, texto: "Venda" }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "webinars") return chain({ data: { slug: "aula" }, error: null });
      if (tabela === "vendas_simuladas") return construtorMultiplo(VENDAS);
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { GET } = await import("../app/api/webinars/[id]/vendas.xlsx/route");
    const res = await GET(new Request("https://x/api/webinars/webinar-1/vendas.xlsx"), { params: Promise.resolve({ id: "webinar-1" }) });

    expect(res.status).toBe(200);
    expect(gerarXlsx).toHaveBeenCalledTimes(1);
    const linhas = gerarXlsx.mock.calls[0][0] as unknown[][];
    expect(linhas).toHaveLength(1201); // cabeçalho + 1200 vendas
    expect(linhas[0]).toEqual(CABECALHO_VENDAS);
  });

  it("chat.xlsx: erro no meio da paginação (ex.: na 2ª página) → 500, sem gerar arquivo parcial", async () => {
    membroApi.mockResolvedValue({ id: "u1", nome: "Admin", papel: "admin" });
    const MENSAGENS = Array.from({ length: 1500 }, (_, i) => ({ id: `m${i}`, segundo: i, nome: "Fulano", texto: "Oi", suporte: false }));
    let chamadas = 0;
    const from = vi.fn((tabela: string) => {
      if (tabela === "webinars") return chain({ data: { slug: "aula" }, error: null });
      if (tabela === "mensagens_simuladas") return construtorMultiplo(MENSAGENS, { falhar: chamadas++ === 1 });
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { GET } = await import("../app/api/webinars/[id]/chat.xlsx/route");
    const res = await GET(new Request("https://x/api/webinars/webinar-1/chat.xlsx"), { params: Promise.resolve({ id: "webinar-1" }) });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ erro: "Não deu para gerar a planilha. Tente de novo." });
    expect(gerarXlsx).not.toHaveBeenCalled();
  });

  it("vendas.xlsx: erro no meio da paginação (ex.: na 2ª página) → 500, sem gerar arquivo parcial", async () => {
    membroApi.mockResolvedValue({ id: "u1", nome: "Admin", papel: "admin" });
    const VENDAS = Array.from({ length: 1200 }, (_, i) => ({ id: `v${i}`, segundo: i, texto: "Venda" }));
    let chamadas = 0;
    const from = vi.fn((tabela: string) => {
      if (tabela === "webinars") return chain({ data: { slug: "aula" }, error: null });
      if (tabela === "vendas_simuladas") return construtorMultiplo(VENDAS, { falhar: chamadas++ === 1 });
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { GET } = await import("../app/api/webinars/[id]/vendas.xlsx/route");
    const res = await GET(new Request("https://x/api/webinars/webinar-1/vendas.xlsx"), { params: Promise.resolve({ id: "webinar-1" }) });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ erro: "Não deu para gerar a planilha. Tente de novo." });
    expect(gerarXlsx).not.toHaveBeenCalled();
  });
});
