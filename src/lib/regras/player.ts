
/** Regras puras do player travado da sala (sem `Math.random`/`Date.now` aqui — quem chama passa os tempos). */

/** Ao vivo/replay: a posição pulou mais que o limiar (padrão 1,5 s) em relação à última posição válida —
 *  sinal de que a pessoa tentou avançar/voltar manualmente pela barra ou pelo teclado (evento `seeking`). */
export function seekForaDoLimite(novoSeg: number, ultimoValidoSeg: number, limiarSeg = 1.5): boolean {
  return Math.abs(novoSeg - ultimoValidoSeg) > limiarSeg;
}

/** Carência depois de cada correção de posição (padrão 3 s): evita corrigir em loop enquanto o navegador ainda
 *  está assentando a posição anterior. */
export function dentroDaCarencia(agoraMs: number, ultimaCorrecaoMs: number, carenciaMs = 3000): boolean {
  return agoraMs - ultimaCorrecaoMs < carenciaMs;
}

/** Espera crescente entre tentativas de recarregar a fonte do vídeo: 1 s, 2 s, 4 s, 8 s... até o teto (padrão
 *  15 s). `tentativa` começa em 1. */
export function backoffMs(tentativa: number, maximoMs = 15000): number {
  const t = Math.max(1, Math.floor(tentativa));
  return Math.min(maximoMs, 1000 * 2 ** (t - 1));
}

export type EstadoConexao = "normal" | "lenta" | "recarregar";

/** Travado (sem `timeupdate`) por mais de 5 s → "Conexão lenta"; por mais de 12 s → recarrega a fonte. */
export function estadoConexao(msParado: number): EstadoConexao {
  if (msParado > 12000) return "recarregar";
  if (msParado > 5000) return "lenta";
  return "normal";
}

/** Vídeo vertical numa tela estreita (< 950 px) usa o layout vertical (tela cheia, abas por cima, fundo
 *  translúcido); qualquer outro caso (vídeo horizontal, ou vertical numa tela larga) usa o horizontal. */
export function decidirLayoutSala(orientacaoVideo: "horizontal" | "vertical", larguraPx: number): "horizontal" | "vertical" {
  return orientacaoVideo === "vertical" && larguraPx < 950 ? "vertical" : "horizontal";
}

/** Safari (macOS/iPadOS) e qualquer navegador no iOS (todos usam o WebKit da Apple): HLS nativo é o caminho
 *  confiável ali. Em todo o resto, o hls.js é preferido mesmo quando `canPlayType` diz que toca (Chrome/Edge
 *  Android respondem "maybe" e tocam pior). */
export function ehSafariOuIOS(userAgent: string): boolean {
  if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/i.test(userAgent);
}

export type MotorHls = "hlsjs" | "nativo";

/** Quem toca o `.m3u8`: hls.js sempre que suportado (menos no Safari/iOS); `canPlayType` só conta quando o hls.js
 *  não é suportado. Sem nenhum dos dois, tenta o nativo mesmo (melhor que tela preta). */
export function escolherMotorHls(o: { hlsSuportado: boolean; tocaNativo: boolean; safariOuIOS: boolean }): MotorHls {
  if (o.safariOuIOS && o.tocaNativo) return "nativo";
  if (o.hlsSuportado) return "hlsjs";
  return "nativo";
}

/** O vídeo está tocando de verdade, com dados: não pausado, não terminado, `readyState >= 3` (HAVE_FUTURE_DATA) e
 *  sem um `waiting` pendente (marcado no `waiting`, limpo no `playing` ou quando o `timeupdate` avança). Corrigir a
 *  deriva fora disso só empilha seeks num vídeo que ainda está carregando. */
export function tocandoComDados(o: { pausado: boolean; terminou: boolean; readyState: number; esperandoDados: boolean }): boolean {
  return !o.pausado && !o.terminou && o.readyState >= 3 && !o.esperandoDados;
}

/** Tolerância da correção de deriva: atrasado até 8 s ou adiantado até 3 s, deixa tocar. Cada reposicionamento obriga
 *  o player a baixar o vídeo de novo; no iPhone (HLS nativo) isso leva alguns segundos, e com a tolerância antiga
 *  (1 s) e carência de 3 s a correção pulava o vídeo a cada 4 s sem ele nunca terminar de carregar. */
const ATRASO_TOLERADO_SEG = 8;
const ADIANTAMENTO_TOLERADO_SEG = 3;
const CARENCIA_CORRECAO_MS = 15_000;

/** Ao vivo: a correção de deriva (a cada 2 s) só age com o vídeo tocando (inclusive mudo, antes do clique), fora
 *  da carência de 15 s depois da última correção, antes do fim, e só quando o vídeo está fora da tolerância (8 s
 *  atrasado ou 3 s adiantado). Devolve a posição para onde ir, ou `null` se não deve mexer. */
export function correcaoDeDeriva(o: {
  tocando: boolean;
  encerrado: boolean;
  agoraMs: number;
  ultimaCorrecaoMs: number;
  atualSeg: number;
  esperadoSeg: number;
  duracaoSeg: number;
}): number | null {
  if (!o.tocando || o.encerrado) return null;
  if (dentroDaCarencia(o.agoraMs, o.ultimaCorrecaoMs, CARENCIA_CORRECAO_MS)) return null;
  if (o.duracaoSeg > 20 && o.esperadoSeg >= o.duracaoSeg) return null;
  const d = o.atualSeg - o.esperadoSeg;
  return d <= -ATRASO_TOLERADO_SEG || d >= ADIANTAMENTO_TOLERADO_SEG ? o.esperadoSeg : null;
}

/** Confere a posição quando o vídeo começa a tocar de fato (evento `playing`/`timeupdate`). No iPhone, o pulo pro
 *  ponto certo feito logo que os metadados chegam às vezes é ignorado e o vídeo toca do zero — quem atualizava a
 *  página via a aula recomeçar. Longe do alvo (mais de 3 s): devolve o alvo pra reposicionar; perto, ou depois de 3
 *  tentativas (pra nunca ficar em laço), "ok". */
export function conferirPosicaoInicial(o: { atualSeg: number; alvoSeg: number; tentativas: number }): number | "ok" {
  if (Math.abs(o.atualSeg - o.alvoSeg) <= 3 || o.tentativas >= 3) return "ok";
  return o.alvoSeg;
}
