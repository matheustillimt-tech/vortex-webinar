import { describe, expect, it } from "vitest";
import { agendaDeLinha, estadoSala, proximasSessoes, type Agenda } from "@/src/lib/regras/agenda";

const base: Agenda = { fuso: "America/Sao_Paulo", inicio: null, fim: null, repeticao: "diaria", diaSemana: null, horaInicio: "19:00", horaFim: "23:59", vigenciaFim: null };
const iso = (d: Date | undefined) => d?.toISOString();

describe("estadoSala: diária", () => {
  it("antes do horário fica em espera pela sessão de hoje", () => {
    const r = estadoSala(base, new Date("2026-10-19T20:00:00Z")); // 17:00 em Brasília
    expect(r.estado).toBe("espera");
    expect(iso(r.janela?.inicio)).toBe("2026-10-19T22:00:00.000Z");
    expect(iso(r.janela?.fim)).toBe("2026-10-20T02:59:00.000Z");
  });

  it("dentro do horário está aberta", () => {
    const r = estadoSala(base, new Date("2026-10-19T23:30:00Z")); // 20:30
    expect(r.estado).toBe("aberta");
    expect(iso(r.janela?.inicio)).toBe("2026-10-19T22:00:00.000Z");
  });

  it("depois do horário espera a sessão de amanhã", () => {
    const r = estadoSala(base, new Date("2026-10-20T03:30:00Z")); // 00:30 do dia 20
    expect(r.estado).toBe("espera");
    expect(iso(r.janela?.inicio)).toBe("2026-10-20T22:00:00.000Z");
  });

  it("janela que vira a meia-noite continua aberta na madrugada", () => {
    const a = { ...base, horaInicio: "22:00", horaFim: "02:00" };
    const r = estadoSala(a, new Date("2026-10-20T04:00:00Z")); // 01:00 do dia 20
    expect(r.estado).toBe("aberta");
    expect(iso(r.janela?.inicio)).toBe("2026-10-20T01:00:00.000Z");
    expect(iso(r.janela?.fim)).toBe("2026-10-20T05:00:00.000Z");
  });

  it("vigência encerrada não abre mais", () => {
    const a = { ...base, vigenciaFim: new Date("2026-10-19T12:00:00Z") };
    expect(estadoSala(a, new Date("2026-10-19T20:00:00Z")).estado).toBe("encerrada");
  });

  it("respeita o fuso do webinar", () => {
    const a = { ...base, fuso: "Europe/Lisbon", horaInicio: "19:00", horaFim: "20:00" };
    const r = estadoSala(a, new Date("2026-10-19T17:30:00Z")); // 18:30 em Lisboa
    expect(r.estado).toBe("espera");
    expect(iso(r.janela?.inicio)).toBe("2026-10-19T18:00:00.000Z");
  });
});

describe("estadoSala: semanal", () => {
  it("espera o próximo domingo", () => {
    const a: Agenda = { ...base, repeticao: "semanal", diaSemana: 0, horaInicio: "20:00", horaFim: "22:00" };
    const r = estadoSala(a, new Date("2026-10-19T20:00:00Z")); // segunda
    expect(r.estado).toBe("espera");
    expect(iso(r.janela?.inicio)).toBe("2026-10-25T23:00:00.000Z");
    expect(iso(r.janela?.fim)).toBe("2026-10-26T01:00:00.000Z");
  });
});

describe("estadoSala: sessão única", () => {
  const a: Agenda = { ...base, repeticao: "nenhuma", horaInicio: null, horaFim: null, inicio: new Date("2026-10-20T22:00:00Z"), fim: new Date("2026-10-20T23:30:00Z") };
  it("antes: espera", () => expect(estadoSala(a, new Date("2026-10-20T12:00:00Z")).estado).toBe("espera"));
  it("durante: aberta", () => expect(estadoSala(a, new Date("2026-10-20T22:10:00Z")).estado).toBe("aberta"));
  it("depois: encerrada", () => {
    const r = estadoSala(a, new Date("2026-10-21T00:00:00Z"));
    expect(r).toEqual({ estado: "encerrada", janela: null });
  });
  it("sem datas: encerrada", () => {
    expect(estadoSala({ ...a, inicio: null, fim: null }, new Date()).estado).toBe("encerrada");
  });
});

