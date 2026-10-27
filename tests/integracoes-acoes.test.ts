import { beforeEach, describe, expect, it, vi } from "vitest";
import { cifrar, decifrar } from "@/src/lib/crypto";

process.env.CRYPTO_KEY ??= Buffer.alloc(32, 9).toString("base64");

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const revalidatePath = vi.fn();
const enviarTeste = vi.fn();
const registrarAuditoria = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: (...a: unknown[]) => exigirAdmin(...a), dbUsuario: (...a: unknown[]) => dbUsuario(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/src/lib/disparos", () => ({ enviarTeste: (...a: unknown[]) => enviarTeste(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));

function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "insert", "update", "delete", "upsert", "maybeSingle"]) p[m] = () => p;
  return p;
}

function form(campos: Record<string, string>, pares: Record<string, string[]> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  for (const [k, vs] of Object.entries(pares)) for (const v of vs) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.resetModules();
  exigirAdmin.mockReset();
  exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
  dbUsuario.mockReset();
  revalidatePath.mockReset();
  enviarTeste.mockReset();
  registrarAuditoria.mockReset();
});

const CAMPOS_BASICOS = { gatilho: "clicou_oferta", valor_seg: "", url: "https://exemplo.com/webhook", metodo: "POST", corpo: "" };

describe("adicionarRegra", () => {
  it("exige admin antes de tudo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { adicionarRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    await expect(adicionarRegra("web-1", {}, form(CAMPOS_BASICOS))).rejects.toThrow("Só administradores podem fazer isso.");
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("URL privada (loopback) é recusada antes de gravar", async () => {
    const { adicionarRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    const campos = { ...CAMPOS_BASICOS, url: "https://127.0.0.1/x" };
    const r = await adicionarRegra("web-1", {}, form(campos));
    expect(r).toEqual({ erro: "Use um endereço https público.", valores: campos });
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("cifra os headers antes de gravar (nunca em texto puro)", async () => {
    const insert = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "regras") return { insert };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { adicionarRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    const r = await adicionarRegra(
      "web-1",
      {},
      form(CAMPOS_BASICOS, { header_chave: ["Authorization"], header_valor: ["Bearer segredo-xyz"] }),
    );

    expect(r).toEqual({ ok: true });
    const gravado = insert.mock.calls[0][0];
    expect(gravado.webinar_id).toBe("web-1");
    expect(gravado.headers_enc).not.toContain("segredo-xyz");
    expect(JSON.parse(decifrar(gravado.headers_enc))).toEqual([["Authorization", "Bearer segredo-xyz"]]);
    expect(revalidatePath).toHaveBeenCalledWith("/configuracoes/integracoes/web-1");
  });

  it("permaneceu sem tempo válido → erro", async () => {
    const { adicionarRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    const campos = { ...CAMPOS_BASICOS, gatilho: "permaneceu", valor_seg: "" };
    const r = await adicionarRegra("web-1", {}, form(campos));
    expect(r).toEqual({ erro: "Informe o tempo.", valores: campos });
  });
});

describe("editarRegra", () => {
  it("exige admin antes de tudo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { editarRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    await expect(editarRegra("web-1", "regra-1", {}, form(CAMPOS_BASICOS))).rejects.toThrow("Só administradores podem fazer isso.");
  });

  /** Banco com a regra salva com esses headers; devolve o `update` pra conferir o que foi gravado. */
  function regraSalva(headers: [string, string][]) {
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "regras") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: { headers_enc: cifrar(JSON.stringify(headers)) } });
        c.update = update;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });
    return update;
  }

  async function editarComHeaders(chaves: string[], valores: string[], originais: string[]) {
    const { editarRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    return editarRegra("web-1", "regra-1", {}, form(CAMPOS_BASICOS, { header_chave: chaves, header_valor: valores, header_original: originais }));
  }

  it("header com a sentinela mantém o valor antigo da chave original, mesmo renomeando a chave", async () => {
    const update = regraSalva([["X-Antigo", "valor-secreto-1"]]);
    const { SENTINELA_HEADER } = await import("../app/(painel)/configuracoes/integracoes/[id]/sentinela");
    const r = await editarComHeaders(["X-Novo-Nome"], [SENTINELA_HEADER], ["X-Antigo"]);
    expect(r).toEqual({ ok: true });
    expect(JSON.parse(decifrar(update.mock.calls[0][0].headers_enc))).toEqual([["X-Novo-Nome", "valor-secreto-1"]]);
  });

  it("remover a primeira linha não passa o segredo dela pra linha de baixo", async () => {
    const update = regraSalva([
      ["Authorization", "Bearer a"],
      ["X-Api-Key", "chave-b"],
    ]);
    const { SENTINELA_HEADER } = await import("../app/(painel)/configuracoes/integracoes/[id]/sentinela");
    const r = await editarComHeaders(["X-Api-Key"], [SENTINELA_HEADER], ["X-Api-Key"]);
    expect(r).toEqual({ ok: true });
    expect(JSON.parse(decifrar(update.mock.calls[0][0].headers_enc))).toEqual([["X-Api-Key", "chave-b"]]);
  });

  it("reordenar as linhas mantém cada segredo com a sua chave", async () => {
    const update = regraSalva([
      ["A", "segredo-a"],
      ["B", "segredo-b"],
    ]);
    const { SENTINELA_HEADER } = await import("../app/(painel)/configuracoes/integracoes/[id]/sentinela");
    await editarComHeaders(["B", "Nova", "A"], [SENTINELA_HEADER, "valor-novo", SENTINELA_HEADER], ["B", "", "A"]);
    expect(JSON.parse(decifrar(update.mock.calls[0][0].headers_enc))).toEqual([
      ["B", "segredo-b"],
      ["Nova", "valor-novo"],
      ["A", "segredo-a"],
    ]);
  });

  it("sentinela numa linha sem chave original salva: erro, sem gravar (nunca pega o segredo de outra chave)", async () => {
    const update = regraSalva([["A", "segredo-a"]]);
    const { SENTINELA_HEADER } = await import("../app/(painel)/configuracoes/integracoes/[id]/sentinela");
    const r = await editarComHeaders(["B"], [SENTINELA_HEADER], [""]);
    expect(r.erro).toBe("Digite de novo o valor do header B.");
    expect(update).not.toHaveBeenCalled();
  });

  it("regra não encontrada nesse webinar → erro, sem gravar", async () => {
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "regras") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: null });
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { editarRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    const r = await editarRegra("web-1", "regra-inexistente", {}, form(CAMPOS_BASICOS));
    expect(r).toEqual({ erro: "Regra não encontrada.", valores: CAMPOS_BASICOS });
  });

  it("grava antes/depois da regra na auditoria (Revisão final: edição de regra leva antes/depois)", async () => {
    const atual = {
      gatilho: "pitch",
      valor_seg: null,
      url: "https://antigo.exemplo.com/webhook",
      metodo: "POST",
      headers_enc: null,
      params: {},
      corpo: null,
    };
    const update = regraComSelect(atual);

    const { editarRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    const r = await editarRegra("web-1", "regra-1", {}, form({ ...CAMPOS_BASICOS, url: "https://novo.exemplo.com/webhook" }));

    expect(r).toEqual({ ok: true });
    expect(update).toHaveBeenCalled();
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        webinarId: "web-1",
        acao: "editou",
        antes: expect.objectContaining({ url: "https://antigo.exemplo.com/webhook" }),
        depois: expect.objectContaining({ url: "https://novo.exemplo.com/webhook" }),
      }),
    );
  });
});

