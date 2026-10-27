/**
 * Cache em memória, curto (segundos), por instância da função. Feito para os dados da sala que são iguais para
 * todo mundo (configuração do webinar, chat simulado, duração do vídeo): num pico de entrada (mil pessoas no mesmo
 * minuto), cada instância da Vercel consulta o Supabase uma vez a cada `ttlMs` por chave, em vez de uma vez por
 * request.
 *
 * - Requests simultâneos com a mesma chave dividem a mesma Promise (uma consulta só, mesmo antes de responder).
 * - Só guarda o que `guardar(valor)` aprovar (padrão: tudo). Quem chama recusa resultado incompleto ou com erro,
 *   pra uma falha passageira do banco não ficar presa no cache.
 * - Promise rejeitada sai do cache (a próxima chamada tenta de novo).
 * - `maxChaves` limita a memória: passando disso, as entradas vencidas saem e, se ainda faltar espaço, a mais
 *   antiga sai.
 *
 * O valor devolvido é o mesmo objeto para todos os requests: quem usa não pode alterá-lo.
 */
export type CacheCurto<T> = ((chave: string) => Promise<T>) & { limpar: () => void; tamanho: () => number };

export function cacheCurto<T>(
  carregar: (chave: string) => Promise<T>,
  opcoes: { ttlMs: number; guardar?: (valor: T) => boolean; maxChaves?: number; agora?: () => number },
): CacheCurto<T> {
  const { ttlMs, guardar = () => true, maxChaves = 500, agora = Date.now } = opcoes;
  const mapa = new Map<string, { expira: number; valor: Promise<T> }>();

  function abrirEspaco(t: number) {
    if (mapa.size < maxChaves) return;
    for (const [k, e] of mapa) if (e.expira <= t) mapa.delete(k);
    if (mapa.size >= maxChaves) {
      const maisAntiga = mapa.keys().next().value;
      if (maisAntiga !== undefined) mapa.delete(maisAntiga);
    }
  }

  const obter = ((chave: string) => {
    const t = agora();
    const existente = mapa.get(chave);
    if (existente && existente.expira > t) return existente.valor;
    if (existente) mapa.delete(chave);

    abrirEspaco(t);
    const valor = carregar(chave);
    const entrada = { expira: t + ttlMs, valor };
    mapa.set(chave, entrada);
    const sair = () => {
      if (mapa.get(chave) === entrada) mapa.delete(chave);
    };
    valor.then((v) => {
      if (!guardar(v)) sair();
    }, sair);
    return valor;
  }) as CacheCurto<T>;

  obter.limpar = () => mapa.clear();
  obter.tamanho = () => mapa.size;
  return obter;
}
