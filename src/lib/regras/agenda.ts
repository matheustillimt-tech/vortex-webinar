import { DateTime } from "luxon";

export type Repeticao = "nenhuma" | "diaria" | "dias_uteis" | "semanal";
export type Agenda = {
  fuso: string;
  inicio: Date | null;
  fim: Date | null;
  repeticao: Repeticao;
  diaSemana: number | null;
  horaInicio: string | null;
  horaFim: string | null;
  vigenciaFim: Date | null;
};
export type Janela = { inicio: Date; fim: Date };
export type EstadoSala = { estado: "espera" | "aberta" | "encerrada"; janela: Janela | null };
export type LinhaAgenda = {
  fuso: string;
  inicio: string | null;
  fim: string | null;
  repeticao: Repeticao;
  dia_semana: number | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  vigencia_fim: string | null;
};

function janelaDoDia(dia: DateTime, horaInicio: string, horaFim: string): Janela {
  const [hi, mi] = horaInicio.split(":").map(Number);
  const [hf, mf] = horaFim.split(":").map(Number);
  const ini = dia.set({ hour: hi, minute: mi, second: 0, millisecond: 0 });
  let fim = dia.set({ hour: hf, minute: mf, second: 0, millisecond: 0 });
  if (fim <= ini) fim = fim.plus({ days: 1 }); // janela que vira a meia-noite
  return { inicio: ini.toJSDate(), fim: fim.toJSDate() };
}

/** Janelas de ontem até `horizonteDias` dias à frente (cobre a madrugada de ontem e o próximo dia da semana), em ordem. */
function janelasRecorrentes(a: Agenda, agora: Date, horizonteDias: number): Janela[] {
  if (!a.horaInicio || !a.horaFim) return [];
  const hoje = DateTime.fromJSDate(agora, { zone: a.fuso }).startOf("day");
  const lista: Janela[] = [];
  for (let d = -1; d <= horizonteDias; d++) {
    const dia = hoje.plus({ days: d });
    // Luxon: 1 = segunda … 7 = domingo. Nosso dia_semana: 0 = domingo … 6 = sábado.
    if (a.repeticao === "semanal" && dia.weekday % 7 !== a.diaSemana) continue;
    if (a.repeticao === "dias_uteis" && dia.weekday > 5) continue; // sábado (6) e domingo (7) sem sessão
    lista.push(janelaDoDia(dia, a.horaInicio, a.horaFim));
  }
  // `inicio` numa agenda com repetição = "começar em": nenhuma sessão antes dessa data.
  return lista.filter(
    (j) => (!a.vigenciaFim || j.inicio.getTime() <= a.vigenciaFim.getTime()) && (!a.inicio || j.inicio.getTime() >= a.inicio.getTime()),
  );
}

function janelas(a: Agenda, agora: Date, horizonteDias = 8): Janela[] {
  if (a.repeticao === "nenhuma") return a.inicio && a.fim ? [{ inicio: a.inicio, fim: a.fim }] : [];
  return janelasRecorrentes(a, agora, horizonteDias);
}

export function estadoSala(a: Agenda, agora: Date): EstadoSala {
  const t = agora.getTime();
  const lista = janelas(a, agora);
  const aberta = lista.find((j) => j.inicio.getTime() <= t && t < j.fim.getTime());
  if (aberta) return { estado: "aberta", janela: aberta };
  const proxima = lista.find((j) => j.inicio.getTime() > t);
  if (proxima) return { estado: "espera", janela: proxima };
  return { estado: "encerrada", janela: null };
}

/** Horizonte (em dias) suficiente pra ter `n` janelas futuras: semanal precisa de ~n semanas, diária de n dias, segunda a sexta de ~7/5 de n. */
function horizonteParaN(a: Agenda, n: number): number {
  if (a.repeticao === "semanal") return n * 7 + 1;
  if (a.repeticao === "diaria") return n + 2;
  if (a.repeticao === "dias_uteis") return Math.ceil((n * 7) / 5) + 3;
  return 8;
}

export function proximasSessoes(a: Agenda, agora: Date, n: number): Janela[] {
  const horizonte = horizonteParaN(a, n);
  return janelas(a, agora, horizonte)
    .filter((j) => j.fim.getTime() > agora.getTime())
    .slice(0, n);
}

export function agendaDeLinha(l: LinhaAgenda): Agenda {
  const data = (v: string | null) => (v ? new Date(v) : null);
  const hora = (v: string | null) => (v ? v.slice(0, 5) : null);
  return {
    fuso: l.fuso,
    inicio: data(l.inicio),
    fim: data(l.fim),
    repeticao: l.repeticao,
    diaSemana: l.dia_semana,
    horaInicio: hora(l.hora_inicio),
    horaFim: hora(l.hora_fim),
    vigenciaFim: data(l.vigencia_fim),
  };
}