/** Banco com a regra salva (linha completa); devolve o `update` pra conferir o que foi gravado. */
function regraComSelect(linha: Record<string, unknown>) {
  const update = vi.fn().mockReturnValue(chain({ error: null }));
  const from = vi.fn().mockImplementation((tabela: string) => {
    if (tabela === "regras") {
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

describe("alternarRegra", () => {
  it("grava a auditoria com antes/depois do campo ativa, sem expor segredo nenhum", async () => {
    const update = regraComSelect({ gatilho: "pitch" });

    const { alternarRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    await alternarRegra("web-1", form({ id: "regra-1", ativa: "1" }));

    expect(update).toHaveBeenCalledWith({ ativa: false });
    expect(revalidatePath).toHaveBeenCalledWith("/configuracoes/integracoes/web-1");
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        webinarId: "web-1",
        acao: "editou",
        descricao: expect.stringContaining("pitch"),
        antes: { ativa: true },
        depois: { ativa: false },
      }),
    );
  });

  it("sem id: não faz nada", async () => {
    const from = vi.fn();
    dbUsuario.mockResolvedValue({ from });
    const { alternarRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    await alternarRegra("web-1", form({}));
    expect(from).not.toHaveBeenCalled();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe("salvarRastreamento", () => {
  it("audita só os nomes dos campos alterados — nunca o valor dos pixels/script (Revisão final)", async () => {
    const atualData = { pixel_meta: "111", pixel_tiktok: null, gtm: null, script_personalizado: null };
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: atualData });
        c.update = update;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarRastreamento } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    const r = await salvarRastreamento(
      "web-1",
      {},
      form({ pixel_meta: "222", pixel_tiktok: "", gtm: "", script_personalizado: "<script>roubaSenha()</script>" }),
    );

    expect(r).toEqual({ ok: true });
    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
    const chamada = registrarAuditoria.mock.calls[0][0];
    expect(chamada.antes).toBeUndefined();
    expect(chamada.depois).toBeUndefined();
    expect(chamada.descricao).toContain("pixel_meta");
    expect(chamada.descricao).toContain("script_personalizado");
    expect(chamada.descricao).not.toContain("roubaSenha");
  });
});

describe("salvarCompartilhamento", () => {
  it("grava antes/depois do título/descrição na auditoria", async () => {
    const atualData = { compartilhar_titulo: "Antigo", compartilhar_descricao: "Desc antiga", compartilhar_imagem_url: null };
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: atualData });
        c.update = update;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarCompartilhamento } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    const r = await salvarCompartilhamento("web-1", {}, form({ compartilhar_titulo: "Novo", compartilhar_descricao: "Desc nova" }));

    expect(r).toEqual({ ok: true });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        antes: atualData,
        depois: { compartilhar_titulo: "Novo", compartilhar_descricao: "Desc nova" },
      }),
    );
  });
});

