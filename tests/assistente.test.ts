import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAVES_PASSOS, destinoProximo, numeroPasso, rotaPasso, rotaProximoPasso } from "../src/lib/regras/assistente";

describe("rotas dos passos", () => {
  it("9 passos, sem Integrações (em Configurações), Chatbot nem Audiência (no Vídeo) (Webinar = /agenda)", () => {
    expect(CHAVES_PASSOS).toHaveLength(9);
    expect(CHAVES_PASSOS).not.toContain("audiencia");
    expect(CHAVES_PASSOS).not.toContain("integracoes");
    expect(CHAVES_PASSOS).not.toContain("chatbot");
    expect(CHAVES_PASSOS[0]).toBe("inicio");
    expect(CHAVES_PASSOS[1]).toBe("agenda");
    expect(CHAVES_PASSOS[8]).toBe("pronto");
  });

  it("rotaPasso e numeroPasso", () => {
    expect(rotaPasso("w1", "video")).toBe("/webinars/w1/video");
    expect(numeroPasso("inicio")).toBe(1);
    expect(numeroPasso("pronto")).toBe(9);
    expect(rotaProximoPasso("w1", "vendas")).toBe("/webinars/w1/agente");
  });

  it("rotaProximoPasso: o seguinte, e null no último", () => {
    expect(rotaProximoPasso("w1", "inicio")).toBe("/webinars/w1/agenda");
    expect(rotaProximoPasso("w1", "agente")).toBe("/webinars/w1/pronto");
    expect(rotaProximoPasso("w1", "pronto")).toBeNull();
  });
});

describe("destinoProximo", () => {
  it("aceita rota de passo do próprio webinar e a lista", () => {
    expect(destinoProximo("/webinars/w1/login", "w1")).toBe("/webinars/w1/login");
    expect(destinoProximo(" /webinars/w1/pronto ", "w1")).toBe("/webinars/w1/pronto");
    expect(destinoProximo("/webinars", "w1")).toBe("/webinars");
  });

  it("recusa vazio, não-texto, outro webinar, passo inexistente e qualquer outro caminho", () => {
    expect(destinoProximo(null, "w1")).toBeNull();
    expect(destinoProximo(undefined, "w1")).toBeNull();
    expect(destinoProximo("", "w1")).toBeNull();
    expect(destinoProximo(new File([], "x"), "w1")).toBeNull();
    expect(destinoProximo("/webinars/w2/login", "w1")).toBeNull();
    expect(destinoProximo("/webinars/w1/metricas", "w1")).toBeNull();
    expect(destinoProximo("/webinars/w1/login?x=1", "w1")).toBeNull();
    expect(destinoProximo("/webinars/w1/../w2/login", "w1")).toBeNull();
    expect(destinoProximo("https://malicioso.com/webinars/w1/login", "w1")).toBeNull();
    expect(destinoProximo("//malicioso.com", "w1")).toBeNull();
    expect(destinoProximo("/webinars/w1/login", "")).toBeNull();
  });
});

// --- "Continuar": a action salva e redireciona pro passo seguinte -------------------------------------------------

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const revalidatePath = vi.fn();
const registrarAuditoria = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: (...a: unknown[]) => exigirAdmin(...a), dbUsuario: (...a: unknown[]) => dbUsuario(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));
vi.mock("next/navigation", () => ({ redirect: (...a: [string]) => redirect(...a) }));

function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "upsert", "update", "maybeSingle"]) p[m] = () => p;
  return p;
}

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

/** Banco falso do passo Vídeo: vídeo pronto e upsert ok (ou com erro). */
function dbVideo(erroUpsert = false) {
  const upsert = vi.fn().mockReturnValue(chain({ error: erroUpsert ? { message: "boom" } : null }));
  const from = vi.fn().mockImplementation((tabela: string) => {
    if (tabela === "videos") return chain({ data: { status: "pronto" } });
    if (tabela === "webinar_video") {
      const c: any = { upsert };
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = () => Promise.resolve({ data: null });
      return c;
    }
    throw new Error("tabela inesperada: " + tabela);
  });
  return { from, upsert };
}

const CAMPOS_VIDEO = { video_id: "video-1", autoplay: "on", tela_cheia: "", orientacao: "horizontal" };

