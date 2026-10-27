import { NextResponse } from "next/server";
import { segredosIguais } from "@/src/lib/crypto";
import { envOpcional } from "@/src/lib/env";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { atualizarDoBunny } from "@/src/lib/videos";

type CorpoBunny = { VideoLibraryId?: number; VideoGuid?: string; Status?: number };

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const esperado = envOpcional("BUNNY_WEBHOOK_TOKEN");
  if (!esperado) return NextResponse.json({ error: "não configurado" }, { status: 404 });
  if (!segredosIguais(token, esperado)) return NextResponse.json({ error: "token inválido" }, { status: 401 });

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    // Corpo malformado: nada pra atualizar, mas responde 200 pra o Bunny não ficar repetindo a chamada.
    return NextResponse.json({ ok: true });
  }

  const guid =
    typeof corpo === "object" && corpo !== null && typeof (corpo as CorpoBunny).VideoGuid === "string"
      ? (corpo as CorpoBunny).VideoGuid
      : undefined;
  if (!guid) return NextResponse.json({ ok: true });

  const db = dbAdmin();
  const { data: video } = await db.from("videos").select("id").eq("bunny_guid", guid).maybeSingle();
  // Vídeo desconhecido: ainda responde 200 pra o Bunny não ficar repetindo a chamada.
  if (!video) return NextResponse.json({ ok: true });

  try {
    await atualizarDoBunny((video as { id: string }).id, { db });
  } catch {
    // Falha transitória ao buscar no Bunny: 502 pra o próprio Bunny tentar de novo depois.
    return NextResponse.json({ ok: false }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
