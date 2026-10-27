import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const registrarAuditoria = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: (...a: unknown[]) => exigirAdmin(...a), dbUsuario: (...a: unknown[]) => dbUsuario(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (...a: [string]) => redirect(...a) }));

/** Fábrica de uma chain estilo Supabase que resolve pro `resultado` dado, aceitando qualquer método encadeado. */
function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "like", "eq", "insert", "single", "maybeSingle"]) p[m] = () => p;
  return p;
}

describe("criarWebinar: mantém o que a pessoa digitou quando dá erro", () => {
  beforeEach(() => {
    vi.resetModules();
    exigirAdmin.mockReset();
    exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
    registrarAuditoria.mockReset();
    dbUsuario.mockReset();
    redirect.mockClear();
  });

  it("nome vazio: devolve o valor digitado (vazio) em `valores`", async () => {
    const { criarWebinar } = await import("../app/(painel)/webinars/actions");
    const form = new FormData();
    form.set("nome", "   ");
    const r = await criarWebinar({}, form);
    expect(r).toEqual({ erro: "Dê um nome ao webinar.", valores: { nome: "" } });
  });

  it("slug inválido: devolve o nome digitado em `valores`", async () => {
    const { criarWebinar } = await import("../app/(painel)/webinars/actions");
    const form = new FormData();
    form.set("nome", "!!");
    const r = await criarWebinar({}, form);
    expect(r).toEqual({ erro: "Use um nome com pelo menos 3 letras ou números.", valores: { nome: "!!" } });
  });
});

describe("criarWebinar", () => {
  beforeEach(() => {
    vi.resetModules();
    exigirAdmin.mockReset();
    exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
    registrarAuditoria.mockReset();
    dbUsuario.mockReset();
    redirect.mockClear();
  });

  it("colisão de slug (23505): refaz a busca com prefixo de 50 caracteres e tenta de novo com sucesso", async () => {
    const from = vi.fn();
    let chamadaInsert = 0;
    from.mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c = chain(undefined);
        // select().like() -> lista de slugs parecidos
        c.select = () => c;
        c.like = (_coluna: string, padrao: string) => {
          // primeira busca usa o slug completo, a segunda (depois do 23505) usa o prefixo de 50
          expect(padrao.endsWith("%")).toBe(true);
          return chain({ data: [{ slug: "aulao-renda-com-ia" }] });
        };
        c.insert = () => {
          chamadaInsert++;
          if (chamadaInsert === 1) {
            return chain({ data: null, error: { code: "23505", message: "duplicate" } });
          }
          return chain({ data: { id: "web-1" }, error: null });
        };
        return c;
      }
      if (tabela === "agendas") {
        return chain({ error: null });
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { criarWebinar } = await import("../app/(painel)/webinars/actions");
    const form = new FormData();
    form.set("nome", "Aulão Renda com IA");

    await expect(criarWebinar({}, form)).rejects.toThrow("REDIRECT:/webinars/web-1/inicio");
    expect(chamadaInsert).toBe(2);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: "admin-1", webinarId: "web-1", acao: "criou" }),
    );
  });

  it("colisão de slug (23505) persiste na segunda tentativa: devolve o erro genérico", async () => {
    const from = vi.fn();
    from.mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c = chain(undefined);
        c.select = () => c;
        c.like = () => chain({ data: [] });
        c.insert = () => chain({ data: null, error: { code: "23505", message: "duplicate" } });
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { criarWebinar } = await import("../app/(painel)/webinars/actions");
    const form = new FormData();
    form.set("nome", "Aulão Renda com IA");

    const r = await criarWebinar({}, form);
    expect(r).toEqual({ erro: "Não deu para criar o webinar.", valores: { nome: "Aulão Renda com IA" } });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sem colisão: insere de primeira, sem tentativa extra", async () => {
    const from = vi.fn();
    let chamadaInsert = 0;
    from.mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c = chain(undefined);
        c.select = () => c;
        c.like = () => chain({ data: [] });
        c.insert = () => {
          chamadaInsert++;
          return chain({ data: { id: "web-2" }, error: null });
        };
        return c;
      }
      if (tabela === "agendas") return chain({ error: null });
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { criarWebinar } = await import("../app/(painel)/webinars/actions");
    const form = new FormData();
    form.set("nome", "Outro Webinar");

    await expect(criarWebinar({}, form)).rejects.toThrow("REDIRECT:/webinars/web-2/inicio");
    expect(chamadaInsert).toBe(1);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: "admin-1", webinarId: "web-2", acao: "criou" }),
    );
  });
});
