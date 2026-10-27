import "server-only";
import { createHash } from "node:crypto";

export type CfgBunny = { libraryId: string; apiKey: string; cdnHost: string };
export type VideoBunny = { guid: string; status: number; length: number; thumbnailFileName: string | null; storageSize: number; encodeProgress: number };

const API = "https://video.bunnycdn.com";

async function chamar(cfg: CfgBunny, caminho: string, init: RequestInit, f: typeof fetch): Promise<Response> {
  const r = await f(`${API}/library/${cfg.libraryId}${caminho}`, {
    ...init,
    headers: { AccessKey: cfg.apiKey, accept: "application/json", "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
  return r;
}

async function exigirOk(r: Response, acao: string): Promise<void> {
  if (!r.ok) throw new Error(`Bunny recusou ${acao} (HTTP ${r.status}).`);
}

export async function criarVideoBunny(cfg: CfgBunny, titulo: string, f: typeof fetch = fetch): Promise<{ guid: string }> {
  const r = await chamar(cfg, "/videos", { method: "POST", body: JSON.stringify({ title: titulo }) }, f);
  await exigirOk(r, "criar o vídeo");
  const d = (await r.json()) as { guid: string };
  return { guid: d.guid };
}

export async function obterVideoBunny(cfg: CfgBunny, guid: string, f: typeof fetch = fetch): Promise<VideoBunny> {
  const r = await chamar(cfg, `/videos/${guid}`, { method: "GET" }, f);
  await exigirOk(r, "ler o vídeo");
  const d = (await r.json()) as VideoBunny;
  return { guid: d.guid, status: d.status, length: d.length, thumbnailFileName: d.thumbnailFileName ?? null, storageSize: d.storageSize, encodeProgress: d.encodeProgress };
}

export async function renomearVideoBunny(cfg: CfgBunny, guid: string, titulo: string, f: typeof fetch = fetch): Promise<void> {
  await exigirOk(await chamar(cfg, `/videos/${guid}`, { method: "POST", body: JSON.stringify({ title: titulo }) }, f), "renomear o vídeo");
}

export async function excluirVideoBunny(cfg: CfgBunny, guid: string, f: typeof fetch = fetch): Promise<void> {
  const r = await chamar(cfg, `/videos/${guid}`, { method: "DELETE" }, f);
  if (r.status === 404) return;
  await exigirOk(r, "excluir o vídeo");
}

/** O navegador envia direto ao Bunny com esta assinatura (vale até `expiraEm`, segundos Unix). */
export function assinaturaTus(cfg: CfgBunny, guid: string, expiraEm: number) {
  return {
    endpoint: `${API}/tusupload`,
    assinatura: createHash("sha256").update(`${cfg.libraryId}${cfg.apiKey}${expiraEm}${guid}`).digest("hex"),
    expira: expiraEm,
    libraryId: cfg.libraryId,
    videoId: guid,
  };
}

export function urlsBunny(cfg: CfgBunny, guid: string, thumbnailFileName: string | null) {
  const base = `https://${cfg.cdnHost}/${guid}`;
  return {
    hls: `${base}/playlist.m3u8`,
    miniatura: thumbnailFileName ? `${base}/${thumbnailFileName}` : null,
    original: `${base}/original`,
    // MP4 de baixa resolução (360p) só pra extrair áudio (geração de chat por IA) — exige "MP4 Fallback" ligado
    // na biblioteca do Bunny; sem isso, essa URL 404.
    audio: `${base}/play_360p.mp4`,
  };
}
