import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const revalidatePath = vi.fn();
const registrarAuditoria = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: (...a: unknown[]) => exigirAdmin(...a), dbUsuario: (...a: unknown[]) => dbUsuario(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));

function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "insert", "update", "delete", "upsert", "maybeSingle"]) p[m] = () => p;
  return p;
}

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

/** `checkout_webhooks` com uma linha salva; devolve o `update` pra conferir o que foi gravado. */
function webhookSalvo(linha: Record<string, unknown>) {
  const update = vi.fn().mockReturnValue(chain({ error: null }));
  const from = vi.fn().mockImplementation((tabela: string) => {
    if (tabela === "checkout_webhooks") {
      const c: any = {};
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = () => Promise.resolve({ data: linha });
      c.update = update;
      return c;
    }
    throw new Error("tabela inesperada: " + tabela);
  });
  dbUsuario.mockResolvedValue({ from });
  return update;
}

beforeEach(() => {
  vi.resetModules();
  exigirAdmin.mockReset();
  exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
  dbUsuario.mockReset();
  revalidatePath.mockReset();
  registrarAuditoria.mockReset();
});

describe("trocarWebinarWebhook", () => {
  it("exige admin antes de tudo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { trocarWebinarWebhook } = await import("../app/(painel)/configuracoes/actions");
    await expect(trocarWebinarWebhook("webhook-1", form({ webinar_id: "web-2" }))).rejects.toThrow();
  });

  it("sem webinar_id: não faz nada", async () => {
    const from = vi.fn();
    dbUsuario.mockResolvedValue({ from });
    const { trocarWebinarWebhook } = await import("../app/(painel)/configuracoes/actions");
    await trocarWebinarWebhook("webhook-1", form({}));
    expect(from).not.toHaveBeenCalled();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("troca o webinar e grava antes/depois na auditoria (Revisão final: ação sem auditoria antes)", async () => {
    const update = webhookSalvo({ webinar_id: "web-1" });
    const { trocarWebinarWebhook } = await import("../app/(painel)/configuracoes/actions");
    await trocarWebinarWebhook("webhook-1", form({ webinar_id: "web-2" }));

    expect(update).toHaveBeenCalledWith({ webinar_id: "web-2" });
    expect(revalidatePath).toHaveBeenCalledWith("/configuracoes");
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: "editou",
        webinarId: "web-2",
        antes: { webinar_id: "web-1" },
        depois: { webinar_id: "web-2" },
      }),
    );
  });
});

describe("salvarFiltroWebhook", () => {
  it("exige admin antes de tudo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { salvarFiltroWebhook } = await import("../app/(painel)/configuracoes/actions");
    await expect(salvarFiltroWebhook("webhook-1", form({ filtro_src: "loja-x" }))).rejects.toThrow();
  });

  it("salva o filtro e grava antes/depois na auditoria", async () => {
    const update = webhookSalvo({ webinar_id: "web-1", filtro_src: "loja-antiga" });
    const { salvarFiltroWebhook } = await import("../app/(painel)/configuracoes/actions");
    await salvarFiltroWebhook("webhook-1", form({ filtro_src: "loja-nova" }));

    expect(update).toHaveBeenCalledWith({ filtro_src: "loja-nova" });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: "editou",
        webinarId: "web-1",
        antes: { filtro_src: "loja-antiga" },
        depois: { filtro_src: "loja-nova" },
      }),
    );
  });

  it("filtro vazio grava null", async () => {
    const update = webhookSalvo({ webinar_id: "web-1", filtro_src: "loja-antiga" });
    const { salvarFiltroWebhook } = await import("../app/(painel)/configuracoes/actions");
    await salvarFiltroWebhook("webhook-1", form({ filtro_src: "   " }));

    expect(update).toHaveBeenCalledWith({ filtro_src: null });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ depois: { filtro_src: null } }));
  });
});
