import { NextResponse } from "next/server";
import { carregarConversa } from "@/src/lib/atendimento";
import { idValido } from "@/src/lib/regras/midia";
import { dbUsuario, membroApi } from "@/src/lib/supabase/usuario";
import { sessaoConversaParaCliente } from "@/app/(painel)/atendimento/[webinarId]/_sala/types";

/** `GET`: a conversa aberta (sessão + mensagens; apagada vem sem conteúdo). Route handler pra não entrar na fila
 *  das server actions de escrita. Qualquer membro ativo — 401 sem login; 404 se a sessão não for deste webinar. */
export async function GET(_req: Request, { params }: { params: Promise<{ webinarId: string; sessaoId: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "Acesso negado." }, { status: 401 });

  const { webinarId, sessaoId } = await params;
  if (!idValido(webinarId) || !idValido(sessaoId)) return NextResponse.json({ erro: "Parâmetros inválidos." }, { status: 400 });

  try {
    const db = await dbUsuario();
    const r = await carregarConversa(db, sessaoId);
    if (!r || r.sessao.webinarId !== webinarId) return NextResponse.json({ erro: "Conversa não encontrada." }, { status: 404 });
    return NextResponse.json({ sessao: sessaoConversaParaCliente(r.sessao), mensagens: r.mensagens });
  } catch {
    return NextResponse.json({ erro: "Não deu para carregar a conversa." }, { status: 500 });
  }
}
