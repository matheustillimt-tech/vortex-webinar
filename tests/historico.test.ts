import { describe, expect, it, vi } from "vitest";
import { buscarHistorico } from "@/src/lib/historico";
import type { FiltrosHistorico } from "@/src/lib/regras/auditoria";

/** Chain estilo Supabase que registra cada método chamado e resolve `.range()` pro `resultado` dado. */
function chainMock(resultado: unknown) {
  const chamadas: { metodo: string; args: unknown[] }[] = [];
  const q: any = {};
  for (const m of ["select", "eq", "ilike", "order", "gte", "lt"]) {
    q[m] = (...args: unknown[]) => {
      chamadas.push({ metodo: m, args });
      return q;
    };
  }
  q.range = () => Promise.resolve(resultado);
  return { q, chamadas };
}

function dbMock(resultado: unknown) {
  const { q, chamadas } = chainMock(resultado);
  const from = vi.fn(() => q);
  return { db: { from } as any, chamadas, from };
}

function filtros(over: Partial<FiltrosHistorico> = {}): FiltrosHistorico {
  return { acao: "todas", busca: "", de: "", ate: "", pagina: 1, ...over };
}

describe("buscarHistorico — filtro de data", () => {
  it("sem de/ate: não aplica limite nenhum de data (nada de período padrão)", async () => {
    const { db, chamadas } = dbMock({ data: [], count: 0, error: null });
    const r = await buscarHistorico(db, filtros());
    expect(chamadas.some((c) => c.metodo === "gte")).toBe(false);
    expect(chamadas.some((c) => c.metodo === "lt")).toBe(false);
    expect(r.erro).toBeUndefined();
  });

  it("de == ate: filtra o dia inteiro em Brasília (meia-noite local, não UTC)", async () => {
    const { db, chamadas } = dbMock({ data: [], count: 0, error: null });
    await buscarHistorico(db, filtros({ de: "2026-10-20", ate: "2026-10-20" }));
    const gte = chamadas.find((c) => c.metodo === "gte")!;
    const lt = chamadas.find((c) => c.metodo === "lt")!;
    // Meia-noite de 20/10 em Brasília (UTC-3) = 03:00 UTC; "até" é exclusivo = meia-noite do dia seguinte.
    expect(gte.args).toEqual(["created_at", "2026-10-20T03:00:00.000Z"]);
    expect(lt.args).toEqual(["created_at", "2026-10-21T03:00:00.000Z"]);
  });

  it("data inválida: erro em vez de bater no banco (lista vazia explicada, não escondida)", async () => {
    const { db, from } = dbMock({ data: [], count: 0, error: null });
    const r = await buscarHistorico(db, filtros({ de: "não-é-data", ate: "2026-10-20" }));
    expect(r).toEqual({ linhas: [], total: 0, erro: "Data inválida." });
    expect(from).not.toHaveBeenCalled();
  });

  it("só uma das duas datas: erro pedindo as duas", async () => {
    const { db, from } = dbMock({ data: [], count: 0, error: null });
    const r = await buscarHistorico(db, filtros({ de: "2026-10-20", ate: "" }));
    expect(r).toEqual({ linhas: [], total: 0, erro: "Informe as duas datas do período." });
    expect(from).not.toHaveBeenCalled();
  });

  it("data final antes da inicial: erro", async () => {
    const { db } = dbMock({ data: [], count: 0, error: null });
    const r = await buscarHistorico(db, filtros({ de: "2026-10-20", ate: "2026-10-10" }));
    expect(r.erro).toBe("A data final não pode vir antes da inicial.");
  });
});

describe("buscarHistorico — erro de consulta", () => {
  it("erro do banco: devolve erro, lista vazia (nunca esconde atrás de uma tabela sem linhas)", async () => {
    const { db } = dbMock({ data: null, count: null, error: { message: "conexão caiu" } });
    const r = await buscarHistorico(db, filtros());
    expect(r).toEqual({ linhas: [], total: 0, erro: "Não deu para carregar o histórico. Tente de novo." });
  });
});

describe("buscarHistorico — montagem das linhas", () => {
  it("sem erro: monta linhas e total a partir dos dados", async () => {
    const linhaBanco = {
      id: "1",
      criado_em: "2026-10-20T10:00:00Z",
      acao: "criou",
      descricao: "Criou o webinar",
      antes: null,
      depois: null,
      usuarios: { nome: "Ana" },
      webinars: { nome: "Aula de vendas" },
    };
    const { db } = dbMock({ data: [linhaBanco], count: 1, error: null });
    const r = await buscarHistorico(db, filtros());
    expect(r).toEqual({
      linhas: [
        {
          id: "1",
          criado_em: "2026-10-20T10:00:00Z",
          acao: "criou",
          descricao: "Criou o webinar",
          antes: null,
          depois: null,
          usuario_nome: "Ana",
          webinar_nome: "Aula de vendas",
        },
      ],
      total: 1,
    });
  });

  it("com webinarId: filtra por webinar_id", async () => {
    const { db, chamadas } = dbMock({ data: [], count: 0, error: null });
    await buscarHistorico(db, filtros(), "w1");
    expect(chamadas).toContainEqual({ metodo: "eq", args: ["webinar_id", "w1"] });
  });
});
