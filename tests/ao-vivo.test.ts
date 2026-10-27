import { beforeEach, describe, expect, it, vi } from "vitest";

const membroApi = vi.fn();
const dbAdmin = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({ membroApi: (...a: unknown[]) => membroApi(...a) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));

const ADMIN = { id: "m-1", nome: "Ana", papel: "admin" as const };
const WEB = "11111111-1111-1111-1111-111111111111";

type Chamada = { metodo: string; args: unknown[] };

/** Chain estilo Supabase que registra as chamadas: toda chamada intermediária volta o próprio thenable. */
function chain(resultado: unknown, chamadas: Chamada[] = []) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "in", "gt", "gte", "not", "order", "limit", "range"]) {
    p[m] = (...args: unknown[]) => {
      chamadas.push({ metodo: m, args });
      return p;
    };
  }
  p.maybeSingle = () => Promise.resolve(resultado);
  return p;
}

function dbFake(opcoes: {
  fuso?: string | null;
  metricas?: { ao_vivo: number; replay: number; desktop: number; mobile: number } | null;
  erroMetricas?: unknown;
  pontos?: { lat: number; lon: number }[];
  entradas?: { id: string; entrou_em: string }[];
  chamadasPontos?: Chamada[];
  chamadasEntradas?: Chamada[];
}) {
  const rpc = vi.fn(async () => ({
    data: opcoes.erroMetricas ? null : [opcoes.metricas ?? { ao_vivo: 0, replay: 0, desktop: 0, mobile: 0 }],
    error: opcoes.erroMetricas ?? null,
  }));
  const from = (tabela: string) => {
    if (tabela === "agendas") return { select: () => chain({ data: opcoes.fuso ? { fuso: opcoes.fuso } : null, error: null }) };
    if (tabela === "sessoes") {
      return {
        select: (campos: string) => {
          if (campos.includes("entrou_em")) return chain({ data: opcoes.entradas ?? [], error: null }, opcoes.chamadasEntradas);
          return chain({ data: opcoes.pontos ?? [], error: null }, opcoes.chamadasPontos);
        },
      };
    }
    throw new Error("tabela inesperada: " + tabela);
  };
  return { from, rpc };
}

async function chamar(id = WEB) {
  const { GET } = await import("../app/api/painel/ao-vivo/[id]/route");
  return GET(new Request(`http://x/api/painel/ao-vivo/${id}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  membroApi.mockReset();
  dbAdmin.mockReset();
  membroApi.mockResolvedValue(ADMIN);
});

describe("GET /api/painel/ao-vivo/[id]", () => {
  it("sem login: 401 JSON, sem tocar no banco", async () => {
    membroApi.mockResolvedValue(null);
    const from = vi.fn();
    dbAdmin.mockReturnValue({ from });

    const res = await chamar();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erro: "Acesso negado." });
    expect(from).not.toHaveBeenCalled();
  });

  it("números vêm da contagem real no banco (metricas_ao_vivo), não das 500 linhas do mapa", async () => {
    const db = dbFake({
      fuso: "America/Sao_Paulo",
      metricas: { ao_vivo: 1200, replay: 30, desktop: 700, mobile: 530 },
      pontos: [{ lat: -23.5, lon: -46.6 }],
    });
    dbAdmin.mockReturnValue(db);

    const res = await chamar();
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("metricas_ao_vivo", { p_webinar: WEB });
    expect(corpo).toMatchObject({ aoVivo: 1200, replay: 30, desktop: 700, mobile: 530, fuso: "America/Sao_Paulo" });
    expect(corpo.pontos).toEqual([{ lat: -23.5, lon: -46.6 }]);
    expect(typeof corpo.atualizadoEm).toBe("string");
  });

  it("pontos do mapa: só online com geo, sem teste, limitados a 500", async () => {
    const chamadasPontos: Chamada[] = [];
    dbAdmin.mockReturnValue(dbFake({ chamadasPontos }));

    await chamar();

    expect(chamadasPontos).toContainEqual({ metodo: "in", args: ["modo", ["ao_vivo", "replay"]] });
    expect(chamadasPontos).toContainEqual({ metodo: "not", args: ["lat", "is", null] });
    expect(chamadasPontos).toContainEqual({ metodo: "not", args: ["lon", "is", null] });
    expect(chamadasPontos).toContainEqual({ metodo: "limit", args: [500] });
  });

  it("série do dia: conta entradas em buckets de 10 min, sem agenda usa o fuso padrão, e exclui sessões de teste", async () => {
    // Fuso padrão (America/Sao_Paulo, -03:00): meia-noite local = 03:00 UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T13:03:00.000Z"));
    const chamadasEntradas: Chamada[] = [];
    dbAdmin.mockReturnValue(
      dbFake({
        fuso: null,
        chamadasEntradas,
        entradas: [
          { id: "1", entrou_em: "2026-10-20T03:05:00.000Z" },
          { id: "2", entrou_em: "2026-10-20T03:07:00.000Z" },
          { id: "3", entrou_em: "2026-10-20T03:21:00.000Z" },
        ],
      }),
    );

    const corpo = await (await chamar()).json();

    expect(corpo.fuso).toBe("America/Sao_Paulo");
    expect(corpo.serie[0]).toEqual({ inicio: "2026-10-20T03:00:00.000Z", total: 2 });
    expect(corpo.serie[2].total).toBe(1);
    expect(chamadasEntradas).toContainEqual({ metodo: "in", args: ["modo", ["ao_vivo", "replay"]] });
  });

  it("fuso inválido na agenda: cai no America/Sao_Paulo (não quebra a rota)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T13:03:00.000Z"));
    dbAdmin.mockReturnValue(dbFake({ fuso: "Marte/Olympus" }));

    const res = await chamar();
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(corpo.fuso).toBe("America/Sao_Paulo");
    expect(corpo.serie[0].inicio).toBe("2026-10-20T03:00:00.000Z");
  });

  it("erro do banco nas métricas: 500 JSON", async () => {
    dbAdmin.mockReturnValue(dbFake({ erroMetricas: { message: "boom" } }));
    const res = await chamar();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ erro: "Não deu para carregar as métricas." });
  });

  it("id inválido: 400", async () => {
    dbAdmin.mockReturnValue(dbFake({}));
    expect((await chamar("nao-e-uuid")).status).toBe(400);
  });
});
