/** Chave do `sessionStorage` onde fica o instante (ms, `Date.now()`) em que a contagem da oferta começou pra
 *  essa pessoa, nesse webinar — recarregar a página não reinicia a contagem do zero. */
export function chaveContagemOferta(webinarId: string): string {
  return `vw_oferta_${webinarId}`;
}

/** Instante em que a contagem começou: o valor salvo, se houver; senão agora (primeira vez que a oferta apareceu). */
export function inicioContagem(agoraMs: number, salvoMs: number | null): number {
  return salvoMs !== null && Number.isFinite(salvoMs) && salvoMs > 0 && salvoMs <= agoraMs ? salvoMs : agoraMs;
}

/** Segundos restantes da contagem a partir de quando ela começou (nunca negativo). */
export function restanteContagem(contagemSeg: number, inicioMs: number, agoraMs: number): number {
  const passados = Math.floor(Math.max(0, agoraMs - inicioMs) / 1000);
  return Math.max(0, contagemSeg - passados);
}

/** "mm:ss" para o texto "Restam mm:ss" da barra fixa / card da oferta. */
export function formatarRestante(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
