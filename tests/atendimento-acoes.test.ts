import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirMembro = vi.fn();
const dbUsuario = vi.fn();
const dbAdmin = vi.fn();
const enviarImagem = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({
  exigirMembro: (...a: unknown[]) => exigirMembro(...a),
  dbUsuario: (...a: unknown[]) => dbUsuario(...a),
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));
vi.mock("@/src/lib/midias", () => ({ enviarImagem: (...a: unknown[]) => enviarImagem(...a) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const EU = { id: "at-1", nome: "Bruno", papel: "atendente" as const };
const OUTRO = { id: "at-2", nome: "Clara", papel: "atendente" as const };

/** Fábrica de uma chain estilo Supabase: registra cada chamada (`chamadas`) e resolve pro `resultado` dado em
 *  `maybeSingle`/`single`, ou direto (a chain também é um thenable) se o código nunca chama um desses. */
function chain(resultado: unknown, chamadas: { metodo: string; args: unknown[] }[] = []) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "in", "or", "insert", "update", "order", "limit", "gt"]) {
    p[m] = (...args: unknown[]) => {
      chamadas.push({ metodo: m, args });
      return p;
    };
  }
  p.single = () => Promise.resolve(resultado);
  p.maybeSingle = () => Promise.resolve(resultado);
  return p;
}

beforeEach(() => {
  vi.resetModules();
  exigirMembro.mockReset();
  dbUsuario.mockReset();
  dbAdmin.mockReset();
  enviarImagem.mockReset();
  revalidatePath.mockReset();
  exigirMembro.mockResolvedValue(EU);
});

describe("assumir", () => {
  it("sucesso: atualiza atendente_id e status, filtra por id e webinar_id", async () => {
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    const update = vi.fn((valores: unknown) => {
      chamadas.push({ metodo: "update", args: [valores] });
      return chain({ data: { id: "s1" }, error: null }, chamadas);
    });
    dbAdmin.mockReturnValue({ from: () => ({ update }) });

    const { assumir } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await assumir("web-1", "s1");

    expect(r).toEqual({});
    expect(update).toHaveBeenCalledWith({ atendente_id: "at-1", status_atendimento: "atendendo" });
    expect(chamadas.filter((c) => c.metodo === "eq")).toEqual([
      { metodo: "eq", args: ["id", "s1"] },
      { metodo: "eq", args: ["webinar_id", "web-1"] },
    ]);
  });

  it("outro atendente já assumiu: a atualização não acerta nenhuma linha (atômico) → erro", async () => {
    dbAdmin.mockReturnValue({ from: () => ({ update: () => chain({ data: null, error: null }) }) });

    const { assumir } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await assumir("web-1", "s1");

    expect(r).toEqual({ erro: "Outra pessoa da equipe já pegou este atendimento." });
  });

  it("erro do banco: mensagem genérica", async () => {
    dbAdmin.mockReturnValue({ from: () => ({ update: () => chain({ data: null, error: { message: "boom" } }) }) });

    const { assumir } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await assumir("web-1", "s1");

    expect(r).toEqual({ erro: "Não deu para pegar o atendimento." });
  });

  it("não membro: propaga o erro de exigirMembro (sem tocar no banco)", async () => {
    exigirMembro.mockRejectedValue(new Error("Acesso negado."));
    const from = vi.fn();
    dbAdmin.mockReturnValue({ from });

    const { assumir } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    await expect(assumir("web-1", "s1")).rejects.toThrow("Acesso negado.");
    expect(from).not.toHaveBeenCalled();
  });
});

describe("devolverParaIa", () => {
  it("atendente: volta pra IA (sem atendente, aguardando), só a conversa que ele está atendendo", async () => {
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    const update = vi.fn(() => chain({ data: { id: "s1" }, error: null }, chamadas));
    dbAdmin.mockReturnValue({ from: () => ({ update }) });

    const { devolverParaIa } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await devolverParaIa("web-1", "s1");

    expect(r).toEqual({});
    expect(update).toHaveBeenCalledWith({ atendente_id: null, status_atendimento: "aguardando" });
    expect(chamadas).toContainEqual({ metodo: "eq", args: ["status_atendimento", "atendendo"] });
    expect(chamadas).toContainEqual({ metodo: "eq", args: ["atendente_id", "at-1"] });
  });

  it("admin: devolve a de qualquer atendente (sem filtro de atendente_id)", async () => {
    exigirMembro.mockResolvedValue({ ...EU, papel: "admin" });
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    dbAdmin.mockReturnValue({ from: () => ({ update: () => chain({ data: { id: "s1" }, error: null }, chamadas) }) });

    const { devolverParaIa } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    expect(await devolverParaIa("web-1", "s1")).toEqual({});
    expect(chamadas.some((c) => c.metodo === "eq" && c.args[0] === "atendente_id")).toBe(false);
  });

  it("não estou atendendo esta conversa: erro", async () => {
    dbAdmin.mockReturnValue({ from: () => ({ update: () => chain({ data: null, error: null }) }) });

    const { devolverParaIa } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    expect(await devolverParaIa("web-1", "s1")).toEqual({ erro: "Você não está atendendo esta conversa." });
  });
});

