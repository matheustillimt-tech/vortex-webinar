import "server-only";

const TAMANHO_PAGINA = 1000;

/** Builder de consulta compatível com o Postgrest: no fim da cadeia (`.select().eq().order()...`), `range`
 *  devolve uma Promise com `{ data, error }`. */
export type ConstrutorPaginado<T> = () => {
  range: (desde: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
};

/** O PostgREST (API do Supabase) limita cada resposta a 1000 linhas. `lerTudo` chama `construir()` de novo a
 *  cada página (o builder do Supabase é de uso único depois de resolvido), aplica `.range(i, i+999)` e concatena
 *  até uma página devolver menos de 1000 linhas — sinal de que não há próxima página.
 *
 *  Para o resultado ser determinístico entre páginas (sem repetir nem pular linha), quem chama precisa ordenar a
 *  consulta antes de passar o builder aqui: `segundo` + `id` para as tabelas de chat/vendas simulados, `id` para
 *  as demais. Para no primeiro erro e devolve o que já tinha lido até ali. */
export async function lerTudo<T>(construir: ConstrutorPaginado<T>): Promise<{ data: T[]; error: unknown }> {
  const todas: T[] = [];
  let inicio = 0;

  while (true) {
    const { data, error } = await construir().range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) return { data: todas, error };

    const pagina = data ?? [];
    todas.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) return { data: todas, error: null };
    inicio += TAMANHO_PAGINA;
  }
}
