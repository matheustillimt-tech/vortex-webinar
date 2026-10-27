import type { Repeticao } from "./agenda";
import { ehFusoValido, localParaUtc } from "./fuso";

export type DadosAgenda = {
  fuso: string;
  repeticao: Repeticao;
  inicio: Date | null;
  fim: Date | null;
  diaSemana: number | null;
  horaInicio: string | null;
  horaFim: string | null;
  usarSalaEspera: boolean;
  vigenciaFim: Date | null;
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const REPETICOES: Repeticao[] = ["nenhuma", "diaria", "dias_uteis", "semanal"];

export function validarAgenda(c: Record<string, string | undefined>): { erro: string } | { dados: DadosAgenda } {
  const fuso = c.fuso ?? "";
  if (!ehFusoValido(fuso)) return { erro: "Escolha um fuso horário." };
  const repeticao = c.repeticao as Repeticao;
  if (!REPETICOES.includes(repeticao)) return { erro: "Escolha o tipo de agenda." };

  let vigenciaFim: Date | null = null;
  if (c.vigencia_fim) {
    vigenciaFim = localParaUtc(c.vigencia_fim, fuso);
    if (!vigenciaFim) return { erro: "Data final inválida." };
  }
  const usarSalaEspera = c.usar_sala_espera === "on";
  const vazio = { inicio: null, fim: null, diaSemana: null, horaInicio: null, horaFim: null };

  if (repeticao === "nenhuma") {
    const inicio = localParaUtc(c.inicio ?? "", fuso);
    const fim = localParaUtc(c.fim ?? "", fuso);
    if (!inicio || !fim) return { erro: "Informe início e fim da sessão." };
    if (fim.getTime() <= inicio.getTime()) return { erro: "O fim precisa ser depois do início." };
    return { dados: { ...vazio, fuso, repeticao, inicio, fim, usarSalaEspera, vigenciaFim } };
  }

  const horaInicio = c.hora_inicio ?? "";
  const horaFim = c.hora_fim ?? "";
  if (!HORA.test(horaInicio) || !HORA.test(horaFim)) return { erro: "Informe os horários de início e fim." };
  if (horaInicio === horaFim) return { erro: "Início e fim não podem ser iguais." };
  let diaSemana: number | null = null;
  if (repeticao === "semanal") {
    diaSemana = /^[0-6]$/.test(c.dia_semana ?? "") ? Number(c.dia_semana) : null;
    if (diaSemana === null) return { erro: "Escolha o dia da semana." };
  }
  let comecaEm: Date | null = null;
  if (c.comeca_em) {
    comecaEm = /^\d{4}-\d{2}-\d{2}$/.test(c.comeca_em) ? localParaUtc(`${c.comeca_em}T00:00`, fuso) : null;
    if (!comecaEm) return { erro: "Data de início inválida." };
  }
  return { dados: { ...vazio, fuso, repeticao, inicio: comecaEm, diaSemana, horaInicio, horaFim, usarSalaEspera, vigenciaFim } };
}
