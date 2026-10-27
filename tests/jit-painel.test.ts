import { describe, expect, it } from "vitest";
import { modelosPadrao } from "@/src/lib/regras/emails";
import {
  agendaConfigurada,
  CONFIG_JIT_PADRAO,
  configDeLinha,
  descreverHorario,
  horarioDeLinha,
  linhaDeHorario,
  modeloDeLinha,
} from "@/src/lib/regras/jit-painel";

const SP = "America/Sao_Paulo";

describe("linhaDeHorario / horarioDeLinha", () => {
  it("vai e volta do banco (hora HH:mm:ss → HH:mm, data ISO)", () => {
    const data = new Date("2026-10-25T23:00:00.000Z");
    const linha = linhaDeHorario({ quando: "data", hora: null, intervaloMin: null, data, diaSemana: null });
    expect(linha).toEqual({ quando: "data", hora: null, intervalo_min: null, data: "2026-10-25T23:00:00.000Z", dia_semana: null });
    expect(horarioDeLinha({ quando: "dia_semana", hora: "20:00:00", intervalo_min: null, data: null, dia_semana: 3 })).toEqual({
      quando: "dia_semana",
      hora: "20:00",
      intervaloMin: null,
      data: null,
      diaSemana: 3,
    });
    expect(horarioDeLinha({ ...linha }).data?.getTime()).toBe(data.getTime());
  });
});

describe("descreverHorario", () => {
  it("texto de cada tipo", () => {
    expect(descreverHorario({ quando: "todo_dia", hora: "19:00", intervaloMin: null, data: null, diaSemana: null }, SP)).toBe("Todo dia às 19:00");
    expect(descreverHorario({ quando: "a_cada", hora: null, intervaloMin: 30, data: null, diaSemana: null }, SP)).toBe("A cada 30 minutos");
    expect(descreverHorario({ quando: "dia_semana", hora: "20:00", intervaloMin: null, data: null, diaSemana: 3 }, SP)).toBe("Toda quarta às 20:00");
    expect(descreverHorario({ quando: "dia_semana", hora: "10:00", intervaloMin: null, data: null, diaSemana: 6 }, SP)).toBe("Todo sábado às 10:00");
  });

  it("data selecionada no fuso da configuração ('participante' → Brasília)", () => {
    const h = { quando: "data" as const, hora: null, intervaloMin: null, data: new Date("2026-10-25T23:00:00Z"), diaSemana: null };
    expect(descreverHorario(h, "participante")).toBe("Em domingo, 25/10 às 20:00");
    expect(descreverHorario(h, "America/Manaus")).toBe("Em domingo, 25/10 às 19:00");
  });
});

describe("configDeLinha", () => {
  it("sem linha usa o padrão; com linha converte", () => {
    expect(configDeLinha(null)).toEqual(CONFIG_JIT_PADRAO);
    expect(configDeLinha({ fuso: "participante", esconder_de: 0, esconder_ate: 6, exibicao: "proximos_2", fim: "2026-12-31T23:59:00Z" })).toEqual({
      fuso: "participante",
      esconderDe: 0,
      esconderAte: 6,
      exibicao: "proximos_2",
      fim: new Date("2026-12-31T23:59:00Z"),
    });
  });
});

describe("modeloDeLinha", () => {
  const padrao = modelosPadrao("pt-BR");
  it("sem linha → padrão", () => {
    expect(modeloDeLinha(undefined, padrao.lembrete)).toEqual(padrao.lembrete);
  });
  it("com linha → texto do modelo jsonb e minutos só no lembrete", () => {
    expect(
      modeloDeLinha({ tipo: "lembrete", remetente_nome: "Paula", assunto: "Já já", modelo: { texto: "Oi {{nome}}" }, minutos_antes: 30 }, padrao.lembrete),
    ).toEqual({ remetenteNome: "Paula", assunto: "Já já", texto: "Oi {{nome}}", minutosAntes: 30 });
    expect(
      modeloDeLinha({ tipo: "inscricao", remetente_nome: "G", assunto: "A", modelo: {}, minutos_antes: 30 }, padrao.inscricao),
    ).toEqual({ remetenteNome: "G", assunto: "A", texto: padrao.inscricao.texto, minutosAntes: null });
  });
});

describe("agendaConfigurada", () => {
  it("sessão única/repetição: início ou hora salva", () => {
    expect(agendaConfigurada({ tipoAgenda: "unica", inicio: null, horaInicio: null, horariosJit: 3 })).toBe(false);
    expect(agendaConfigurada({ tipoAgenda: "unica", inicio: "2026-10-25T22:00:00Z", horaInicio: null, horariosJit: 0 })).toBe(true);
    expect(agendaConfigurada({ tipoAgenda: "recorrente", inicio: null, horaInicio: "19:00", horariosJit: 0 })).toBe(true);
  });
  it("just in time: pelo menos um horário (a agenda única não conta)", () => {
    expect(agendaConfigurada({ tipoAgenda: "jit", inicio: "2026-10-25T22:00:00Z", horaInicio: "19:00", horariosJit: 0 })).toBe(false);
    expect(agendaConfigurada({ tipoAgenda: "jit", inicio: null, horaInicio: null, horariosJit: 1 })).toBe(true);
  });
});
