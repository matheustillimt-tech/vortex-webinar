import type { ConfigJit, Exibicao, HorarioJit } from "./jit";
import { FUSOS, localParaUtc } from "./fuso";

export const MAX_HORARIOS_JIT = 50;
export const FUSO_PADRAO_JIT = "America/Sao_Paulo";

export type TipoEmail = "inscricao" | "lembrete" | "comecando";
export const TIPOS_EMAIL: readonly TipoEmail[] = ["inscricao", "lembrete", "comecando"];

/** Um horário como chega do formulário (strings) ou do banco (`hora` `HH:mm:ss`, `data` Date/ISO, números). */
export type EntradaHorarioJit = {
  quando?: string | null;
  hora?: string | null;
  intervalo_min?: string | number | null;
  data?: string | Date | null;
  dia_semana?: string | number | null;
};

const QUANDOS: HorarioJit["quando"][] = ["todo_dia", "a_cada", "data", "dia_semana"];
const INTERVALOS = [15, 30, 45, 60];
const EXIBICOES: Exibicao[] = ["todos", "proximo", "entrar_direto", "proximos_2", "proximos_3", "proximos_4"];
const HORA = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const ISO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** "participante" (fuso do navegador) não serve pra interpretar uma data digitada no painel: usa Brasília. */
function fusoDoPainel(fuso: string): string {
  return fuso === "participante" ? FUSO_PADRAO_JIT : fuso;
}

