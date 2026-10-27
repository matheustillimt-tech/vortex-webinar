/** Regras puras do polling das respostas do atendimento (`useSuporte`). */

/** Junta as mensagens recém-chegadas às já recebidas: por `id` (uma edição/apagamento substitui a versão antiga e
 *  vai pro fim, sem duplicar) e guarda só as últimas `limite` — o polling roda a sala inteira, a lista não pode
 *  crescer sem fim. */
export function acumularRecebidas<T extends { id: string }>(atual: T[], novas: T[], limite: number): T[] {
  const idsNovos = new Set(novas.map((m) => m.id));
  const juntas = [...atual.filter((m) => !idsNovos.has(m.id)), ...novas];
  return juntas.length > limite ? juntas.slice(juntas.length - limite) : juntas;
}

/** Instante ISO em microssegundos desde a época: o `Date` corta em milissegundos, mas o Postgres grava
 *  microssegundos — sem isso, duas versões no mesmo milissegundo empatam. */
function microssegundos(iso: string): number {
  const ms = Date.parse(iso);
  const fracao = /\.(\d+)/.exec(iso)?.[1] ?? "";
  const resto = Number(fracao.padEnd(6, "0").slice(3, 6));
  return ms * 1000 + resto;
}

/** O mais recente entre o `desde` atual e um `atualizadaEm` recebido (devolve a string original, que vai de volta
 *  pro servidor como está). */
export function maisRecente(atual: string | null, candidato: string): string {
  if (!atual) return candidato;
  return microssegundos(candidato) > microssegundos(atual) ? candidato : atual;
}
