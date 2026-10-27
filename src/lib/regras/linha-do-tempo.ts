const TAMANHO_JANELA_SEG = 300;
const MARGEM_PREFETCH_SEG = 60;

export type Janela = { de: number; ate: number };

/** Janela de 300 s que contém `segundo` (alinhada em múltiplos de `tamanho`, nunca com `de` negativo). Usada
 *  quando ainda não há janela carregada, ou quando a pessoa avançou/voltou o vídeo para fora da janela atual. */
export function janelaParaSegundo(segundo: number, tamanho = TAMANHO_JANELA_SEG): Janela {
  const s = Math.max(0, Math.floor(segundo));
  const de = Math.floor(s / tamanho) * tamanho;
  return { de, ate: de + tamanho };
}

/** Próxima janela, emendando exatamente onde a anterior terminou (nunca pula nem repete segundos). */
export function proximaJanela(ateAtual: number, tamanho = TAMANHO_JANELA_SEG): Janela {
  return { de: ateAtual, ate: ateAtual + tamanho };
}

/** Verdadeiro quando `segundo` já saiu da janela carregada (reposicionamento pra trás ou pra frente bem longe) —
 *  nesse caso o certo é descartar e buscar `janelaParaSegundo(segundo)` de novo, não emendar. */
export function precisaRecarregarJanela(janela: Janela, segundo: number): boolean {
  return segundo < janela.de || segundo > janela.ate;
}

/** Verdadeiro quando faltam `margem` segundos (padrão 60) para o fim da janela carregada — hora de prefetchar a
 *  próxima, antes que a pessoa alcance o fim do que já foi buscado. */
export function precisaBuscarProxima(janelaAte: number, segundo: number, margem = MARGEM_PREFETCH_SEG): boolean {
  return segundo >= janelaAte - margem;
}

/** Janela da primeira busca (ou depois de um reposicionamento): a janela atual mais a anterior (até 600 s, o
 *  máximo da API), pra quem chega atrasado já ver o chat recente em vez de uma tela vazia. */
export function janelaInicial(segundo: number, tamanho = TAMANHO_JANELA_SEG): Janela {
  const atual = janelaParaSegundo(segundo, tamanho);
  return { de: Math.max(0, atual.de - tamanho), ate: atual.ate };
}

/** Espera antes de tentar de novo depois de `falhas` buscas seguidas que falharam: 2 s, 4 s, 8 s... até 30 s. */
export function esperaAposFalhaMs(falhas: number, maximoMs = 30_000): number {
  const f = Math.max(1, Math.floor(falhas));
  return Math.min(maximoMs, 2000 * 2 ** (f - 1));
}

/** Pulo maior que isso entre duas leituras da posição é reposicionamento (entrada atrasada, correção do relógio),
 *  não reprodução normal — as vendas "puladas" não viram toast. */
const PULO_MAXIMO_SEG = 5;

/** Vendas que devem virar toast entre a última posição processada e a atual. Primeira leitura (`ultimo === null`)
 *  ou pulo (pra frente além de 5 s, ou pra trás) só reposiciona: nada de rajada de toasts ao entrar. */
export function vendasParaAvisar<T extends { segundo: number }>(lista: T[], ultimo: number | null, atual: number): T[] {
  if (ultimo === null || atual < ultimo || atual - ultimo > PULO_MAXIMO_SEG) return [];
  return lista.filter((v) => v.segundo > ultimo && v.segundo <= atual).sort((a, b) => a.segundo - b.segundo);
}