function hora(v: string | null | undefined): string | null {
  const m = HORA.exec((v ?? "").trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

function inteiro(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  const s = (v ?? "").trim();
  return /^-?\d+$/.test(s) ? Number(s) : null;
}

function dataHorario(v: string | Date | null | undefined, fuso: string): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = (v ?? "").trim();
  if (ISO_COM_FUSO.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return localParaUtc(s, fusoDoPainel(fuso));
}

/** Valida um horário do JIT. `data` digitada (`YYYY-MM-DDTHH:mm`) é interpretada no `fuso` da configuração
 *  ("participante" → Brasília); `Date` ou ISO com fuso (do banco) passam direto. */
export function validarHorarioJit(c: EntradaHorarioJit, fuso: string): { erro: string } | { dados: HorarioJit } {
  const quando = c.quando as HorarioJit["quando"];
  if (!QUANDOS.includes(quando)) return { erro: "Escolha quando acontece." };
  const vazio: HorarioJit = { quando, hora: null, intervaloMin: null, data: null, diaSemana: null };
  switch (quando) {
    case "todo_dia": {
      const h = hora(c.hora);
      return h ? { dados: { ...vazio, hora: h } } : { erro: "Informe a hora." };
    }
    case "a_cada": {
      const n = inteiro(c.intervalo_min);
      return n !== null && INTERVALOS.includes(n) ? { dados: { ...vazio, intervaloMin: n } } : { erro: "Escolha o intervalo (15, 30, 45 ou 60 minutos)." };
    }
    case "data": {
      const d = dataHorario(c.data, fuso);
      return d ? { dados: { ...vazio, data: d } } : { erro: "Informe a data e a hora." };
    }
    case "dia_semana": {
      const dia = inteiro(c.dia_semana);
      if (dia === null || dia < 0 || dia > 6) return { erro: "Escolha o dia da semana." };
      const h = hora(c.hora);
      return h ? { dados: { ...vazio, diaSemana: dia, hora: h } } : { erro: "Informe a hora." };
    }
  }
}

function chave(h: HorarioJit): string {
  return [h.quando, h.hora ?? "", h.intervaloMin ?? "", h.data?.getTime() ?? "", h.diaSemana ?? ""].join("|");
}

/** Valida a lista inteira (a que vai ficar salva): pelo menos um, no máximo 50, sem duplicados. Pra adicionar um
 *  horário, passe os existentes + o novo. */
export function validarHorariosJit(lista: EntradaHorarioJit[], fuso: string): { erro: string } | { dados: HorarioJit[] } {
  if (lista.length === 0) return { erro: "Adicione pelo menos um horário." };
  if (lista.length > MAX_HORARIOS_JIT) return { erro: `No máximo ${MAX_HORARIOS_JIT} horários.` };
  const dados: HorarioJit[] = [];
  const vistos = new Set<string>();
  for (const item of lista) {
    const r = validarHorarioJit(item, fuso);
    if ("erro" in r) return r;
    const k = chave(r.dados);
    if (vistos.has(k)) return { erro: "Já existe um horário igual." };
    vistos.add(k);
    dados.push(r.dados);
  }
  return { dados };
}

function horaDoDia(v: string | undefined): number | null | "invalida" {
  const s = (v ?? "").trim();
  if (s === "") return null;
  const n = inteiro(s);
  return n !== null && n >= 0 && n <= 23 ? n : "invalida";
}

/** Configuração do JIT (campos do formulário): fuso (lista de `FUSOS` ou "participante"), esconder madrugada
 *  (de/até, os dois ou nenhum), exibição e data final opcional (no fuso; "participante" → Brasília). */
export function validarConfigJit(c: Record<string, string | undefined>): { erro: string } | { dados: ConfigJit } {
  const fuso = c.fuso ?? "";
  if (fuso !== "participante" && !FUSOS.some((f) => f.valor === fuso)) return { erro: "Escolha um fuso horário." };

  const de = horaDoDia(c.esconder_de);
  const ate = horaDoDia(c.esconder_ate);
  if (de === "invalida" || ate === "invalida" || (de === null) !== (ate === null)) return { erro: "Informe de que hora até que hora esconder." };
  if (de !== null && de === ate) return { erro: "As horas de esconder não podem ser iguais." };

  const exibicao = c.exibicao as Exibicao;
  if (!EXIBICOES.includes(exibicao)) return { erro: "Escolha como os horários aparecem." };

  let fim: Date | null = null;
  if (c.fim) {
    fim = localParaUtc(c.fim, fusoDoPainel(fuso));
    if (!fim) return { erro: "Data final inválida." };
  }
  return { dados: { fuso, esconderDe: de, esconderAte: ate, exibicao, fim } };
}

export type DadosEmailJit = {
  tipo: TipoEmail;
  remetenteNome: string;
  assunto: string;
  texto: string;
  /** Só no lembrete (padrão 60); `null` nos outros. */
  minutosAntes: number | null;
};

export const MAX_ASSUNTO = 150;
export const MAX_TEXTO = 5000;
export const MINUTOS_LEMBRETE_PADRAO = 60;

/** Modelo de um e-mail do JIT (cartão do painel). O texto é puro (o HTML é montado por `renderizarEmail`). */
export function validarEmailJit(c: Record<string, string | undefined>): { erro: string } | { dados: DadosEmailJit } {
  const tipo = c.tipo as TipoEmail;
  if (!TIPOS_EMAIL.includes(tipo)) return { erro: "Tipo de e-mail inválido." };

  const remetenteNome = (c.remetente_nome ?? "").trim();
  if (remetenteNome.length < 1 || remetenteNome.length > 80) return { erro: "Informe o nome do remetente (até 80 caracteres)." };
  if (/[<>"\r\n]/.test(remetenteNome)) return { erro: 'O nome do remetente não pode ter < > " nem quebra de linha.' };

  const assunto = (c.assunto ?? "").replace(/[\r\n]+/g, " ").trim();
  if (assunto.length < 1 || assunto.length > MAX_ASSUNTO) return { erro: `Informe o assunto (até ${MAX_ASSUNTO} caracteres).` };

  const texto = (c.texto ?? "").replace(/\r\n?/g, "\n").trim();
  if (texto.length < 1 || texto.length > MAX_TEXTO) return { erro: `Escreva o texto do e-mail (até ${MAX_TEXTO} caracteres).` };

  let minutosAntes: number | null = null;
  if (tipo === "lembrete") {
    const v = (c.minutos_antes ?? "").trim();
    minutosAntes = v === "" ? MINUTOS_LEMBRETE_PADRAO : inteiro(v);
    if (minutosAntes === null || minutosAntes < 5 || minutosAntes > 1440) return { erro: "Minutos antes: entre 5 e 1440." };
  }
  return { dados: { tipo, remetenteNome, assunto, texto, minutosAntes } };
}
