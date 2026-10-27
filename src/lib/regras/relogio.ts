export type Posicao = { estado: "antes" | "rodando" | "fim"; segundo: number };
export type Marco = "min_15" | "min_30" | "min_45" | "min_60";

const MARCOS: [Marco, number][] = [["min_15", 900], ["min_30", 1800], ["min_45", 2700], ["min_60", 3600]];

/** Onde o vídeo deveria estar agora: segundos desde o início da sessão. */
export function posicaoVideo(inicioSessao: Date, agora: Date, duracaoSeg: number): Posicao {
  const s = Math.floor((agora.getTime() - inicioSessao.getTime()) / 1000);
  if (s < 0) return { estado: "antes", segundo: 0 };
  // Duração ainda desconhecida ou não processada (vídeo sem duração confiável): nunca dá pra concluir que acabou.
  if (duracaoSeg <= 20) return { estado: "rodando", segundo: s };
  if (s >= duracaoSeg) return { estado: "fim", segundo: duracaoSeg };
  return { estado: "rodando", segundo: s };
}

/**
 * Sincronizado: todos no mesmo ponto (início da sessão). Senão: cada um do começo, a partir do primeiro acesso.
 * Se for uma sessão JIT com horário escolhido, esse horário vence sempre.
 */
export function inicioDaSessao(o: { sincronizar: boolean; janelaInicio: Date; primeiroAcesso: Date; jitEscolhido?: Date | null }): Date {
  if (o.jitEscolhido) return o.jitEscolhido;
  return o.sincronizar ? o.janelaInicio : o.primeiroAcesso;
}

/** Atrasado 1 s ou adiantado 1,5 s em relação ao esperado → reposicionar. */
export function precisaReposicionar(atualSeg: number, esperadoSeg: number): boolean {
  const d = atualSeg - esperadoSeg;
  return d <= -1 || d >= 1.5;
}

export function marcosDeTempo(segundo: number): Marco[] {
  return MARCOS.filter(([, s]) => segundo >= s).map(([m]) => m);
}

// Relógio ao vivo da sala (apply-room-clock) ----------------------------------------------------------------------

/** Deslocamento entre o relógio do servidor e o do navegador (ms), medido uma vez na carga da sala. */
export function deslocamentoRelogio(agoraServidorMs: number, agoraLocalMs: number): number {
  return agoraServidorMs - agoraLocalMs;
}

/** Onde o vídeo deveria estar agora no modo ao vivo (s, com fração; nunca negativo). `agoraServidorMs` já é o
 *  relógio local corrigido pelo deslocamento. */
export function segundoEsperadoAoVivo(inicioSessaoMs: number, agoraServidorMs: number): number {
  return Math.max(0, (agoraServidorMs - inicioSessaoMs) / 1000);
}

/** Posição em que o player começa: ao vivo, o relógio da sala; replay, a posição salva (resume-personal); teste,
 *  do começo. Sempre entre 0 e `duração − 1` quando a duração é confiável (> 20 s) — começar além do fim
 *  dispararia `ended` antes de a sala montar. */
export function posicaoInicialPlayer(o: {
  modo: "ao_vivo" | "replay" | "teste";
  esperadoSeg: number;
  posicaoReplaySeg: number;
  duracaoSeg: number;
}): number {
  const bruto = o.modo === "ao_vivo" ? o.esperadoSeg : o.modo === "replay" ? o.posicaoReplaySeg : 0;
  const s = Number.isFinite(bruto) ? Math.max(0, bruto) : 0;
  return o.duracaoSeg > 20 ? Math.min(s, o.duracaoSeg - 1) : s;
}

/** A transmissão acabou? Ao vivo, quem decide é o relógio da sala (agora − início > duração, com duração > 20 s),
 *  mesmo que o vídeo ainda não tenha chegado ao fim; no replay, a posição do próprio vídeo; no teste, nunca pelo
 *  relógio (só pelo `ended` do vídeo, tratado à parte). */
export function transmissaoEncerrada(o: {
  modo: "ao_vivo" | "replay" | "teste";
  inicioSessaoMs: number;
  agoraServidorMs: number;
  duracaoSeg: number;
  segundoVideo: number;
}): boolean {
  if (o.modo === "teste" || o.duracaoSeg <= 20) return false;
  if (o.modo === "ao_vivo") {
    return posicaoVideo(new Date(o.inicioSessaoMs), new Date(o.agoraServidorMs), o.duracaoSeg).estado === "fim";
  }
  return o.segundoVideo >= o.duracaoSeg;
}
