export type EstadoSorteio = "inicial" | "pronto" | "sorteando" | "parado";

const DURACAO_SORTEIO_MS = 3900;
const INTERVALO_TROCA_MS = 50;

/** Chave do `sessionStorage` com o estado do sorteio dessa pessoa nesse webinar (não sorteia de novo a cada
 *  recarregada — uma vez parado, fica parado). */
export function chaveSorteio(webinarId: string): string {
  return `vw_sorteio_${webinarId}`;
}

/** Verdadeiro quando o tempo decorrido desde que a pessoa clicou em "Sortear meu número" já passou da duração
 *  da animação (3,9 s) — hora de parar em `sorteioNumero` (o número real, decidido no admin). */
export function sorteioTerminou(decorridoMs: number, duracaoMs = DURACAO_SORTEIO_MS): boolean {
  return decorridoMs >= duracaoMs;
}

/** Um número aleatório do mesmo tamanho de `numeroFinal` (dígitos), para a animação de "embaralhar" antes de
 *  parar no número real. `sorteio` é a fonte de aleatoriedade (passar `Math.random`, nunca aqui dentro). */
export function numeroAleatorio(numeroFinal: string, sorteio: () => number): string {
  const digitos = numeroFinal.length || 1;
  let r = "";
  for (let i = 0; i < digitos; i++) r += String(Math.floor(sorteio() * 10));
  return r;
}

/** O que mostrar no lugar do número antes do sorteio começar (nunca o número real — ele só aparece no fim). */
export const PLACEHOLDER_SORTEIO = "?";

/** Estado ao remontar a aba (troca de aba ou recarregamento), a partir do valor guardado no `sessionStorage`.
 *  Quem estava no meio da animação ("sorteando") não recomeça: vai direto para o número final. */
export function estadoSorteioRestaurado(salvo: string | null): EstadoSorteio {
  if (salvo === "parado" || salvo === "sorteando") return "parado";
  return "inicial";
}

export function intervaloTrocaMs(): number {
  return INTERVALO_TROCA_MS;
}

export function duracaoSorteioMs(): number {
  return DURACAO_SORTEIO_MS;
}