describe("proximasSessoes", () => {
  it("lista as próximas n sessões diárias, incluindo a que está aberta", () => {
    const r = proximasSessoes(base, new Date("2026-10-19T23:30:00Z"), 3).map((j) => j.inicio.toISOString());
    expect(r).toEqual(["2026-10-19T22:00:00.000Z", "2026-10-20T22:00:00.000Z", "2026-10-21T22:00:00.000Z"]);
  });
  it("sessão única que já passou não aparece", () => {
    const a: Agenda = { ...base, repeticao: "nenhuma", inicio: new Date("2026-10-18T22:00:00Z"), fim: new Date("2026-10-18T23:00:00Z") };
    expect(proximasSessoes(a, new Date("2026-10-19T00:00:00Z"), 3)).toEqual([]);
  });

  it("semanal: sempre devolve as n próximas, em qualquer dia da semana que consultar", () => {
    const a: Agenda = { ...base, repeticao: "semanal", diaSemana: 0, horaInicio: "20:00", horaFim: "22:00" };
    // Segunda 19/10 até domingo 25/10/2026, um dia por vez.
    for (let d = 19; d <= 25; d++) {
      const agora = new Date(`2026-10-${d}T12:00:00Z`);
      const r = proximasSessoes(a, agora, 3);
      expect(r).toHaveLength(3);
      expect(r[1].inicio.getTime() - r[0].inicio.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
      expect(r[2].inicio.getTime() - r[1].inicio.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });

  it("diária: n grande também é atendido (horizonte cresce com n)", () => {
    const r = proximasSessoes(base, new Date("2026-10-19T23:30:00Z"), 20);
    expect(r).toHaveLength(20);
  });
});

describe("agendaDeLinha", () => {
  it("converte a linha do banco", () => {
    const a = agendaDeLinha({
      fuso: "America/Sao_Paulo", inicio: null, fim: null, repeticao: "diaria", dia_semana: null,
      hora_inicio: "19:00:00", hora_fim: "23:59:00", vigencia_fim: "2026-12-31T23:59:00+00:00",
    });
    expect(a.horaInicio).toBe("19:00");
    expect(a.horaFim).toBe("23:59");
    expect(a.vigenciaFim?.toISOString()).toBe("2026-12-31T23:59:00.000Z");
    expect(a.inicio).toBeNull();
  });
});

describe("estadoSala: diária com data de início", () => {
  const comInicio: Agenda = { ...base, horaInicio: "20:00", horaFim: "22:19", inicio: new Date("2026-10-22T03:00:00Z") }; // 22/10 00:00 em Brasília
  it("antes da data de início espera pela primeira sessão (22/10 às 20h), não pela de hoje", () => {
    const r = estadoSala(comInicio, new Date("2026-10-20T20:00:00Z"));
    expect(r.estado).toBe("espera");
    expect(iso(r.janela?.inicio)).toBe("2026-10-22T23:00:00.000Z");
  });
  it("depois da data de início segue diária normal", () => {
    const r = estadoSala(comInicio, new Date("2026-10-23T23:30:00Z"));
    expect(r.estado).toBe("aberta");
    expect(iso(r.janela?.inicio)).toBe("2026-10-23T23:00:00.000Z");
  });
});

describe("estadoSala: segunda a sexta", () => {
  const uteis: Agenda = { ...base, repeticao: "dias_uteis", horaInicio: "19:00", horaFim: "22:30" };

  it("sexta abre normal", () => {
    const r = estadoSala(uteis, new Date("2026-10-23T23:00:00Z")); // sexta, 20:00
    expect(r.estado).toBe("aberta");
    expect(iso(r.janela?.inicio)).toBe("2026-10-23T22:00:00.000Z");
  });

  it("sábado e domingo ficam em espera pela sessão de segunda", () => {
    for (const agora of ["2026-10-24T23:00:00Z", "2026-10-25T23:00:00Z"]) {
      const r = estadoSala(uteis, new Date(agora));
      expect(r.estado).toBe("espera");
      expect(iso(r.janela?.inicio)).toBe("2026-10-26T22:00:00.000Z");
    }
  });

  it("próximas sessões pulam o fim de semana", () => {
    const s = proximasSessoes(uteis, new Date("2026-10-23T12:00:00Z"), 5).map((j) => iso(j.inicio));
    expect(s).toEqual([
      "2026-10-23T22:00:00.000Z",
      "2026-10-26T22:00:00.000Z",
      "2026-10-27T22:00:00.000Z",
      "2026-10-28T22:00:00.000Z",
      "2026-10-29T22:00:00.000Z",
    ]);
  });
});
