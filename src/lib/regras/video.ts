export type StatusVideo = "enviando" | "processando" | "pronto" | "erro";

/** Códigos do Bunny Stream: 0 criado, 1 enviado, 2 processando, 3 convertendo, 4 pronto, 5 erro, 6 falha no envio,
 *  7 e 8 segmentando sob demanda. */
export function statusDoBunny(codigo: number): StatusVideo {
  if (codigo === 0 || codigo === 1) return "enviando";
  if ([2, 3, 7, 8].includes(codigo)) return "processando";
  if (codigo === 4) return "pronto";
  return "erro";
}

export function validarUrlVideo(url: string): { tipo: "hls" | "mp4" } | { erro: string } {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return { erro: "Link inválido." };
  }
  if (u.protocol !== "https:") return { erro: "Use um link https." };
  const caminho = u.pathname.toLowerCase();
  if (caminho.endsWith(".m3u8")) return { tipo: "hls" };
  if (caminho.endsWith(".mp4")) return { tipo: "mp4" };
  return { erro: "O link precisa terminar em .m3u8 ou .mp4." };
}

export function duracaoDaPlaylist(texto: string): number {
  let total = 0;
  for (const m of texto.matchAll(/#EXTINF:([\d.]+)/g)) total += Number(m[1]);
  return Math.floor(total);
}

export function primeiraVariante(master: string, base: string): string | null {
  const linhas = master.split(/\r?\n/).map((l) => l.trim());
  const i = linhas.findIndex((l) => l.startsWith("#EXT-X-STREAM-INF"));
  if (i < 0) return null;
  const caminho = linhas.slice(i + 1).find((l) => l && !l.startsWith("#"));
  return caminho ? new URL(caminho, base).toString() : null;
}

export function lerDuracao(texto: string): number | null {
  const partes = texto.trim().split(":");
  if (partes.length < 2 || partes.length > 3 || partes.some((p) => !/^\d+$/.test(p))) return null;
  const n = partes.map(Number);
  const [h, m, s] = n.length === 3 ? n : [0, n[0], n[1]];
  if (s > 59 || (n.length === 3 && m > 59)) return null;
  return h * 3600 + m * 60 + s;
}

/** Baixar um vídeo do Bunny só faz sentido com arquivo já no CDN: pronto (encodado) ou ainda processando (original já subiu). */
export function podeBaixarBunny(status: StatusVideo): boolean {
  return status === "pronto" || status === "processando";
}

/** Link externo só dá pra "baixar" de fato quando é um arquivo (.mp4); HLS (.m3u8) é streaming, não tem o que baixar. */
export function podeBaixarExterno(url: string | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".mp4");
  } catch {
    return false;
  }
}

export function formatarDuracao(seg: number): string {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  const dd = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${dd(m)}:${dd(s)}` : `${m}:${dd(s)}`;
}

/** MB abaixo de 1 GB; GB com uma casa decimal a partir daí. */
export function formatarTamanho(bytes: number | null): string | null {
  if (!bytes) return null;
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1).replace(".", ",")} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}