describe("excluirRegra", () => {
  it("exige admin antes de tudo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { excluirRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    await expect(excluirRegra("web-1", form({ id: "regra-1" }))).rejects.toThrow("Só administradores podem fazer isso.");
  });

  it("confere o id e o webinar_id ao excluir", async () => {
    const eq1 = vi.fn();
    const eq2 = vi.fn().mockReturnValue(Promise.resolve({ error: null }));
    eq1.mockReturnValue({ eq: eq2 });
    const del = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "regras") return { delete: del };
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { excluirRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    await excluirRegra("web-1", form({ id: "regra-1" }));

    expect(del).toHaveBeenCalled();
    expect(eq1).toHaveBeenCalledWith("id", "regra-1");
    expect(eq2).toHaveBeenCalledWith("webinar_id", "web-1");
    expect(revalidatePath).toHaveBeenCalledWith("/configuracoes/integracoes/web-1");
  });
});

describe("enviarTesteRegra", () => {
  it("exige admin antes de tudo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { enviarTesteRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    await expect(enviarTesteRegra("web-1", "regra-1")).rejects.toThrow("Só administradores podem fazer isso.");
    expect(enviarTeste).not.toHaveBeenCalled();
  });

  it("confere que a regra é desse webinar antes de disparar o teste", async () => {
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "regras") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: null });
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { enviarTesteRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    const r = await enviarTesteRegra("web-1", "regra-de-outro-webinar");
    expect(r).toEqual({ erro: "Regra não encontrada." });
    expect(enviarTeste).not.toHaveBeenCalled();
  });

  it("regra confirmada → dispara o teste e devolve o resultado", async () => {
    enviarTeste.mockResolvedValue({ status: 200, corpo: "ok" });
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "regras") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: { id: "regra-1" } });
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { enviarTesteRegra } = await import("../app/(painel)/configuracoes/integracoes/[id]/actions");
    const r = await enviarTesteRegra("web-1", "regra-1");
    expect(r).toEqual({ status: 200, corpo: "ok" });
    expect(enviarTeste).toHaveBeenCalledWith("regra-1");
  });
});
