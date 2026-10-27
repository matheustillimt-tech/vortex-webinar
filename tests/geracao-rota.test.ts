import { beforeEach, describe, expect, it, vi } from "vitest";

const membroApi = vi.fn();
const dbUsuario = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({
  membroApi: (...a: unknown[]) => membroApi(...a),
  dbUsuario: (...a: unknown[]) => dbUsuario(...a),
}));

const ADMIN = { id: "m-1", nome: "Ana", papel: "admin" as const };
const COLABORADOR = { id: "m-2", nome: "Bia", papel: "colaborador" as const };
const WEB = "w1";

function chain(resultado: unknown, selectSpy?: (campos: string) => void) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["eq", "order", "limit"]) {
    p[m] = (...args: unknown[]) => {
      void args;
      return p;
    };
  }
  p.maybeSingle = () => Promise.resolve(resultado);
  return { select: (campos: string) => (selectSpy?.(campos), p) };
}

async function chamar(id = WEB) {
  const { GET } = await import("../app/api/webinars/[id]/geracao/route");
  return GET(new Request(`http://x/api/webinars/${id}/geracao`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.resetModules();
  membroApi.mockReset();
  dbUsuario.mockReset();
});

describe("GET /api/webinars/[id]/geracao", () => {
  it("não logado ou não admin: 403, não consulta nada", async () => {
    membroApi.mockResolvedValue(COLABORADOR);
    const from = vi.fn();
    dbUsuario.mockResolvedValue({ from });
    const res = await chamar();
    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it("sem nenhuma geração ainda: geracao null", async () => {
    membroApi.mockResolvedValue(ADMIN);
    const from = vi.fn(() => chain({ data: null }));
    dbUsuario.mockResolvedValue({ from });
    const res = await chamar();
    await expect(res.json()).resolves.toEqual({ geracao: null });
  });

  it("nunca busca a coluna 'blocos' (só total_blocos) e devolve o andamento", async () => {
    membroApi.mockResolvedValue(ADMIN);
    let camposPedidos = "";
    const from = vi.fn(() =>
      chain(
        { data: { status: "gerando", bloco_atual: 2, total_blocos: 5, mensagens_geradas: 10, erro: null } },
        (campos) => (camposPedidos = campos),
      ),
    );
    dbUsuario.mockResolvedValue({ from });
    const res = await chamar();
    const corpo = await res.json();
    expect(corpo).toEqual({ geracao: { status: "gerando", blocoAtual: 2, totalBlocos: 5, mensagensGeradas: 10, erro: null } });
    expect(camposPedidos).toBe("status, bloco_atual, total_blocos, mensagens_geradas, erro");
  });
});
