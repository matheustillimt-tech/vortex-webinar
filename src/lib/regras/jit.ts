import { DateTime } from "luxon";
import { ehFusoValido } from "./fuso";
import type { Idioma } from "./textos-sala";

export type HorarioJit = {
  quando: "todo_dia" | "a_cada" | "data" | "dia_semana";
  hora: string | null;
  intervaloMin: number | null;
  data: Date | null;
  diaSemana: number | null;
};
export type Exibicao = "todos" | "proximo" | "entrar_direto" | "proximos_2" | "proximos_3" | "proximos_4";
export type ConfigJit = { fuso: string; esconderDe: number | null; esconderAte: number | null; fim: Date | null; exibicao: Exibicao };

const LIMITE: Record<Exibicao, number> = { todos: 10, proximo: 1, entrar_direto: 1, proximos_2: 2, proximos_3: 3, proximos_4: 4 };
const DIAS_A_FRENTE = 8;

function escondido(hora: number, de: number | null, ate: number | null): boolean {
  if (de === null || ate === null || de === ate) return false;
  return de < ate ? hora >= de && hora < ate : hora >= de || hora < ate; // de > ate: atravessa a meia-noite
}

function naHora(dia: DateTime, hora: string): DateTime {
  const [h, m] = hora.split(":").map(Number);
  return dia.set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

function candidatos(x: HorarioJit, agoraLocal: DateTime): DateTime[] {
  const hoje = agoraLocal.startOf("day");
  const dias = Array.from({ length: DIAS_A_FRENTE }, (_, i) => hoje.plus({ days: i }));
  switch (x.quando) {
    case "todo_dia":
      return x.hora ? dias.map((d) => naHora(d, x.hora!)) : [];
    case "dia_semana":
      return x.hora && x.diaSemana !== null ? dias.filter((d) => d.weekday % 7 === x.diaSemana).map((d) => naHora(d, x.hora!)) : [];
    case "data":
      return x.data ? [DateTime.fromJSDate(x.data, { zone: agoraLocal.zone })] : [];
    case "a_cada": {
      if (!x.intervaloMin || x.intervaloMin <= 0) return [];
      const passo = x.intervaloMin;
      const inicioDia = agoraLocal.startOf("day");
      const lista: DateTime[] = [];
      for (let t = inicioDia; t < agoraLocal.plus({ days: 2 }); t = t.plus({ minutes: passo })) lista.push(t);
      return lista;
    }
  }
}

export function proximosHorariosJit(horarios: HorarioJit[], cfg: ConfigJit, agora: Date, fusoParticipante?: string): Date[] {
  const fuso =
    cfg.fuso === "participante"
      ? fusoParticipante && ehFusoValido(fusoParticipante)
        ? fusoParticipante
        : "America/Sao_Paulo"
      : cfg.fuso;
  const agoraLocal = DateTime.fromJSDate(agora, { zone: fuso });
  const vistos = new Set<number>();
  const lista: Date[] = [];
  for (const x of horarios) {
    for (const c of candidatos(x, agoraLocal)) {
      const t = c.toMillis();
      if (t <= agora.getTime() || vistos.has(t)) continue;
      if (cfg.fim && t > cfg.fim.getTime()) continue;
      if (escondido(c.setZone(fuso).hour, cfg.esconderDe, cfg.esconderAte)) continue;
      vistos.add(t);
      lista.push(c.toJSDate());
    }
  }
  return lista.sort((a, b) => a.getTime() - b.getTime()).slice(0, LIMITE[cfg.exibicao]);
}

/** Indicação legível do fuso para quem não está no horário de Brasília: "Lisbon, GMT+0", "New York, GMT-5"
 *  (cidade do identificador IANA + deslocamento naquela data, então o horário de verão sai certo). */
export function rotuloFuso(d: Date, fuso: string): string {
  const cidade = (fuso.split("/").pop() ?? fuso).replace(/_/g, " ");
  const deslocamento = DateTime.fromJSDate(d, { zone: fuso }).toFormat("Z");
  return `${cidade}, GMT${deslocamento}`;
}

const LOCALE: Record<Idioma, string> = { "pt-BR": "pt-BR", es: "es", en: "en" };
const FORMATO_DATA: Record<Idioma, string> = { "pt-BR": "cccc, d 'de' LLLL", es: "cccc, d 'de' LLLL", en: "cccc, LLLL d" };

/** Data por extenso ("segunda-feira, 2 de novembro") e hora (`HH:mm`) de um horário do JIT no fuso dado
 *  ("participante" ou inválido → Brasília; quem tem o fuso do navegador passa ele direto). */
export function formatarHorarioJit(d: Date, fuso: string, idioma: Idioma = "pt-BR"): { data: string; hora: string } {
  const zona = fuso !== "participante" && ehFusoValido(fuso) ? fuso : "America/Sao_Paulo";
  const dt = DateTime.fromJSDate(d, { zone: zona }).setLocale(LOCALE[idioma] ?? "pt-BR");
  return { data: dt.toFormat(FORMATO_DATA[idioma] ?? FORMATO_DATA["pt-BR"]), hora: dt.toFormat("HH:mm") };
}
