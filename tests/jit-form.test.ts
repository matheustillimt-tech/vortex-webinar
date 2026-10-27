import { describe, expect, it } from "vitest";
import { validarConfigJit, validarEmailJit, validarHorarioJit, validarHorariosJit, MAX_HORARIOS_JIT } from "@/src/lib/regras/jit-form";

const SP = "America/Sao_Paulo";

describe("validarHorarioJit", () => {
  it("todo_dia exige hora HH:mm (aceita HH:mm:ss do banco)", () => {
    expect(validarHorarioJit({ quando: "todo_dia", hora: "20:00" }, SP)).toEqual({
      dados: { quando: "todo_dia", hora: "20:00", intervaloMin: null, data: null, diaSemana: null },
    });
    expect(validarHorarioJit({ quando: "todo_dia", hora: "09:30:00" }, SP)).toMatchObject({ dados: { hora: "09:30" } });
    expect(validarHorarioJit({ quando: "todo_dia", hora: "25:00" }, SP)).toEqual({ erro: "Informe a hora." });
    expect(validarHorarioJit({ quando: "todo_dia" }, SP)).toEqual({ erro: "Informe a hora." });
  });

  it("a_cada aceita só 15/30/45/60", () => {
    expect(validarHorarioJit({ quando: "a_cada", intervalo_min: "30" }, SP)).toEqual({
      dados: { quando: "a_cada", hora: null, intervaloMin: 30, data: null, diaSemana: null },
    });
    expect(validarHorarioJit({ quando: "a_cada", intervalo_min: 45 }, SP)).toMatchObject({ dados: { intervaloMin: 45 } });
    expect(validarHorarioJit({ quando: "a_cada", intervalo_min: "20" }, SP)).toEqual({ erro: "Escolha o intervalo (15, 30, 45 ou 60 minutos)." });
  });

  it("data: data+hora no fuso vira instante UTC; Date do banco passa direto", () => {
    expect(validarHorarioJit({ quando: "data", data: "2026-11-01T20:00" }, SP)).toEqual({
      dados: { quando: "data", hora: null, intervaloMin: null, data: new Date("2026-11-01T23:00:00Z"), diaSemana: null },
    });
    const d = new Date("2026-11-02T12:00:00Z");
    expect(validarHorarioJit({ quando: "data", data: d }, SP)).toMatchObject({ dados: { data: d } });
    expect(validarHorarioJit({ quando: "data", data: "amanhã" }, SP)).toEqual({ erro: "Informe a data e a hora." });
  });

  it("data com fuso 'participante' interpreta em Brasília", () => {
    expect(validarHorarioJit({ quando: "data", data: "2026-11-01T20:00" }, "participante")).toMatchObject({
      dados: { data: new Date("2026-11-01T23:00:00Z") },
    });
  });

  it("dia_semana exige 0–6 e hora", () => {
    expect(validarHorarioJit({ quando: "dia_semana", dia_semana: "0", hora: "10:00" }, SP)).toEqual({
      dados: { quando: "dia_semana", hora: "10:00", intervaloMin: null, data: null, diaSemana: 0 },
    });
    expect(validarHorarioJit({ quando: "dia_semana", dia_semana: "7", hora: "10:00" }, SP)).toEqual({ erro: "Escolha o dia da semana." });
    expect(validarHorarioJit({ quando: "dia_semana", dia_semana: 3 }, SP)).toEqual({ erro: "Informe a hora." });
  });

  it("tipo desconhecido", () => {
    expect(validarHorarioJit({ quando: "toda_hora" }, SP)).toEqual({ erro: "Escolha quando acontece." });
  });
});

