import { describe, expect, it } from "vitest";
import { validarAgenda } from "@/src/lib/regras/agenda-form";

const unica = { fuso: "America/Sao_Paulo", repeticao: "nenhuma", inicio: "2026-10-20T19:00", fim: "2026-10-20T21:00", usar_sala_espera: "on" };
const diaria = { fuso: "America/Sao_Paulo", repeticao: "diaria", hora_inicio: "19:00", hora_fim: "23:59" };

describe("validarAgenda", () => {
  it("sessão única em UTC", () => {
    const r = validarAgenda(unica);
    expect("dados" in r && r.dados.inicio?.toISOString()).toBe("2026-10-20T22:00:00.000Z");
    expect("dados" in r && r.dados.fim?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect("dados" in r && r.dados.usarSalaEspera).toBe(true);
    expect("dados" in r && r.dados.horaInicio).toBeNull();
  });

  it("diária guarda só as horas", () => {
    const r = validarAgenda(diaria);
    expect(r).toEqual({ dados: { fuso: "America/Sao_Paulo", repeticao: "diaria", inicio: null, fim: null, diaSemana: null, horaInicio: "19:00", horaFim: "23:59", usarSalaEspera: false, vigenciaFim: null } });
  });

  it("semanal guarda o dia", () => {
    const r = validarAgenda({ ...diaria, repeticao: "semanal", dia_semana: "0" });
    expect("dados" in r && r.dados.diaSemana).toBe(0);
  });

  it("vigência opcional em UTC", () => {
    const r = validarAgenda({ ...diaria, vigencia_fim: "2026-12-31T23:59" });
    expect("dados" in r && r.dados.vigenciaFim?.toISOString()).toBe("2027-01-01T02:59:00.000Z");
  });

  it.each([
    [{ ...unica, fuso: "Marte/Base" }, "Escolha um fuso horário."],
    [{ ...unica, repeticao: "mensal" }, "Escolha o tipo de agenda."],
    [{ ...unica, inicio: "" }, "Informe início e fim da sessão."],
    [{ ...unica, fim: "2026-10-20T18:00" }, "O fim precisa ser depois do início."],
    [{ ...diaria, hora_inicio: "25:00" }, "Informe os horários de início e fim."],
    [{ ...diaria, hora_fim: "19:00" }, "Início e fim não podem ser iguais."],
    [{ ...diaria, repeticao: "semanal" }, "Escolha o dia da semana."],
    [{ ...diaria, repeticao: "semanal", dia_semana: "7" }, "Escolha o dia da semana."],
    [{ ...diaria, vigencia_fim: "amanhã" }, "Data final inválida."],
  ])("recusa %#", (c, erro) => expect(validarAgenda(c)).toEqual({ erro }));
});

describe("validarAgenda: começar em", () => {
  const rec = { fuso: "America/Sao_Paulo", repeticao: "diaria", hora_inicio: "20:00", hora_fim: "22:19" };
  it("guarda a data de início à meia-noite do fuso", () => {
    const r = validarAgenda({ ...rec, comeca_em: "2026-10-22" });
    expect("dados" in r && r.dados.inicio?.toISOString()).toBe("2026-10-22T03:00:00.000Z");
  });
  it("sem data, inicio fica nulo", () => {
    const r = validarAgenda(rec);
    expect("dados" in r && r.dados.inicio).toBeNull();
  });
  it("data inválida dá erro", () => {
    expect(validarAgenda({ ...rec, comeca_em: "22/10/2026" })).toEqual({ erro: "Data de início inválida." });
  });
});
