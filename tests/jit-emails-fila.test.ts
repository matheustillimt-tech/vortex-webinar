import { beforeEach, describe, expect, it, vi } from "vitest";

const dbAdmin = vi.fn();
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));

function chain(resultado: unknown) {
  const p: Record<string, unknown> = Promise.resolve(resultado) as unknown as Record<string, unknown>;
  for (const m of ["select", "eq", "maybeSingle"]) p[m] = () => p;
  return p;
}

const JIT = new Date("2026-11-03T23:00:00Z");
const BASE = { sessaoId: "sess-1", webinarId: "web-1", email: "ana@x.com", jitHorario: JIT };

function banco(o: { lembrete?: { minutos_antes: number | null } | null; erroUpsert?: unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: o.erroUpsert ?? null });
  const from = vi.fn((tabela: string) => {
    if (tabela === "emails_jit") return chain({ data: o.lembrete ?? null, error: null });
    if (tabela === "envios_email") return { upsert };
    throw new Error(`tabela inesperada: ${tabela}`);
  });
  dbAdmin.mockReturnValue({ from });
  return { upsert };
}

beforeEach(() => {
  vi.resetModules();
  dbAdmin.mockReset();
});

describe("enfileirarEmailsDaInscricao", () => {
  it("sem modelo salvo: inscrição agora, lembrete 60 min antes e 'começando' no horário, ignorando conflito", async () => {
    const { upsert } = banco();
    const { enfileirarEmailsDaInscricao } = await import("@/src/lib/emails");
    const agora = new Date("2026-11-03T12:00:00Z");
    await expect(enfileirarEmailsDaInscricao({ ...BASE, agora })).resolves.toBe(3);
    expect(upsert).toHaveBeenCalledWith(
      [
        { sessao_id: "sess-1", webinar_id: "web-1", tipo: "inscricao", enviar_em: agora.toISOString() },
        { sessao_id: "sess-1", webinar_id: "web-1", tipo: "lembrete", enviar_em: "2026-11-03T22:00:00.000Z" },
        { sessao_id: "sess-1", webinar_id: "web-1", tipo: "comecando", enviar_em: JIT.toISOString() },
      ],
      { onConflict: "sessao_id,tipo", ignoreDuplicates: true },
    );
  });

  it("usa os minutos_antes do modelo de lembrete", async () => {
    const { upsert } = banco({ lembrete: { minutos_antes: 15 } });
    const { enfileirarEmailsDaInscricao } = await import("@/src/lib/emails");
    await enfileirarEmailsDaInscricao({ ...BASE, agora: new Date("2026-11-03T12:00:00Z") });
    expect(upsert.mock.calls[0][0][1]).toMatchObject({ tipo: "lembrete", enviar_em: "2026-11-03T22:45:00.000Z" });
  });

  it("faltando menos que minutos_antes na inscrição: lembrete pulado", async () => {
    const { upsert } = banco({ lembrete: { minutos_antes: 60 } });
    const { enfileirarEmailsDaInscricao } = await import("@/src/lib/emails");
    await expect(enfileirarEmailsDaInscricao({ ...BASE, agora: new Date("2026-11-03T22:30:00Z") })).resolves.toBe(2);
    expect(upsert.mock.calls[0][0].map((l: { tipo: string }) => l.tipo)).toEqual(["inscricao", "comecando"]);
  });

  it("sem e-mail: não enfileira nada", async () => {
    const { upsert } = banco();
    const { enfileirarEmailsDaInscricao } = await import("@/src/lib/emails");
    await expect(enfileirarEmailsDaInscricao({ ...BASE, email: null, agora: new Date("2026-11-03T12:00:00Z") })).resolves.toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("erro no banco: só loga, nunca lança", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    banco({ erroUpsert: { message: "fora do ar" } });
    const { enfileirarEmailsDaInscricao } = await import("@/src/lib/emails");
    await expect(enfileirarEmailsDaInscricao({ ...BASE, agora: new Date("2026-11-03T12:00:00Z") })).resolves.toBe(0);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
