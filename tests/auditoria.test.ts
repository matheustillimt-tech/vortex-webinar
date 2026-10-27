import { beforeEach, describe, expect, it, vi } from "vitest";
import { camposAlterados, filtrosHistorico, limparParaAuditoria } from "@/src/lib/regras/auditoria";

const dbAdmin = vi.fn();
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));

beforeEach(() => {
  dbAdmin.mockReset();
});

describe("limparParaAuditoria", () => {
  it("troca campos sensíveis por '[removido]' sem remover a chave", () => {
    const limpo = limparParaAuditoria({
      nome: "Ana",
      senha: "123456",
      password: "abc",
      token: "tok",
      headers_enc: "enc",
      segredo_enc: "enc2",
      segredo: "xyz",
      api_key: "key",
      apiKey: "key2",
    });
    expect(limpo).toEqual({
      nome: "Ana",
      senha: "[removido]",
      password: "[removido]",
      token: "[removido]",
      headers_enc: "[removido]",
      segredo_enc: "[removido]",
      segredo: "[removido]",
      api_key: "[removido]",
      apiKey: "[removido]",
    });
  });

  it("script_personalizado é a única exceção: fica 'alterado', não '[removido]'", () => {
    expect(limparParaAuditoria({ script_personalizado: "<script>" })).toEqual({ script_personalizado: "alterado" });
  });

  it("casa por substring da chave, não só o nome exato (ex.: 'nova_senha', 'authToken')", () => {
    const limpo = limparParaAuditoria({ nova_senha: "123", authToken: "tok", outro_segredo_aqui: "x" });
    expect(limpo).toEqual({ nova_senha: "[removido]", authToken: "[removido]", outro_segredo_aqui: "[removido]" });
  });

  it("é recursivo: objeto aninhado também passa pela mesma regra", () => {
    const limpo = limparParaAuditoria({ nome: "Ana", config: { token: "tok", nivel: 1 } });
    expect(limpo).toEqual({ nome: "Ana", config: { token: "[removido]", nivel: 1 } });
  });

  it("recursivo em listas de objetos (chave sensível dentro de item da lista)", () => {
    const limpo = limparParaAuditoria({ linhas: [{ chave: "X-Custom", token: "abc" }, { chave: "X-Outro", valor: "ok" }] });
    expect(limpo).toEqual({ linhas: [{ chave: "X-Custom", token: "[removido]" }, { chave: "X-Outro", valor: "ok" }] });
  });

  it("corta valores de texto com mais de 2000 caracteres", () => {
    const longo = "a".repeat(2500);
    const limpo = limparParaAuditoria({ corpo: longo });
    expect((limpo!.corpo as string).length).toBe(2001); // 2000 + "…"
    expect((limpo!.corpo as string).startsWith("a".repeat(2000))).toBe(true);
  });

  it("deixa null/undefined passar direto", () => {
    expect(limparParaAuditoria(null)).toBeNull();
    expect(limparParaAuditoria(undefined)).toBeUndefined();
  });

  it("não sensível e curto passa sem mudança", () => {
    expect(limparParaAuditoria({ nome: "Bia", ativo: true, numero: 5 })).toEqual({ nome: "Bia", ativo: true, numero: 5 });
  });
});

describe("filtrosHistorico", () => {
  it("sem nada: ação 'todas', busca vazia, página 1", () => {
    expect(filtrosHistorico({})).toEqual({ acao: "todas", busca: "", de: "", ate: "", pagina: 1 });
  });

  it("aceita uma ação válida e corta espaços da busca", () => {
    expect(filtrosHistorico({ acao: "editou", busca: "  oferta  " })).toEqual({
      acao: "editou",
      busca: "oferta",
      de: "",
      ate: "",
      pagina: 1,
    });
  });

  it("ação desconhecida cai no padrão 'todas'", () => {
    expect(filtrosHistorico({ acao: "banana" }).acao).toBe("todas");
  });

  it("página: número > 1 é aceito; valor inválido ou <= 1 vira 1", () => {
    expect(filtrosHistorico({ pagina: "3" }).pagina).toBe(3);
    expect(filtrosHistorico({ pagina: "0" }).pagina).toBe(1);
    expect(filtrosHistorico({ pagina: "abc" }).pagina).toBe(1);
  });

  it("usa só o primeiro valor quando o parâmetro vem repetido", () => {
    expect(filtrosHistorico({ acao: ["criou", "excluiu"] }).acao).toBe("criou");
  });
});

describe("camposAlterados", () => {
  it("lista só os campos que mudaram", () => {
    expect(camposAlterados({ preco: 100, nome: "A" }, { preco: 200, nome: "A" })).toEqual([{ campo: "preco", antes: 100, depois: 200 }]);
  });

  it("campo presente só em um dos lados conta como alterado", () => {
    expect(camposAlterados({ a: 1 }, { a: 1, b: 2 })).toEqual([{ campo: "b", antes: undefined, depois: 2 }]);
  });

  it("antes/depois nulos: nenhum campo alterado", () => {
    expect(camposAlterados(null, null)).toEqual([]);
  });

  it("nada mudou: lista vazia", () => {
    expect(camposAlterados({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual([]);
  });
});

describe("registrarAuditoria", () => {
  it("grava a linha com antes/depois limpos", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const from = vi.fn(() => ({ insert }));
    dbAdmin.mockReturnValue({ from });

    const { registrarAuditoria } = await import("@/src/lib/auditoria");
    await registrarAuditoria({
      usuarioId: "u1",
      webinarId: "w1",
      acao: "editou",
      descricao: "Editou a oferta",
      antes: { preco: 100, token: "segredo" },
      depois: { preco: 200, token: "novo-segredo" },
    });

    expect(from).toHaveBeenCalledWith("auditoria");
    expect(insert).toHaveBeenCalledWith({
      usuario_id: "u1",
      webinar_id: "w1",
      acao: "editou",
      descricao: "Editou a oferta",
      antes: { preco: 100, token: "[removido]" },
      depois: { preco: 200, token: "[removido]" },
    });
  });

  it("sem webinarId, grava webinar_id null", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    dbAdmin.mockReturnValue({ from: vi.fn(() => ({ insert })) });

    const { registrarAuditoria } = await import("@/src/lib/auditoria");
    await registrarAuditoria({ usuarioId: "u1", acao: "criou", descricao: "Criou a pessoa" });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ webinar_id: null, antes: null, depois: null }),
    );
  });

  it("nunca lança: erro do banco só loga", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: { message: "deu ruim" } }));
    dbAdmin.mockReturnValue({ from: vi.fn(() => ({ insert })) });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { registrarAuditoria } = await import("@/src/lib/auditoria");
    await expect(registrarAuditoria({ usuarioId: "u1", acao: "excluiu", descricao: "Excluiu o vídeo" })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("nunca lança: exceção (ex.: dbAdmin lançou) só loga", async () => {
    dbAdmin.mockImplementation(() => {
      throw new Error("sem env");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { registrarAuditoria } = await import("@/src/lib/auditoria");
    await expect(registrarAuditoria({ usuarioId: "u1", acao: "criou", descricao: "x" })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