describe("responder", () => {
  function form(texto: string) {
    const f = new FormData();
    f.set("texto", texto);
    return f;
  }

  it("texto vazio e sem imagem: erro de validação, nunca toca no banco", async () => {
    const from = vi.fn();
    dbAdmin.mockReturnValue({ from });

    const { responder } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await responder("web-1", "s1", form("   "));

    expect(r).toEqual({ erro: "Escreva uma mensagem ou envie uma imagem." });
    expect(from).not.toHaveBeenCalled();
  });

  it("sessão não encontrada (ou de outro webinar): erro, sem gravar mensagem", async () => {
    const insert = vi.fn();
    dbAdmin.mockReturnValue({
      from: (tabela: string) => {
        if (tabela === "sessoes") return { select: () => chain({ data: null, error: null }) };
        if (tabela === "mensagens_suporte") return { insert };
        throw new Error("tabela inesperada: " + tabela);
      },
    });

    const { responder } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await responder("web-1", "s1", form("Oi"));

    expect(r).toEqual({ erro: "Conversa não encontrada." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("outro atendente já está atendendo: recusa, sem gravar mensagem", async () => {
    const insert = vi.fn();
    dbAdmin.mockReturnValue({
      from: (tabela: string) => {
        if (tabela === "sessoes") {
          return {
            select: () =>
              chain({
                data: { id: "s1", webinar_id: "web-1", atendente_id: OUTRO.id, status_atendimento: "atendendo" },
                error: null,
              }),
          };
        }
        if (tabela === "mensagens_suporte") return { insert };
        throw new Error("tabela inesperada: " + tabela);
      },
    });

    const { responder } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await responder("web-1", "s1", form("Oi"));

    expect(r).toEqual({ erro: "Outro atendente está atendendo esta conversa." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("ninguém atende ainda: assume automaticamente e grava a mensagem", async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });
    let chamadaUpdate = 0;
    dbAdmin.mockReturnValue({
      from: (tabela: string) => {
        if (tabela === "sessoes") {
          return {
            select: () => chain({ data: { id: "s1", webinar_id: "web-1", atendente_id: null, status_atendimento: "aguardando" }, error: null }),
            update: (valores: unknown) => {
              chamadaUpdate++;
              expect(valores).toEqual({ atendente_id: "at-1", status_atendimento: "atendendo" });
              return chain({ data: { id: "s1" }, error: null });
            },
          };
        }
        if (tabela === "mensagens_suporte") return { insert };
        throw new Error("tabela inesperada: " + tabela);
      },
    });

    const { responder } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await responder("web-1", "s1", form("Oi, como posso ajudar?"));

    expect(r).toEqual({});
    expect(chamadaUpdate).toBe(1);
    expect(insert).toHaveBeenCalledWith({
      sessao_id: "s1",
      webinar_id: "web-1",
      autor: "atendente",
      autor_id: "at-1",
      texto: "Oi, como posso ajudar?",
      imagem_url: null,
    });
  });

  it("eu já sou o atendente: grava sem precisar reassumir (a atualização idempotente também acerta a linha)", async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });
    dbAdmin.mockReturnValue({
      from: (tabela: string) => {
        if (tabela === "sessoes") {
          return {
            select: () => chain({ data: { id: "s1", webinar_id: "web-1", atendente_id: "at-1", status_atendimento: "atendendo" }, error: null }),
            update: () => chain({ data: { id: "s1" }, error: null }),
          };
        }
        if (tabela === "mensagens_suporte") return { insert };
        throw new Error("tabela inesperada: " + tabela);
      },
    });

    const { responder } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await responder("web-1", "s1", form("Mais uma mensagem"));

    expect(r).toEqual({});
    expect(insert).toHaveBeenCalled();
  });

  it("corrida entre a confirmação e o envio: a atualização de assumir não acerta linha → recusa", async () => {
    const insert = vi.fn();
    dbAdmin.mockReturnValue({
      from: (tabela: string) => {
        if (tabela === "sessoes") {
          return {
            select: () => chain({ data: { id: "s1", webinar_id: "web-1", atendente_id: null, status_atendimento: "aguardando" }, error: null }),
            update: () => chain({ data: null, error: null }),
          };
        }
        if (tabela === "mensagens_suporte") return { insert };
        throw new Error("tabela inesperada: " + tabela);
      },
    });

    const { responder } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await responder("web-1", "s1", form("Oi"));

    expect(r).toEqual({ erro: "Outro atendente está atendendo esta conversa." });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("responder com imagem", () => {
  function formComImagem() {
    const f = new FormData();
    f.set("texto", "");
    f.set("imagem", new File([new Uint8Array(10)], "a.png", { type: "image/png" }));
    return f;
  }

  it("outro atendente assumiu (o update atômico não acerta linha): recusa ANTES de subir a imagem", async () => {
    const insert = vi.fn();
    dbAdmin.mockReturnValue({
      from: (tabela: string) => {
        if (tabela === "sessoes") {
          return {
            select: () => chain({ data: { id: "s1", webinar_id: "web-1", atendente_id: null, status_atendimento: "aguardando" }, error: null }),
            update: () => chain({ data: null, error: null }),
          };
        }
        if (tabela === "mensagens_suporte") return { insert };
        throw new Error("tabela inesperada: " + tabela);
      },
    });

    const { responder } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await responder("web-1", "s1", formComImagem());

    expect(r).toEqual({ erro: "Outro atendente está atendendo esta conversa." });
    expect(enviarImagem).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("assumiu: sobe a imagem na pasta chat e grava a url", async () => {
    const ordem: string[] = [];
    enviarImagem.mockImplementation(async () => {
      ordem.push("upload");
      return { url: "https://proj.supabase.co/x.png" };
    });
    const insert = vi.fn(async () => {
      ordem.push("insert");
      return { data: null, error: null };
    });
    dbAdmin.mockReturnValue({
      from: (tabela: string) => {
        if (tabela === "sessoes") {
          return {
            select: () => chain({ data: { id: "s1", webinar_id: "web-1", atendente_id: null, status_atendimento: "aguardando" }, error: null }),
            update: () => {
              ordem.push("assumir");
              return chain({ data: { id: "s1" }, error: null });
            },
          };
        }
        if (tabela === "mensagens_suporte") return { insert };
        throw new Error("tabela inesperada: " + tabela);
      },
    });

    const { responder } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await responder("web-1", "s1", formComImagem());

    expect(r).toEqual({});
    expect(ordem).toEqual(["assumir", "upload", "insert"]);
    expect(enviarImagem).toHaveBeenCalledWith("web-1", expect.any(File), "chat");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ texto: null, imagem_url: "https://proj.supabase.co/x.png" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("editarMensagem", () => {
  it("texto vazio: erro de validação, nunca toca no banco", async () => {
    const from = vi.fn();
    dbAdmin.mockReturnValue({ from });

    const { editarMensagem } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await editarMensagem("m1", "   ");

    expect(r).toEqual({ erro: "Escreva uma mensagem." });
    expect(from).not.toHaveBeenCalled();
  });

  it("texto com mais de 1000 caracteres: erro", async () => {
    const { editarMensagem } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await editarMensagem("m1", "a".repeat(1001));
    expect(r).toEqual({ erro: "A mensagem passa de 1000 caracteres." });
  });

  it("sucesso: filtra autor = atendente e autor_id = eu", async () => {
    const chamadas: { metodo: string; args: unknown[] }[] = [];
    const update = vi.fn((valores: unknown) => {
      chamadas.push({ metodo: "update", args: [valores] });
      return chain({ data: { id: "m1", webinar_id: "web-1" }, error: null }, chamadas);
    });
    dbAdmin.mockReturnValue({ from: () => ({ update }) });

    const { editarMensagem } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await editarMensagem("m1", "Texto novo");

    expect(r).toEqual({});
    expect(update).toHaveBeenCalledWith({ texto: "Texto novo", editada: true });
    expect(chamadas.filter((c) => c.metodo === "eq")).toEqual([
      { metodo: "eq", args: ["id", "m1"] },
      { metodo: "eq", args: ["autor", "atendente"] },
      { metodo: "eq", args: ["autor_id", "at-1"] },
    ]);
  });

  it("mensagem de outro atendente (ou do participante/chatbot/ia): a atualização não acerta nenhuma linha → erro", async () => {
    dbAdmin.mockReturnValue({ from: () => ({ update: () => chain({ data: null, error: null }) }) });

    const { editarMensagem } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await editarMensagem("m1", "Texto novo");

    expect(r).toEqual({ erro: "Você só pode editar as próprias mensagens." });
  });
});

describe("apagarMensagem", () => {
  it("sucesso: apaga (soft delete) só a própria mensagem", async () => {
    const update = vi.fn(() => chain({ data: { id: "m1", webinar_id: "web-1" }, error: null }));
    dbAdmin.mockReturnValue({ from: () => ({ update }) });

    const { apagarMensagem } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await apagarMensagem("m1");

    expect(r).toEqual({});
    // Só marca apagada: texto/imagem ficam no banco (auditoria; o check exige um dos dois) e toda leitura esconde.
    expect(update).toHaveBeenCalledWith({ apagada: true });
  });

  it("mensagem de outro: erro", async () => {
    dbAdmin.mockReturnValue({ from: () => ({ update: () => chain({ data: null, error: null }) }) });

    const { apagarMensagem } = await import("../app/(painel)/atendimento/[webinarId]/actions");
    const r = await apagarMensagem("m1");

    expect(r).toEqual({ erro: "Você só pode apagar as próprias mensagens." });
  });
});
