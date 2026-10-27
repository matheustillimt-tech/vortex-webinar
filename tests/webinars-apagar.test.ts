import { describe, expect, it, vi } from "vitest";
import { apagarWebinarDeVez } from "@/src/lib/webinars-apagar";

const ID = "aaaaaaaa-0000-4000-8000-0000000000aa";

type Cenario = {
  webinar?: { id: string; nome: string; status: string } | null;
  variacoes?: { testes_ab: { nome: string } | null }[];
  /** Pasta → itens (pasta é item com `id: null`). */
  storage?: Record<string, { name: string; id: string | null }[]>;
  erroRemover?: boolean;
  erroDelete?: boolean;
};

function dbFalso(c: Cenario) {
  const deletes: string[] = [];
  const removidos: string[][] = [];

  function chain(resultado: unknown, aoDeletar?: () => void) {
    const p: any = Promise.resolve(resultado);
    for (const m of ["select", "eq"]) p[m] = () => p;
    p.maybeSingle = () => Promise.resolve(resultado);
    p.delete = () => {
      aoDeletar?.();
      return chain({ error: c.erroDelete ? { message: "x" } : null });
    };
    return p;
  }

  const db = {
    from: (tabela: string) => {
      if (tabela === "webinars") return chain({ data: c.webinar ?? null }, () => deletes.push("webinars"));
      if (tabela === "testes_ab_variacoes") return chain({ data: c.variacoes ?? [] });
      throw new Error(`tabela inesperada: ${tabela}`);
    },
    storage: {
      from: () => ({
        list: vi.fn(async (pasta: string) => ({ data: c.storage?.[pasta] ?? [], error: null })),
        remove: vi.fn(async (caminhos: string[]) => {
          removidos.push(caminhos);
          return { error: c.erroRemover ? { message: "falhou" } : null };
        }),
      }),
    },
  };
  return { db: db as never, deletes, removidos };
}

const ARQUIVADO = { id: ID, nome: "TESTE sala", status: "arquivado" };

describe("apagarWebinarDeVez", () => {
  it("arquivado: apaga as imagens (descendo nas subpastas) e depois a linha do webinar", async () => {
    const { db, deletes, removidos } = dbFalso({
      webinar: ARQUIVADO,
      storage: {
        [`webinars/${ID}`]: [
          { name: "logo.png", id: "a" },
          { name: "chat", id: null },
        ],
        [`webinars/${ID}/chat`]: [{ name: "foto.jpg", id: "b" }],
      },
    });
    const r = await apagarWebinarDeVez(ID, { db });
    expect(r).toEqual({ nome: "TESTE sala" });
    expect(removidos).toEqual([[`webinars/${ID}/logo.png`, `webinars/${ID}/chat/foto.jpg`]]);
    expect(deletes).toEqual(["webinars"]);
  });

  it("sem imagens: só apaga a linha", async () => {
    const { db, deletes, removidos } = dbFalso({ webinar: ARQUIVADO });
    expect(await apagarWebinarDeVez(ID, { db })).toEqual({ nome: "TESTE sala" });
    expect(removidos).toEqual([]);
    expect(deletes).toEqual(["webinars"]);
  });

  it("ativo: não apaga nada, pede pra arquivar antes", async () => {
    const { db, deletes } = dbFalso({ webinar: { ...ARQUIVADO, status: "ativo" } });
    expect(await apagarWebinarDeVez(ID, { db })).toEqual({ erro: "Arquive o webinar antes de apagar." });
    expect(deletes).toEqual([]);
  });

  it("variação de teste A/B: não apaga, diz qual teste", async () => {
    const { db, deletes } = dbFalso({ webinar: ARQUIVADO, variacoes: [{ testes_ab: { nome: "Headline" } }] });
    expect(await apagarWebinarDeVez(ID, { db })).toEqual({ erro: "Este webinar está no teste A/B “Headline”. Tire ele do teste antes de apagar." });
    expect(deletes).toEqual([]);
  });

  it("falha no Storage: não apaga a linha (dá pra tentar de novo)", async () => {
    const { db, deletes } = dbFalso({ webinar: ARQUIVADO, storage: { [`webinars/${ID}`]: [{ name: "logo.png", id: "a" }] }, erroRemover: true });
    const r = await apagarWebinarDeVez(ID, { db });
    expect(r).toEqual({ erro: "Não deu para apagar as imagens do webinar. Nada foi apagado; tente de novo." });
    expect(deletes).toEqual([]);
  });

  it("id inválido ou webinar que não existe: não encontrado", async () => {
    expect(await apagarWebinarDeVez("x", { db: dbFalso({}).db })).toEqual({ erro: "Webinar não encontrado." });
    expect(await apagarWebinarDeVez(ID, { db: dbFalso({ webinar: null }).db })).toEqual({ erro: "Webinar não encontrado." });
  });
});
