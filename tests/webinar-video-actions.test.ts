import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const revalidatePath = vi.fn();
const registrarAuditoria = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: (...a: unknown[]) => exigirAdmin(...a), dbUsuario: (...a: unknown[]) => dbUsuario(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));

/** Fábrica de uma chain estilo Supabase que resolve pro `resultado` dado, aceitando qualquer método encadeado. */
function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "upsert", "maybeSingle"]) p[m] = () => p;
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
  revalidatePath.mockReset();
  registrarAuditoria.mockReset();
});

describe("salvarVideoWebinar", () => {
  it("orientação inválida → erro, mantém os valores, nem consulta o vídeo", async () => {
    const from = vi.fn();
    dbUsuario.mockResolvedValue({ from });

    const { salvarVideoWebinar } = await import("../app/(painel)/webinars/[id]/video/actions");
    const campos = { video_id: "video-1", autoplay: "", tela_cheia: "", orientacao: "diagonal" };
    const r = await salvarVideoWebinar("webinar-1", {}, form(campos));

    expect(r).toEqual({ erro: "Escolha o formato do vídeo.", valores: campos });
    expect(from).not.toHaveBeenCalled();
  });

  it("vídeo não pronto → erro, mantém os valores", async () => {
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "videos") return chain({ data: { status: "processando" } });
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarVideoWebinar } = await import("../app/(painel)/webinars/[id]/video/actions");
    const campos = { video_id: "video-1", autoplay: "on", tela_cheia: "", orientacao: "horizontal" };
    const r = await salvarVideoWebinar("webinar-1", {}, form(campos));

    expect(r).toEqual({ erro: "Escolha um vídeo pronto.", valores: campos });
  });

  it("vídeo inexistente → erro", async () => {
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "videos") return chain({ data: null });
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarVideoWebinar } = await import("../app/(painel)/webinars/[id]/video/actions");
    const campos = { video_id: "video-x", autoplay: "", tela_cheia: "", orientacao: "vertical" };
    const r = await salvarVideoWebinar("webinar-1", {}, form(campos));

    expect(r).toEqual({ erro: "Escolha um vídeo pronto.", valores: campos });
  });

  it("vídeo pronto → upsert com onConflict webinar_id e revalida a página", async () => {
    const upsert = vi.fn().mockReturnValue(chain({ error: null }));
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
    dbUsuario.mockResolvedValue({ from });

    const { salvarVideoWebinar } = await import("../app/(painel)/webinars/[id]/video/actions");
    const campos = { video_id: "video-1", autoplay: "on", tela_cheia: "on", orientacao: "vertical" };
    const r = await salvarVideoWebinar("webinar-1", {}, form(campos));

    expect(r).toEqual({ ok: true, valores: campos });
    expect(upsert).toHaveBeenCalledWith(
      { webinar_id: "webinar-1", video_id: "video-1", autoplay: true, tela_cheia: true, orientacao: "vertical" },
      { onConflict: "webinar_id" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/webinars/webinar-1/video");
  });

  it("upsert falha → erro amigável", async () => {
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "videos") return chain({ data: { status: "pronto" } });
      if (tabela === "webinar_video") {
        const c: any = { upsert: () => chain({ error: { message: "boom" } }) };
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: null });
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarVideoWebinar } = await import("../app/(painel)/webinars/[id]/video/actions");
    const campos = { video_id: "video-1", autoplay: "", tela_cheia: "", orientacao: "horizontal" };
    const r = await salvarVideoWebinar("webinar-1", {}, form(campos));

    expect(r).toEqual({ erro: "Não deu para salvar o vídeo.", valores: campos });
  });
});

const CAMPOS_VIDEO_OK = { video_id: "video-1", autoplay: "on", tela_cheia: "", orientacao: "horizontal" };
const CAMPOS_AUDIENCIA = { modo: "dinamico", minimo: "50", maximo: "500", selo_ao_vivo: "on" };

describe("salvarVideoWebinar com a seção Audiência", () => {
  it("audiência inválida → erroAudiencia, nada gravado (nem o vídeo)", async () => {
    const upsert = vi.fn();
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "videos") return chain({ data: { status: "pronto" } });
      return { upsert };
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarVideoWebinar } = await import("../app/(painel)/webinars/[id]/video/actions");
    const campos = { ...CAMPOS_VIDEO_OK, ...CAMPOS_AUDIENCIA, minimo: "900" };
    const r = await salvarVideoWebinar("webinar-1", {}, form(campos));

    expect(r).toEqual({ erroAudiencia: "O mínimo não pode passar do máximo.", valores: campos });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("válida → grava o vídeo e a audiência (upsert por webinar_id) e audita a mudança", async () => {
    const upsertVideo = vi.fn().mockReturnValue(chain({ error: null }));
    const upsertAudiencia = vi.fn().mockReturnValue(chain({ error: null }));
    const tabela = (upsert: unknown) => {
      const c: any = { upsert };
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = () => Promise.resolve({ data: null });
      return c;
    };
    const from = vi.fn().mockImplementation((t: string) => {
      if (t === "videos") return chain({ data: { status: "pronto" } });
      if (t === "webinar_video") return tabela(upsertVideo);
      if (t === "audiencias") return tabela(upsertAudiencia);
      throw new Error("tabela inesperada: " + t);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarVideoWebinar } = await import("../app/(painel)/webinars/[id]/video/actions");
    const r = await salvarVideoWebinar("webinar-1", {}, form({ ...CAMPOS_VIDEO_OK, ...CAMPOS_AUDIENCIA }));

    expect(r.ok).toBe(true);
    expect(upsertVideo).toHaveBeenCalled();
    expect(upsertAudiencia).toHaveBeenCalledWith(
      { webinar_id: "webinar-1", modo: "dinamico", minimo: 50, maximo: 500, selo_ao_vivo: true },
      { onConflict: "webinar_id" },
    );
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Editou a audiência" }));
  });
});
