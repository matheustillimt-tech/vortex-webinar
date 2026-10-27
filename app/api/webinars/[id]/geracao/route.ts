import { NextResponse } from "next/server";
import { dbUsuario, membroApi } from "@/src/lib/supabase/usuario";

type LinhaGeracao = {
  status: "fila" | "transcrevendo" | "gerando" | "pronto" | "erro";
  bloco_atual: number;
  total_blocos: number | null;
  mensagens_geradas: number;
  erro: string | null;
};

/** `GET`: a última geração de chat por IA do webinar (admin só), pro cartão "Gerar chat com IA" acompanhar o
 *  andamento com polling a cada 5 s. Sem nenhuma geração ainda, devolve `{ geracao: null }`. Nunca busca a coluna
 *  `blocos` (jsonb com a transcrição inteira) — só `total_blocos`, que o próprio cron já mantém atualizado. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membro = await membroApi();
  if (!membro || membro.papel !== "admin") return NextResponse.json({ erro: "Só administradores podem fazer isso." }, { status: 403 });

  const { id } = await params;
  const db = await dbUsuario();
  const { data } = await db
    .from("geracoes_chat")
    .select("status, bloco_atual, total_blocos, mensagens_geradas, erro")
    .eq("webinar_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return NextResponse.json({ geracao: null });
  const l = data as LinhaGeracao;
  return NextResponse.json({
    geracao: {
      status: l.status,
      blocoAtual: l.bloco_atual,
      totalBlocos: l.total_blocos,
      mensagensGeradas: l.mensagens_geradas,
      erro: l.erro,
    },
  });
}
