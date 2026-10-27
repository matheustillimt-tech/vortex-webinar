export type Audiencia = { modo: "oculto" | "fixo" | "dinamico"; minimo: number; maximo: number };

// Fração do vídeo → fator entre mínimo (0) e máximo (1): sobe no 1º oitavo, platô até a metade, cai até o fim.
const CURVA = [0, 1, 1, 1, 1, 0.7, 0.4, 0.1, 0];

export function alvoPublico(a: Audiencia, fracao: number): number | null {
  if (a.modo === "oculto") return null;
  if (a.modo === "fixo") return a.maximo;
  const f = Math.min(1, Math.max(0, fracao)) * (CURVA.length - 1);
  const i = Math.min(CURVA.length - 2, Math.floor(f));
  const fator = CURVA[i] + (CURVA[i + 1] - CURVA[i]) * (f - i);
  return Math.round(a.minimo + (a.maximo - a.minimo) * fator);
}

/** Um passo do contador em direção ao alvo. `sorteio` devolve um número em [0, 1). */
export function passoPublico(atual: number, alvo: number, sorteio: () => number): number {
  const dist = alvo - atual;
  if (dist === 0) return atual;
  const chanceParado = Math.abs(dist) > 50 ? 0.1 : 0.28;
  if (sorteio() < chanceParado) return atual;
  const maxPasso = Math.max(8, Math.round(Math.abs(dist) * 0.08));
  const passo = Math.min(Math.abs(dist), 1 + Math.floor(sorteio() * maxPasso));
  return atual + Math.sign(dist) * passo;
}

export function intervaloPublicoMs(sorteio: () => number): number {
  return 1500 + Math.floor(sorteio() * 2000);
}
