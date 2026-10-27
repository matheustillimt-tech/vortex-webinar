export type OfertaTempo = {
  ligada: boolean;
  apareceSeg: number;
  someSeg: number;
  pitchSeg: number | null;
  contagemSeg: number;
  sorteioLigado: boolean;
  sorteioSeg: number | null;
};

/** O que já aconteceu no vídeo neste segundo. No fim da transmissão a oferta aparece de novo. */
export function momentos(o: OfertaTempo | null, segundo: number, fimDoVideo: boolean): { pitch: boolean; oferta: boolean; sorteio: boolean } {
  if (!o) return { pitch: false, oferta: false, sorteio: false };
  const naJanela = segundo >= o.apareceSeg && (o.someSeg === 0 || segundo < o.someSeg);
  return {
    pitch: o.pitchSeg !== null && segundo >= o.pitchSeg,
    oferta: o.ligada && (naJanela || fimDoVideo),
    sorteio: o.sorteioLigado && o.sorteioSeg !== null && segundo >= o.sorteioSeg,
  };
}

export function contagemRestante(contagemSeg: number, segundosDesdeQueApareceu: number): number {
  return Math.max(0, contagemSeg - segundosDesdeQueApareceu);
}

export function mensagensVisiveis<T extends { segundo: number }>(lista: T[], segundo: number): T[] {
  return lista.filter((m) => m.segundo <= segundo).sort((a, b) => a.segundo - b.segundo);
}

/** Vendas no intervalo (deExclusivo, ateInclusivo], em ordem de segundo. A sala guarda o último segundo processado. */
export function vendasEntre<T extends { segundo: number }>(lista: T[], deExclusivo: number, ateInclusivo: number): T[] {
  if (ateInclusivo <= deExclusivo) return [];
  return lista
    .filter((v) => v.segundo > deExclusivo && v.segundo <= ateInclusivo)
    .sort((a, b) => a.segundo - b.segundo);
}
