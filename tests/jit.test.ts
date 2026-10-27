import { describe, expect, it } from "vitest";
import { proximosHorariosJit, type ConfigJit, type HorarioJit } from "@/src/lib/regras/jit";

const cfg: ConfigJit = { fuso: "America/Sao_Paulo", esconderDe: null, esconderAte: null, fim: null, exibicao: "todos" };
const h = (p: Partial<HorarioJit>): HorarioJit => ({ quando: "todo_dia", hora: null, intervaloMin: null, data: null, diaSemana: null, ...p });
const isos = (l: Date[]) => l.map((d) => d.toISOString());

describe("proximosHorariosJit", () => {
  it("todo dia em dois horários, em ordem", () => {
    const r = proximosHorariosJit([h({ hora: "20:00" }), h({ hora: "10:00" })], cfg, new Date("2026-10-19T14:00:00Z")); // 11:00
    expect(isos(r).slice(0, 3)).toEqual(["2026-10-19T23:00:00.000Z", "2026-10-20T13:00:00.000Z", "2026-10-20T23:00:00.000Z"]);
    expect(r).toHaveLength(10);
  });

  it("a cada 30 minutos, alinhado no relógio", () => {
    const r = proximosHorariosJit([h({ quando: "a_cada", intervaloMin: 30 })], { ...cfg, exibicao: "proximo" }, new Date("2026-10-19T14:10:00Z"));
    expect(isos(r)).toEqual(["2026-10-19T14:30:00.000Z"]);
  });

  it("esconde a madrugada", () => {
    const r = proximosHorariosJit(
      [h({ quando: "a_cada", intervaloMin: 60 })],
      { ...cfg, esconderDe: 0, esconderAte: 6, exibicao: "proximos_3" },
      new Date("2026-10-20T02:30:00Z"), // 23:30 do dia 19
    );
    expect(isos(r)).toEqual(["2026-10-20T09:00:00.000Z", "2026-10-20T10:00:00.000Z", "2026-10-20T11:00:00.000Z"]);
  });

  it("faixa escondida que atravessa a meia-noite", () => {
    const r = proximosHorariosJit(
      [h({ hora: "23:00" }), h({ hora: "21:00" })],
      { ...cfg, esconderDe: 22, esconderAte: 6, exibicao: "proximos_2" },
      new Date("2026-10-19T12:00:00Z"),
    );
    expect(isos(r)).toEqual(["2026-10-20T00:00:00.000Z", "2026-10-21T00:00:00.000Z"]);
  });

  it("dia da semana", () => {
    const r = proximosHorariosJit([h({ quando: "dia_semana", diaSemana: 3, hora: "19:00" })], { ...cfg, exibicao: "proximo" }, new Date("2026-10-19T12:00:00Z"));
    expect(isos(r)).toEqual(["2026-10-21T22:00:00.000Z"]); // quarta
  });

  it("data escolhida no passado é ignorada; no futuro aparece", () => {
    const r = proximosHorariosJit(
      [h({ quando: "data", data: new Date("2026-10-18T22:00:00Z") }), h({ quando: "data", data: new Date("2026-10-22T22:00:00Z") })],
      cfg,
      new Date("2026-10-19T12:00:00Z"),
    );
    expect(isos(r)).toEqual(["2026-10-22T22:00:00.000Z"]);
  });

  it("nada depois da data final", () => {
    const r = proximosHorariosJit([h({ hora: "20:00" })], { ...cfg, fim: new Date("2026-10-20T12:00:00Z") }, new Date("2026-10-19T12:00:00Z"));
    expect(isos(r)).toEqual(["2026-10-19T23:00:00.000Z"]);
  });

  it("fuso do participante", () => {
    const r = proximosHorariosJit([h({ hora: "20:00" })], { ...cfg, fuso: "participante", exibicao: "proximo" }, new Date("2026-10-19T12:00:00Z"), "Europe/Lisbon");
    expect(isos(r)).toEqual(["2026-10-19T19:00:00.000Z"]);
  });

  it("fuso do participante inválido ou ausente cai pra América/São Paulo", () => {
    const esperado = proximosHorariosJit([h({ hora: "20:00" })], { ...cfg, fuso: "participante", exibicao: "proximo" }, new Date("2026-10-19T12:00:00Z"), "America/Sao_Paulo");
    const invalido = proximosHorariosJit([h({ hora: "20:00" })], { ...cfg, fuso: "participante", exibicao: "proximo" }, new Date("2026-10-19T12:00:00Z"), "Mars/Olympus");
    const ausente = proximosHorariosJit([h({ hora: "20:00" })], { ...cfg, fuso: "participante", exibicao: "proximo" }, new Date("2026-10-19T12:00:00Z"), "");
    expect(isos(invalido)).toEqual(isos(esperado));
    expect(isos(ausente)).toEqual(isos(esperado));
  });

  it("horários repetidos aparecem uma vez", () => {
    const r = proximosHorariosJit([h({ hora: "20:00" }), h({ quando: "a_cada", intervaloMin: 60 })], { ...cfg, exibicao: "todos" }, new Date("2026-10-19T22:30:00Z"));
    expect(new Set(isos(r)).size).toBe(r.length);
  });

  it("a cada 45 minutos: horários estáveis ao longo do dia, ancorados na meia-noite local", () => {
    const r1 = proximosHorariosJit([h({ quando: "a_cada", intervaloMin: 45 })], cfg, new Date("2026-10-19T17:10:00Z")); // 14:10 BRT
    const r2 = proximosHorariosJit([h({ quando: "a_cada", intervaloMin: 45 })], cfg, new Date("2026-10-19T18:10:00Z")); // 15:10 BRT
    // 00:00 + k·45min: k=21 → 15:45 BRT (18:45Z); k=22 → 16:30 BRT (19:30Z)
    expect(isos(r1)).toContain("2026-10-19T19:30:00.000Z");
    expect(isos(r2)).toContain("2026-10-19T19:30:00.000Z");
    expect(isos(r2)[0]).toBe("2026-10-19T18:45:00.000Z");
  });

  it("intervaloMin negativo não trava e não devolve nada", () => {
    const r = proximosHorariosJit([h({ quando: "a_cada", intervaloMin: -15 })], cfg, new Date("2026-10-19T14:00:00Z"));
    expect(r).toEqual([]);
  });
});
