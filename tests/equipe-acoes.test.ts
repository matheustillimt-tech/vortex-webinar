import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const dbAdmin = vi.fn();
const registrarAuditoria = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: (...a: unknown[]) => exigirAdmin(...a), dbUsuario: (...a: unknown[]) => dbUsuario(...a) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));

/** Fábrica de uma chain estilo Supabase que resolve pro `resultado` dado, aceitando qualquer método encadeado. */
function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "insert", "update", "maybeSingle"]) p[m] = () => p;
  return p;
}

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.resetModules();
  exigirAdmin.mockReset();
  exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
  dbUsuario.mockReset();
  dbAdmin.mockReset();
  registrarAuditoria.mockReset();
});

describe("criarPessoa", () => {
  it("sucesso: registra auditoria com o nome da pessoa, nunca com a senha", async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
    const insert = vi.fn().mockReturnValue(chain({ error: null }));
    dbAdmin.mockReturnValue({ auth: { admin: { createUser } }, from: vi.fn().mockReturnValue({ insert }) });

    const { criarPessoa } = await import("../app/(painel)/equipe/actions");
    const r = await criarPessoa(
      {},
      form({ nome: "Clara Souza", email: "carla@exemplo.com", senha: "segredo123", papel: "atendente" }),
    );

    expect(r).toEqual({ ok: true });
    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
    const chamada = registrarAuditoria.mock.calls[0][0];
    expect(chamada).toEqual(expect.objectContaining({ usuarioId: "admin-1", acao: "criou", descricao: "Criou o acesso de Clara Souza" }));
    expect(JSON.stringify(chamada)).not.toContain("segredo123");
  });
});

describe("mudarPapel", () => {
  it("sucesso: registra auditoria com o papel novo", async () => {
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const select = vi.fn().mockReturnValue(chain({ data: { nome: "Clara Souza", papel: "atendente" } }));
    dbUsuario.mockResolvedValue({ from: vi.fn().mockReturnValue({ select, update }) });

    const { mudarPapel } = await import("../app/(painel)/equipe/actions");
    await mudarPapel("pessoa-1", "admin");

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: "admin-1", acao: "editou", descricao: "Mudou o papel de Clara Souza para admin" }),
    );
  });

  it("não deixa mudar o próprio papel nem registra auditoria", async () => {
    const { mudarPapel } = await import("../app/(painel)/equipe/actions");
    await expect(mudarPapel("admin-1", "atendente")).rejects.toThrow("Você não pode mudar o próprio papel.");
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe("mudarAtivo", () => {
  it("sucesso: registra auditoria dizendo se ativou ou desativou", async () => {
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const select = vi.fn().mockReturnValue(chain({ data: { nome: "Dani", ativo: true } }));
    dbUsuario.mockResolvedValue({ from: vi.fn().mockReturnValue({ select, update }) });

    const { mudarAtivo } = await import("../app/(painel)/equipe/actions");
    await mudarAtivo("pessoa-2", false);

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: "admin-1", acao: "editou", descricao: "Desativou o acesso de Dani" }),
    );
  });
});
