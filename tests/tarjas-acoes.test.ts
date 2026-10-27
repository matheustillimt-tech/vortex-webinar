import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const revalidatePath = vi.fn();
const registrarAuditoria = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: (...a: unknown[]) => exigirAdmin(...a), dbUsuario: (...a: unknown[]) => dbUsuario(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));
vi.mock("../app/(painel)/webinars/[id]/_proximo", () => ({ seguirParaProximo: vi.fn() }));

type Chamada = { metodo: string; args: unknown[] };
type ConfigTabela = { unico?: unknown; resultado?: unknown };

/** Banco falso: cada `from(tabela)` devolve uma cadeia que registra as chamadas. `maybeSingle()` resolve `unico`;
 *  aguardar a cadeia direto (insert/update/delete/count) resolve `resultado`. */
function bancoFalso(tabelas: Record<string, ConfigTabela>) {
  const chamadas: Record<string, Chamada[][]> = {};
  const from = vi.fn((tabela: string) => {
    const cfg = tabelas[tabela];
    if (!cfg) throw new Error(`tabela inesperada: ${tabela}`);
    const lista: Chamada[] = [];
    (chamadas[tabela] ??= []).push(lista);
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "insert", "update", "delete"]) {
      c[m] = (...args: unknown[]) => {
        lista.push({ metodo: m, args });
        return c;
      };
    }
    c.maybeSingle = () => Promise.resolve({ data: cfg.unico ?? null, error: null });
    c.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(cfg.resultado ?? { error: null }).then(ok, erro);
    return c;
  });
  /** Chamadas de uma tabela que usaram `metodo` (insert/update/delete). */
  const com = (tabela: string, metodo: string) => (chamadas[tabela] ?? []).filter((l) => l.some((x) => x.metodo === metodo));
  return { from, chamadas, com };
}

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const CAMPOS = { texto: "Nós vamos fechar a sala, não saia dela!", aparece: "0:00:02", duracao_seg: "15", posicao: "topo", cor: "vermelho" };
const COM_VIDEO = {
  webinar_video: { unico: { video_id: "vid-1" } },
  videos: { unico: { duracao_seg: 1800 } },
};

beforeEach(() => {
  vi.resetModules();
  exigirAdmin.mockReset();
  exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
  dbUsuario.mockReset();
  revalidatePath.mockReset();
  registrarAuditoria.mockReset();
});

