import { NextResponse } from "next/server";
import { assistidoPorSessao, contarParticipantesOnline, listarConversas, listarTurmas } from "@/src/lib/atendimento";
import { turmaValida } from "@/src/lib/regras/atendimento";
import { idValido } from "@/src/lib/regras/midia";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario, membroApi } from "@/src/lib/supabase/usuario";
import { conversaParaCliente } from "@/app/(painel)/atendimento/[webinarId]/_sala/types";

/** `GET`: lista de conversas do webinar (300 mais recentes; com `?turma=YYYY-MM-DD`, só as daquela turma, e junto a
 *  lista de turmas pro seletor de histórico) pra sala de atendimento recarregar quando o Realtime
 *  avisa (e a cada 20 s). Route handler, não server action: leitura não entra na fila das ações de escrita. Qualquer
 *  membro ativo (admin ou atendente) — 401 sem login. Lê com o cliente do membro (RLS vale). `online` é o mesmo
 *  número do painel Ao vivo (todo mundo na sala, não só quem conversa). */
export async function GET(req: Request, { params }: { params: Promise<{ webinarId: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "Acesso negado." }, { status: 401 });

  const { webinarId } = await params;
  const turma = new URL(req.url).searchParams.get("turma");
  if (!idValido(webinarId) || (turma !== null && !turmaValida(turma))) return NextResponse.json({ erro: "Parâmetros inválidos." }, { status: 400 });

  try {
    const db = await dbUsuario();
    if (turma === null) {
      const [conversas, online] = await Promise.all([listarConversas(db, webinarId), contarParticipantesOnline(dbAdmin(), webinarId)]);
      const assistido = await assistidoPorSessao(dbAdmin(), webinarId, conversas.map((c) => c.sessaoId));
      return NextResponse.json({ conversas: conversas.map((c) => conversaParaCliente(c, assistido)), online });
    }
    const [conversas, online, turmas] = await Promise.all([
      listarConversas(db, webinarId, new Date(), turma),
      contarParticipantesOnline(dbAdmin(), webinarId),
      listarTurmas(db, webinarId),
    ]);
    const assistido = await assistidoPorSessao(dbAdmin(), webinarId, conversas.map((c) => c.sessaoId));
    return NextResponse.json({ conversas: conversas.map((c) => conversaParaCliente(c, assistido)), online, turmas });
  } catch {
    return NextResponse.json({ erro: "Não deu para carregar as conversas." }, { status: 500 });
  }
}
