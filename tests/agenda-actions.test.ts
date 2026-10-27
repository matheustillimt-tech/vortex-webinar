import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const registrarAuditoria = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: (...a: unknown[]) => exigirAdmin(...a), dbUsuario: (...a: unknown[]) => dbUsuario(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));

function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "upsert", "update", "eq"]) p[m] = () => p;
  p.maybeSingle = () => Promise.resolve({ data: null });
  return p;
}

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

describe("salvarAgenda: mantém o que a pessoa digitou quando dá erro", () => {
  beforeEach(() => {
    vi.resetModules();
    exigirAdmin.mockReset();
    exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
    dbUsuario.mockReset();
    registrarAuditoria.mockReset();
  });

  it("agenda inválida: devolve os campos digitados em `valores`", async () => {
    const { salvarAgenda } = await import("../app/(painel)/webinars/[id]/agenda/actions");
    const campos = { fuso: "Marte/Base", repeticao: "diaria", hora_inicio: "19:00", hora_fim: "21:00" };
    const r = await salvarAgenda("web-1", {}, form(campos));
    expect(r).toEqual({ erro: "Escolha um fuso horário.", valores: campos });
  });

  it("agenda válida mas o banco falha: também devolve os campos digitados", async () => {
    const from = vi.fn().mockReturnValue(chain({ error: { message: "falhou" } }));
    dbUsuario.mockResolvedValue({ from });
    const { salvarAgenda } = await import("../app/(painel)/webinars/[id]/agenda/actions");
    const campos = { fuso: "America/Sao_Paulo", repeticao: "diaria", hora_inicio: "19:00", hora_fim: "21:00" };
    const r = await salvarAgenda("web-1", {}, form(campos));
    expect(r).toEqual({ erro: "Não deu para salvar a agenda.", valores: campos });
  });

  it("agenda salva com sucesso: não precisa de `valores`", async () => {
    const from = vi.fn().mockReturnValue(chain({ error: null }));
    dbUsuario.mockResolvedValue({ from });
    const { salvarAgenda } = await import("../app/(painel)/webinars/[id]/agenda/actions");
    const campos = { fuso: "America/Sao_Paulo", repeticao: "diaria", hora_inicio: "19:00", hora_fim: "21:00" };
    const r = await salvarAgenda("web-1", {}, form(campos));
    expect(r).toEqual({ ok: true });
  });
});
