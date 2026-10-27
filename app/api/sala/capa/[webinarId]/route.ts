import { bunnyConfig } from "@/src/lib/env";
import { urlsBunny } from "@/src/lib/bunny/cliente";
import { idValido } from "@/src/lib/regras/midia";
import { dbAdmin } from "@/src/lib/supabase/admin";

type LinhaVideo = { origem: "bunny" | "externo"; bunny_guid: string | null; thumb_url: string | null };

const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

/** Capa animada da sala: a prévia que o Bunny gera do começo do vídeo (`preview.webp`, animada), ou a miniatura
 *  (`thumbnail.jpg`) se não houver prévia. Servida pelo próprio domínio da sala porque o CDN do Bunny só entrega com
 *  `Referer` do domínio liberado, e no iPhone (aba anônima, aberto pelo WhatsApp) a imagem chegava preta. Fica no
 *  cache da Vercel (1 dia). Vídeo externo: redireciona pra miniatura cadastrada, se houver. */
export async function GET(_req: Request, { params }: { params: Promise<{ webinarId: string }> }) {
  const { webinarId } = await params;
  if (!idValido(webinarId)) return new Response(null, { status: 404 });

  const db = dbAdmin();
  const { data: wv } = await db.from("webinar_video").select("video_id").eq("webinar_id", webinarId).maybeSingle();
  if (!wv) return new Response(null, { status: 404 });
  const { data } = await db.from("videos").select("origem, bunny_guid, thumb_url").eq("id", (wv as { video_id: string }).video_id).maybeSingle();
  const video = data as LinhaVideo | null;
  if (!video) return new Response(null, { status: 404 });

  if (video.origem !== "bunny" || !video.bunny_guid) {
    return video.thumb_url && /^https:\/\//i.test(video.thumb_url) ? Response.redirect(video.thumb_url, 302) : new Response(null, { status: 404 });
  }
  const cfg = bunnyConfig();
  if (!cfg) return new Response(null, { status: 404 });

  const base = urlsBunny(cfg, video.bunny_guid, null).hls.replace(/\/playlist\.m3u8$/, "");
  const referer = process.env.SALA_URL ?? process.env.NEXT_PUBLIC_SALA_URL ?? "";
  for (const arquivo of ["preview.webp", "thumbnail.jpg"]) {
    const resp = await fetch(`${base}/${arquivo}`, { headers: referer ? { Referer: `${referer.replace(/\/$/, "")}/` } : {} });
    if (resp.ok && resp.body) {
      return new Response(resp.body, {
        headers: { "Content-Type": resp.headers.get("content-type") ?? "image/webp", "Cache-Control": CACHE },
      });
    }
  }
  return new Response(null, { status: 404 });
}