describe("validarHorariosJit", () => {
  it("pelo menos um", () => {
    expect(validarHorariosJit([], SP)).toEqual({ erro: "Adicione pelo menos um horário." });
  });

  it("devolve todos normalizados", () => {
    const r = validarHorariosJit([{ quando: "todo_dia", hora: "20:00" }, { quando: "a_cada", intervalo_min: "15" }], SP);
    expect("dados" in r && r.dados.map((h) => h.quando)).toEqual(["todo_dia", "a_cada"]);
  });

  it("propaga o erro do item", () => {
    expect(validarHorariosJit([{ quando: "todo_dia", hora: "20:00" }, { quando: "todo_dia" }], SP)).toEqual({ erro: "Informe a hora." });
  });

  it("sem duplicados (mesma hora com e sem segundos conta como igual)", () => {
    expect(validarHorariosJit([{ quando: "todo_dia", hora: "20:00" }, { quando: "todo_dia", hora: "20:00:00" }], SP)).toEqual({
      erro: "Já existe um horário igual.",
    });
    expect(
      validarHorariosJit([{ quando: "data", data: "2026-11-01T20:00" }, { quando: "data", data: new Date("2026-11-01T23:00:00Z") }], SP),
    ).toEqual({ erro: "Já existe um horário igual." });
    // Mesma hora em tipos diferentes não é duplicado.
    expect("dados" in validarHorariosJit([{ quando: "todo_dia", hora: "20:00" }, { quando: "dia_semana", dia_semana: 1, hora: "20:00" }], SP)).toBe(true);
  });

  it("no máximo 50", () => {
    const lista = Array.from({ length: MAX_HORARIOS_JIT + 1 }, (_, i) => ({
      quando: "todo_dia",
      hora: `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
    }));
    expect(validarHorariosJit(lista, SP)).toEqual({ erro: "No máximo 50 horários." });
    expect("dados" in validarHorariosJit(lista.slice(0, MAX_HORARIOS_JIT), SP)).toBe(true);
  });
});

describe("validarConfigJit", () => {
  const base = { fuso: SP, exibicao: "todos" };

  it("mínimo válido", () => {
    expect(validarConfigJit(base)).toEqual({ dados: { fuso: SP, esconderDe: null, esconderAte: null, exibicao: "todos", fim: null } });
  });

  it("fuso da lista ou 'participante'", () => {
    expect(validarConfigJit({ ...base, fuso: "participante" })).toMatchObject({ dados: { fuso: "participante" } });
    expect(validarConfigJit({ ...base, fuso: "Asia/Kolkata" })).toEqual({ erro: "Escolha um fuso horário." });
    expect(validarConfigJit({ ...base, fuso: "" })).toEqual({ erro: "Escolha um fuso horário." });
  });

  it("esconder madrugada: os dois ou nenhum, 0–23, diferentes", () => {
    expect(validarConfigJit({ ...base, esconder_de: "0", esconder_ate: "6" })).toMatchObject({ dados: { esconderDe: 0, esconderAte: 6 } });
    expect(validarConfigJit({ ...base, esconder_de: "23", esconder_ate: "5" })).toMatchObject({ dados: { esconderDe: 23, esconderAte: 5 } });
    expect(validarConfigJit({ ...base, esconder_de: "0" })).toEqual({ erro: "Informe de que hora até que hora esconder." });
    expect(validarConfigJit({ ...base, esconder_de: "0", esconder_ate: "24" })).toEqual({ erro: "Informe de que hora até que hora esconder." });
    expect(validarConfigJit({ ...base, esconder_de: "3", esconder_ate: "3" })).toEqual({ erro: "As horas de esconder não podem ser iguais." });
  });

  it("exibição válida", () => {
    for (const e of ["todos", "proximo", "entrar_direto", "proximos_2", "proximos_3", "proximos_4"]) {
      expect(validarConfigJit({ ...base, exibicao: e })).toMatchObject({ dados: { exibicao: e } });
    }
    expect(validarConfigJit({ ...base, exibicao: "proximos_5" })).toEqual({ erro: "Escolha como os horários aparecem." });
  });

  it("fim opcional no fuso (participante → Brasília)", () => {
    expect(validarConfigJit({ ...base, fim: "2026-12-31T23:59" })).toMatchObject({ dados: { fim: new Date("2027-01-01T02:59:00Z") } });
    expect(validarConfigJit({ ...base, fuso: "participante", fim: "2026-12-31T23:59" })).toMatchObject({
      dados: { fim: new Date("2027-01-01T02:59:00Z") },
    });
    expect(validarConfigJit({ ...base, fim: "31/12" })).toEqual({ erro: "Data final inválida." });
  });
});

describe("validarEmailJit", () => {
  const base = { tipo: "inscricao", remetente_nome: "Vórtex", assunto: "Inscrição confirmada", texto: "Olá {{nome}}" };

  it("válido", () => {
    expect(validarEmailJit(base)).toEqual({
      dados: { tipo: "inscricao", remetenteNome: "Vórtex", assunto: "Inscrição confirmada", texto: "Olá {{nome}}", minutosAntes: null },
    });
  });

  it("tipo", () => {
    expect(validarEmailJit({ ...base, tipo: "outro" })).toEqual({ erro: "Tipo de e-mail inválido." });
  });

  it("remetente 1–80 sem caracteres de cabeçalho", () => {
    expect(validarEmailJit({ ...base, remetente_nome: " " })).toEqual({ erro: "Informe o nome do remetente (até 80 caracteres)." });
    expect(validarEmailJit({ ...base, remetente_nome: "x".repeat(81) })).toEqual({ erro: "Informe o nome do remetente (até 80 caracteres)." });
    expect(validarEmailJit({ ...base, remetente_nome: 'Ana <a@b.com>' })).toEqual({ erro: "O nome do remetente não pode ter < > \" nem quebra de linha." });
    expect(validarEmailJit({ ...base, remetente_nome: "Ana\nBcc: x" })).toEqual({ erro: "O nome do remetente não pode ter < > \" nem quebra de linha." });
  });

  it("assunto 1–150, sem quebra de linha", () => {
    expect(validarEmailJit({ ...base, assunto: "" })).toEqual({ erro: "Informe o assunto (até 150 caracteres)." });
    expect(validarEmailJit({ ...base, assunto: "a".repeat(151) })).toEqual({ erro: "Informe o assunto (até 150 caracteres)." });
    expect(validarEmailJit({ ...base, assunto: "a".repeat(150) })).toMatchObject({ dados: { assunto: "a".repeat(150) } });
    expect(validarEmailJit({ ...base, assunto: "linha\r\noutra" })).toMatchObject({ dados: { assunto: "linha outra" } });
  });

  it("texto 1–5000 (normaliza \\r\\n)", () => {
    expect(validarEmailJit({ ...base, texto: "  " })).toEqual({ erro: "Escreva o texto do e-mail (até 5000 caracteres)." });
    expect(validarEmailJit({ ...base, texto: "a".repeat(5001) })).toEqual({ erro: "Escreva o texto do e-mail (até 5000 caracteres)." });
    expect(validarEmailJit({ ...base, texto: "a\r\nb" })).toMatchObject({ dados: { texto: "a\nb" } });
  });

  it("lembrete exige minutos 5–1440 (padrão 60 quando vazio)", () => {
    expect(validarEmailJit({ ...base, tipo: "lembrete" })).toMatchObject({ dados: { minutosAntes: 60 } });
    expect(validarEmailJit({ ...base, tipo: "lembrete", minutos_antes: "30" })).toMatchObject({ dados: { minutosAntes: 30 } });
    expect(validarEmailJit({ ...base, tipo: "lembrete", minutos_antes: "2" })).toEqual({ erro: "Minutos antes: entre 5 e 1440." });
    expect(validarEmailJit({ ...base, tipo: "lembrete", minutos_antes: "abc" })).toEqual({ erro: "Minutos antes: entre 5 e 1440." });
    // Outros tipos ignoram minutos_antes.
    expect(validarEmailJit({ ...base, minutos_antes: "30" })).toMatchObject({ dados: { minutosAntes: null } });
  });
});
