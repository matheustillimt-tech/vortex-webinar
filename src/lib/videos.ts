import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type CfgBunny, obterVideoBunny, urlsBunny } from "./bunny/cliente";
import { bunnyConfig } from "./env";
import { duracaoDaPlaylist, primeiraVariante, statusDoBunny, type StatusVideo } from "./regras/video";
import { dbAdmin } from "./supabase/admin";

/** Busca o vídeo no Bunny pelo `bunny_guid` salvo e atualiza a linha em `videos` com o que voltar. */
export async function atualizarDoBunny(
  videoId: string,
  deps?: { db?: SupabaseClient; cfg?: CfgBunny; f?: typeof fetch },
): Promise<StatusVideo> {
  const db = deps?.db ?? dbAdmin();
  const cfg = deps?.cfg ?? bunnyConfig();
  if (!cfg) throw new Error("Bunny Stream não está configurado.");

  const { data: video } = await db.from("videos").select("bunny_guid, status").eq("id", videoId).single();
  const registro = video as { bunny_guid: string; status?: StatusVideo } | null;
  const guid = registro?.bunny_guid;
  if (!guid) throw new Error("Vídeo sem bunny_guid.");

  const v = await obterVideoBunny(cfg, guid, deps?.f ?? fetch);
  let status = statusDoBunny(v.status);
  // Nunca volta de "pronto" pra um status anterior (processando/enviando): só o Bunny reportando erro de fato regride.
  if (registro?.status === "pronto" && status !== "erro") status = "pronto";
  const urls = urlsBunny(cfg, guid, v.thumbnailFileName);

  const atualizacao: Record<string, unknown> = {
    status,
    progresso: v.encodeProgress,
    duracao_seg: v.length,
    hls_url: urls.hls,
    thumb_url: urls.miniatura,
  };
  // storageSize zerado é o Bunny ainda sem o arquivo pronto pra contar; não apaga um valor bom já salvo.
  if (v.storageSize > 0) atualizacao.bytes = v.storageSize;

  await db.from("videos").update(atualizacao).eq("id", videoId);

  return status;
}

const LIMITE_PLAYLIST_BYTES = 2 * 1024 * 1024;

/** Lê o corpo como texto, mas desiste (devolve null) se passar de `limite` bytes — playlist nunca devia chegar lá. */
async function lerPlaylistComLimite(r: Response, limite = LIMITE_PLAYLIST_BYTES): Promise<string | null> {
  const tamanho = r.headers.get("content-length");
  if (tamanho && Number(tamanho) > limite) return null;

  if (!r.body) return r.text();

  const leitor = r.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel();
      return null;
    }
    pedacos.push(value);
  }
  return Buffer.concat(pedacos.map((p) => Buffer.from(p))).toString("utf8");
}

function ehHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Duração de um vídeo externo: HLS soma a playlist (seguindo a primeira variante se for master); MP4 não dá pra saber. */
export async function duracaoExterna(url: string, tipo: "hls" | "mp4", f: typeof fetch = fetch): Promise<number | null> {
  if (tipo === "mp4") return null;
  try {
    const r = await f(url, { signal: AbortSignal.timeout(8000), redirect: "manual" });
    if (!r.ok || (r.status >= 300 && r.status < 400) || r.type === "opaqueredirect") return null;
    let texto = await lerPlaylistComLimite(r);
    if (texto === null) return null;

    if (texto.includes("#EXT-X-STREAM-INF")) {
      const variante = primeiraVariante(texto, url);
      if (!variante || !ehHttps(variante)) return null;
      const r2 = await f(variante, { signal: AbortSignal.timeout(8000), redirect: "manual" });
      if (!r2.ok || (r2.status >= 300 && r2.status < 400) || r2.type === "opaqueredirect") return null;
      texto = await lerPlaylistComLimite(r2);
      if (texto === null) return null;
    }

    return duracaoDaPlaylist(texto);
  } catch {
    return null;
  }
}