describe("adicionarTarja", () => {
  it("exige admin antes de tudo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { adicionarTarja } = await import("../app/(painel)/webinars/[id]/video/actions");
    await expect(adicionarTarja("web-1", {}, form(CAMPOS))).rejects.toThrow("Só administradores podem fazer isso.");
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("insere com os campos validados, revalida o passo e registra auditoria", async () => {
    const banco = bancoFalso({ ...COM_VIDEO, tarjas_aviso: { resultado: { count: 3, error: null } } });
    dbUsuario.mockResolvedValue({ from: banco.from });
    const { adicionarTarja } = await import("../app/(painel)/webinars/[id]/video/actions");

    const r = await adicionarTarja("web-1", {}, form(CAMPOS));

    expect(r).toEqual({ ok: true });
    const [insercao] = banco.com("tarjas_aviso", "insert");
    expect(insercao.find((x) => x.metodo === "insert")?.args[0]).toEqual({
      webinar_id: "web-1",
      texto: "Nós vamos fechar a sala, não saia dela!",
      aparece_seg: 2,
      duracao_seg: 15,
      posicao: "topo",
      cor: "vermelho",
      ligada: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/webinars/web-1/video");
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: "admin-1", webinarId: "web-1", acao: "criou" }));
  });

  it("momento depois do fim do vídeo: erro com os valores digitados, sem inserir", async () => {
    const banco = bancoFalso({ ...COM_VIDEO, tarjas_aviso: {} });
    dbUsuario.mockResolvedValue({ from: banco.from });
    const { adicionarTarja } = await import("../app/(painel)/webinars/[id]/video/actions");

    const campos = { ...CAMPOS, aparece: "0:45:00" };
    const r = await adicionarTarja("web-1", {}, form(campos));

    expect(r).toEqual({ erro: "O vídeo tem 30:00: escolha um momento antes do fim.", valores: campos });
    expect(banco.from).not.toHaveBeenCalledWith("tarjas_aviso");
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("limite de 20 tarjas por webinar", async () => {
    const banco = bancoFalso({ ...COM_VIDEO, tarjas_aviso: { resultado: { count: 20, error: null } } });
    dbUsuario.mockResolvedValue({ from: banco.from });
    const { adicionarTarja } = await import("../app/(painel)/webinars/[id]/video/actions");

    const r = await adicionarTarja("web-1", {}, form(CAMPOS));

    expect(r.erro).toBe("Cada webinar pode ter até 20 tarjas.");
    expect(banco.com("tarjas_aviso", "insert")).toEqual([]);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("sem vídeo escolhido: não limita o momento", async () => {
    const banco = bancoFalso({ webinar_video: {}, tarjas_aviso: { resultado: { count: 0, error: null } } });
    dbUsuario.mockResolvedValue({ from: banco.from });
    const { adicionarTarja } = await import("../app/(painel)/webinars/[id]/video/actions");

    const r = await adicionarTarja("web-1", {}, form({ ...CAMPOS, aparece: "3:00:00" }));
    expect(r).toEqual({ ok: true });
  });

  it("erro do banco (contagem): devolve erro, não insere nem registra auditoria", async () => {
    const banco = bancoFalso({ ...COM_VIDEO, tarjas_aviso: { resultado: { count: 0, error: { message: "falhou" } } } });
    dbUsuario.mockResolvedValue({ from: banco.from });
    const { adicionarTarja } = await import("../app/(painel)/webinars/[id]/video/actions");

    const r = await adicionarTarja("web-1", {}, form(CAMPOS));
    expect(r.erro).toBe("Não deu para adicionar a tarja.");
    expect(banco.com("tarjas_aviso", "insert")).toEqual([]);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe("editarTarja", () => {
  it("atualiza filtrando por id e webinar_id, com antes/depois na auditoria", async () => {
    const antes = { texto: "Velho", aparece_seg: 5, duracao_seg: 10, posicao: "base", cor: "preto", ligada: true };
    const banco = bancoFalso({ ...COM_VIDEO, tarjas_aviso: { unico: antes } });
    dbUsuario.mockResolvedValue({ from: banco.from });
    const { editarTarja } = await import("../app/(painel)/webinars/[id]/video/actions");

    const r = await editarTarja("web-1", "t-1", {}, form({ ...CAMPOS, cor: "amarelo", posicao: "base" }));

    expect(r).toEqual({ ok: true });
    const [atualizacao] = banco.com("tarjas_aviso", "update");
    expect(atualizacao).toEqual([
      { metodo: "update", args: [{ texto: CAMPOS.texto, aparece_seg: 2, duracao_seg: 15, posicao: "base", cor: "amarelo", ligada: true }] },
      { metodo: "eq", args: ["id", "t-1"] },
      { metodo: "eq", args: ["webinar_id", "web-1"] },
    ]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "editou", antes, depois: expect.objectContaining({ cor: "amarelo" }) }));
  });

  it("tarja de outro webinar (ou apagada): não atualiza", async () => {
    const banco = bancoFalso({ ...COM_VIDEO, tarjas_aviso: { unico: null } });
    dbUsuario.mockResolvedValue({ from: banco.from });
    const { editarTarja } = await import("../app/(painel)/webinars/[id]/video/actions");

    const r = await editarTarja("web-1", "t-x", {}, form(CAMPOS));
    expect(r.erro).toBe("Essa tarja não existe mais.");
    expect(banco.com("tarjas_aviso", "update")).toEqual([]);
  });
});

describe("alternarTarja", () => {
  it("grava o contrário do estado atual e registra auditoria", async () => {
    const banco = bancoFalso({ tarjas_aviso: { unico: { texto: "Não saia" } } });
    dbUsuario.mockResolvedValue({ from: banco.from });
    const { alternarTarja } = await import("../app/(painel)/webinars/[id]/video/actions");

    await alternarTarja("web-1", form({ id: "t-1", ligada: "1" }));

    const [atualizacao] = banco.com("tarjas_aviso", "update");
    expect(atualizacao[0]).toEqual({ metodo: "update", args: [{ ligada: false }] });
    expect(atualizacao).toContainEqual({ metodo: "eq", args: ["webinar_id", "web-1"] });
    expect(revalidatePath).toHaveBeenCalledWith("/webinars/web-1/video");
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "editou", descricao: 'Desligou a tarja de aviso "Não saia"', antes: { ligada: true }, depois: { ligada: false } }),
    );
  });

  it("exige admin", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { alternarTarja } = await import("../app/(painel)/webinars/[id]/video/actions");
    await expect(alternarTarja("web-1", form({ id: "t-1", ligada: "0" }))).rejects.toThrow();
    expect(dbUsuario).not.toHaveBeenCalled();
  });
});

describe("excluirTarja", () => {
  it("apaga filtrando por id e webinar_id e registra auditoria com o antes", async () => {
    const antes = { texto: "Não saia", aparece_seg: 2, duracao_seg: 15, posicao: "topo", cor: "vermelho", ligada: true };
    const banco = bancoFalso({ tarjas_aviso: { unico: antes } });
    dbUsuario.mockResolvedValue({ from: banco.from });
    const { excluirTarja } = await import("../app/(painel)/webinars/[id]/video/actions");

    await excluirTarja("web-1", form({ id: "t-1" }));

    const [exclusao] = banco.com("tarjas_aviso", "delete");
    expect(exclusao).toEqual([
      { metodo: "delete", args: [] },
      { metodo: "eq", args: ["id", "t-1"] },
      { metodo: "eq", args: ["webinar_id", "web-1"] },
    ]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "excluiu", antes }));
  });

  it("sem id: não faz nada", async () => {
    const { excluirTarja } = await import("../app/(painel)/webinars/[id]/video/actions");
    await excluirTarja("web-1", form({}));
    expect(dbUsuario).not.toHaveBeenCalled();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});
