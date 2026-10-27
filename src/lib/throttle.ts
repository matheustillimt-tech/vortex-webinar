/** Throttle com chamada no fim garantida: a primeira chamada roda na hora; as que chegam dentro do intervalo
 *  viram UMA chamada só, no fim do intervalo (nunca mais de 1 a cada `intervaloMs`, e a última mudança nunca se
 *  perde). Usado pelo painel de atendimento pra não recarregar a lista a cada evento do Realtime. */
export function criarThrottle(fn: () => void, intervaloMs: number): { chamar: () => void; cancelar: () => void } {
  let ultimaMs = -Infinity;
  let pendente: ReturnType<typeof setTimeout> | null = null;

  function executar() {
    pendente = null;
    ultimaMs = Date.now();
    fn();
  }

  return {
    chamar() {
      if (pendente) return; // já tem uma chamada agendada pro fim do intervalo: ela cobre esta.
      const espera = ultimaMs + intervaloMs - Date.now();
      if (espera <= 0) executar();
      else pendente = setTimeout(executar, espera);
    },
    cancelar() {
      if (pendente) clearTimeout(pendente);
      pendente = null;
    },
  };
}
