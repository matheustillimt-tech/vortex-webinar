import { formatarSessao } from "./fuso";
import { FUSO_PADRAO_JIT, MINUTOS_LEMBRETE_PADRAO, type TipoEmail } from "./jit-form";
import type { ConfigJit, Exibicao, HorarioJit } from "./jit";
import type { ModeloEmail } from "./emails";

/** Linhas como vêm do banco (`jit_horarios`, `jit_config`, `emails_jit`). */
export type LinhaHorarioJit = {
  id?: string;
  quando: HorarioJit["quando"];
  hora: string | null;
  intervalo_min: number | null;
  data: string | null;
  dia_semana: number | null;
};
export type LinhaConfigJit = { fuso: string; esconder_de: number | null; esconder_ate: number | null; exibicao: Exibicao; fim: string | null };
export type LinhaEmailJit = { tipo: TipoEmail; remetente_nome: string; assunto: string; modelo: unknown; minutos_antes: number | null };

export const AVISO_SEM_EMAIL = "Os e-mails ainda não estão configurados (falta a conta do Resend).";

export const CONFIG_JIT_PADRAO: ConfigJit = { fuso: FUSO_PADRAO_JIT, esconderDe: null, esconderAte: null, exibicao: "todos", fim: null };

export const ROTULO_EXIBICAO: Record<Exibicao, string> = {
  todos: "Todos os próximos (até 10)",
  proximo: "Só o mais próximo",
  entrar_direto: "Não mostrar: entra no mais próximo",
  proximos_2: "Os 2 próximos",
  proximos_3: "Os 3 próximos",
  proximos_4: "Os 4 próximos",
};

export const ROTULO_TIPO_EMAIL: Record<TipoEmail, string> = {
  inscricao: "Inscrição confirmada",
  lembrete: "Lembrete",
  comecando: "Estamos começando",
};

export const QUANDO_EMAIL: Record<TipoEmail, string> = {
  inscricao: "Vai na hora da inscrição.",
  lembrete: "Vai alguns minutos antes do horário escolhido.",
  comecando: "Vai no horário escolhido.",
};

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Fuso em que o painel mostra e interpreta datas: "participante" → Brasília. */
export function fusoDoPainelJit(fuso: string): string {
  return fuso === "participante" ? FUSO_PADRAO_JIT : fuso;
}

/** Horário validado → linha de `jit_horarios` (sem `webinar_id`). */
export function linhaDeHorario(h: HorarioJit): Omit<LinhaHorarioJit, "id"> {
  return { quando: h.quando, hora: h.hora, intervalo_min: h.intervaloMin, data: h.data ? h.data.toISOString() : null, dia_semana: h.diaSemana };
}

/** Linha do banco → horário das regras (`hora` `HH:mm:ss` → `HH:mm`). */
export function horarioDeLinha(l: LinhaHorarioJit): HorarioJit {
  return {
    quando: l.quando,
    hora: l.hora ? l.hora.slice(0, 5) : null,
    intervaloMin: l.intervalo_min,
    data: l.data ? new Date(l.data) : null,
    diaSemana: l.dia_semana,
  };
}

export function configDeLinha(l: LinhaConfigJit | null): ConfigJit {
  if (!l) return CONFIG_JIT_PADRAO;
  return { fuso: l.fuso, esconderDe: l.esconder_de, esconderAte: l.esconder_ate, exibicao: l.exibicao, fim: l.fim ? new Date(l.fim) : null };
}

/** Texto de um horário na lista do painel ("Todo dia às 19:00", "Toda quarta às 20:00"…). */
export function descreverHorario(h: HorarioJit, fuso: string): string {
  switch (h.quando) {
    case "todo_dia":
      return `Todo dia às ${h.hora}`;
    case "a_cada":
      return `A cada ${h.intervaloMin} minutos`;
    case "data":
      return h.data ? `Em ${formatarSessao(h.data, fusoDoPainelJit(fuso))}` : "Data selecionada";
    case "dia_semana": {
      const dia = DIAS[h.diaSemana ?? 0];
      return `${dia === "sábado" || dia === "domingo" ? "Todo" : "Toda"} ${dia} às ${h.hora}`;
    }
  }
}

/** Modelo salvo de um e-mail (texto em `modelo.texto`) ou o padrão, quando não há linha. */
export function modeloDeLinha(l: LinhaEmailJit | undefined, padrao: ModeloEmail): ModeloEmail {
  if (!l) return padrao;
  const texto = (l.modelo as { texto?: unknown } | null)?.texto;
  return {
    remetenteNome: l.remetente_nome,
    assunto: l.assunto,
    texto: typeof texto === "string" && texto ? texto : padrao.texto,
    minutosAntes: l.tipo === "lembrete" ? (l.minutos_antes ?? MINUTOS_LEMBRETE_PADRAO) : null,
  };
}

/** A agenda está pronta? Sessão única/repetição: início ou hora salva. Just in time: pelo menos um horário. */
export function agendaConfigurada(o: { tipoAgenda: string; inicio: string | null; horaInicio: string | null; horariosJit: number }): boolean {
  if (o.tipoAgenda === "jit") return o.horariosJit > 0;
  return o.inicio !== null || o.horaInicio !== null;
}