beforeEach(() => {
  vi.resetModules();
  exigirAdmin.mockReset();
  exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
  dbUsuario.mockReset();
  revalidatePath.mockReset();
  registrarAuditoria.mockReset();
  redirect.mockClear();
});

describe("Continuar (campo `proximo`)", () => {
  it("salvou e veio `proximo` válido: grava, audita e redireciona pro passo seguinte", async () => {
    const { from, upsert } = dbVideo();
    dbUsuario.mockResolvedValue({ from });
    const { salvarVideoWebinar } = await import("../app/(painel)/webinars/[id]/video/actions");

    await expect(salvarVideoWebinar("webinar-1", {}, form({ ...CAMPOS_VIDEO, proximo: "/webinars/webinar-1/oferta" }))).rejects.toThrow(
      "REDIRECT:/webinars/webinar-1/oferta",
    );
    expect(upsert).toHaveBeenCalled();
    expect(registrarAuditoria).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/webinars/webinar-1/video");
  });

  it("sem `proximo`: salva e fica na tela (comportamento de antes)", async () => {
    const { from } = dbVideo();
    dbUsuario.mockResolvedValue({ from });
    const { salvarVideoWebinar } = await import("../app/(painel)/webinars/[id]/video/actions");

    const r = await salvarVideoWebinar("webinar-1", {}, form(CAMPOS_VIDEO));
    expect(r).toEqual({ ok: true, valores: CAMPOS_VIDEO });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("`proximo` de fora (outro webinar ou URL externa): salva e não redireciona", async () => {
    for (const proximo of ["/webinars/outro/oferta", "https://x.com"]) {
      const { from } = dbVideo();
      dbUsuario.mockResolvedValue({ from });
      const { salvarVideoWebinar } = await import("../app/(painel)/webinars/[id]/video/actions");
      const r = await salvarVideoWebinar("webinar-1", {}, form({ ...CAMPOS_VIDEO, proximo }));
      expect(r.ok).toBe(true);
    }
    expect(redirect).not.toHaveBeenCalled();
  });

  it("erro ao salvar: devolve o erro e não avança", async () => {
    const { from } = dbVideo(true);
    dbUsuario.mockResolvedValue({ from });
    const { salvarVideoWebinar } = await import("../app/(painel)/webinars/[id]/video/actions");

    const r = await salvarVideoWebinar("webinar-1", {}, form({ ...CAMPOS_VIDEO, proximo: "/webinars/webinar-1/oferta" }));
    expect(r.erro).toBe("Não deu para salvar o vídeo.");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("erro de validação: não avança", async () => {
    const { salvarTituloNotificacaoCompra } = await import("../app/(painel)/webinars/[id]/vendas/actions");
    const r = await salvarTituloNotificacaoCompra("webinar-1", {}, form({ titulo_notificacao_compra: "x".repeat(500), proximo: "/webinars/webinar-1/agente" }));
    expect(r.erro).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("título da notificação de compra (Vendas): salva e vai pro Agente de IA", async () => {
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela !== "webinars") throw new Error("tabela inesperada: " + tabela);
      const c: any = { update };
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = () => Promise.resolve({ data: { titulo_notificacao_compra: "Antigo" } });
      return c;
    });
    dbUsuario.mockResolvedValue({ from });
    const { salvarTituloNotificacaoCompra } = await import("../app/(painel)/webinars/[id]/vendas/actions");

    await expect(
      salvarTituloNotificacaoCompra("webinar-1", {}, form({ titulo_notificacao_compra: "Compra feita!", proximo: "/webinars/webinar-1/agente" })),
    ).rejects.toThrow("REDIRECT:/webinars/webinar-1/agente");
    expect(update).toHaveBeenCalledWith({ titulo_notificacao_compra: "Compra feita!" });
  });

  it("agente de IA: salva e vai pro Pronto", async () => {
    const upsert = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation(() => {
      const c: any = { upsert };
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = () => Promise.resolve({ data: null });
      return c;
    });
    dbUsuario.mockResolvedValue({ from });
    const { salvarAgente } = await import("../app/(painel)/webinars/[id]/agente/actions");

    await expect(salvarAgente("webinar-1", {}, form({ ligado: "", nome: "Suporte", proximo: "/webinars/webinar-1/pronto" }))).rejects.toThrow(
      "REDIRECT:/webinars/webinar-1/pronto",
    );
    expect(upsert).toHaveBeenCalled();
  });
});
