import { NextResponse } from "next/server";
import { autenticarSala, respostaErro } from "@/src/lib/sala/api";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { enviarImagem } from "@/src/lib/midias";

const LIMITE_ENTRE_IMAGENS_MS = 10_000;

/** Imagem da aba Suporte/Chat (botão de clipe): sobe pro bucket `midias`, pasta `webinars/<webinarId>/chat/`, e
 *  devolve só a URL — quem grava a mensagem (com essa URL) é `POST /api/sala/mensagem`. Sessão provisória
 *  (precisa se cadastrar primeiro) e replay (comentários desativados) não podem enviar; teste não sobe nada de
 *  verdade. Limite de 1 imagem a cada 10 s por sessão: `update sessoes set ultima_imagem_em = now() where id = ?
 *  and (ultima_imagem_em is null or ultima_imagem_em < agora - 10s)` — atômico (uma corrida de dois uploads ao
 *  mesmo tempo nunca passa os dois), em vez de olhar a última mensagem com imagem (burlável subindo sem nunca
 *  mandar a mensagem). */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return respostaErro("Corpo inválido.", 400);

  const auth = await autenticarSala(form.get("w"));
  if ("erro" in auth) return auth.erro;

  if (auth.sessao.modo === "teste") {
    return NextResponse.json({ url: "https://teste.local/midias/imagem-de-teste.jpg" });
  }
  if (auth.sessao.modo === "replay") return respostaErro("Comentários desativados no replay.", 403);
  if (auth.sessao.temporario) return NextResponse.json({ erro: "Cadastre-se para enviar mensagens.", precisaCadastro: true }, { status: 403 });

  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return respostaErro("Envie uma imagem.", 400);

  const db = dbAdmin();
  const agora = new Date();
  const limite = new Date(agora.getTime() - LIMITE_ENTRE_IMAGENS_MS).toISOString();
  const { data: liberada, error: erroLimite } = await db
    .from("sessoes")
    .update({ ultima_imagem_em: agora.toISOString() })
    .eq("id", auth.sessao.sessaoId)
    .or(`ultima_imagem_em.is.null,ultima_imagem_em.lt.${limite}`)
    .select("id");
  if (erroLimite) return respostaErro("Não deu para enviar a imagem.", 500);
  if (!liberada || liberada.length === 0) return respostaErro("Aguarde um instante para enviar outra imagem.", 429);

  const resultado = await enviarImagem(auth.sessao.webinarId, arquivo, "chat");
  if ("erro" in resultado) return respostaErro(resultado.erro, 400);

  return NextResponse.json({ url: resultado.url });
}
