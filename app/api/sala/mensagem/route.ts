import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { autenticarSala, corpoJson, respostaErro } from "@/src/lib/sala/api";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { carregarSalaPorId } from "@/src/lib/sala/dados";
import { ehConflito } from "@/src/lib/sala/sessao";
import { urlImagemChatValida } from "@/src/lib/regras/midia";
import { env } from "@/src/lib/env";
import { responderComAgente } from "@/src/lib/agente";
import { temLinkProibido } from "@/src/lib/regras/chat-links";

const LIMITE_ENTRE_MENSAGENS_MS = 2000;
const TAMANHO_MAXIMO = 400;

/** O agente de IA roda depois da resposta (`after()`); sem isso, a Vercel corta a função em 10 s (free/hobby) ou
 *  15 s (padrão do plano pago) e o `after()` nunca termina de responder. */
export const maxDuration = 60;

type LinhaUltimaMensagem = { created_at: string };
type LinhaMensagemInserida = { id: string; texto: string | null; imagem_url: string | null; created_at: string };

/** Mensagem do chat da sala (só a própria pessoa vê), com uma imagem opcional (botão de clipe — até 3 MB, enviada antes por
 *  `POST /api/sala/imagem`). Sessão provisória (acesso facilitado/cadastro incompleto) não pode enviar — 403 com
 *  `precisaCadastro: true`, tem que se cadastrar primeiro (`/api/sala/cadastro`). Replay: 403 (comentários
 *  desativados). Teste: "ok" falso, sem gravar nada. Limite de 1 mensagem a cada 2 s por sessão. Quem responde
 *  sozinho é o agente de IA (`responderComAgente`, depois da resposta HTTP). */
export async function POST(req: Request) {
  const corpo = await corpoJson(req);
  if (!corpo || typeof corpo !== "object") return respostaErro("Corpo inválido.", 400);
  const { w, texto, imagemUrl } = corpo as Record<string, unknown>;

  const auth = await autenticarSala(w);
  if ("erro" in auth) return auth.erro;

  if (typeof texto !== "string") return respostaErro("Texto inválido.", 400);
  const textoTrim = texto.trim();
  if (textoTrim.length > TAMANHO_MAXIMO) return respostaErro("Texto inválido.", 400);

  // Link no chat: só o da oferta. Vale também no modo teste, pra o produtor ver o bloqueio funcionando.
  if (textoTrim && temLinkProibido(textoTrim, (await carregarSalaPorId(auth.sessao.webinarId))?.oferta?.link ?? null)) {
    return NextResponse.json({ erro: "Links não são permitidos no chat.", codigo: "link" }, { status: 403 });
  }

  // Modo teste não grava nada (nem mensagem, nem evento) e não bate a `imagemUrl` contra o bucket real — o
  // `POST /api/sala/imagem` em modo teste devolve uma URL de mentira, que nunca passaria em `urlImagemChatValida`.
  // Devolve um "ok" com o próprio texto/imagem, pra a sala do produtor funcionar igual.
  if (auth.sessao.modo === "teste") {
    return NextResponse.json({
      id: `teste-${randomUUID()}`,
      texto: textoTrim || null,
      imagemUrl: typeof imagemUrl === "string" ? imagemUrl : null,
      criadaEm: new Date().toISOString(),
    });
  }

  let imagemUrlValida: string | null = null;
  if (imagemUrl !== undefined && imagemUrl !== null) {
    if (typeof imagemUrl !== "string" || !urlImagemChatValida(imagemUrl, auth.sessao.webinarId, env("NEXT_PUBLIC_SUPABASE_URL"))) {
      return respostaErro("Imagem inválida.", 400);
    }
    imagemUrlValida = imagemUrl;
  }
  // Sem texto e sem imagem: nada pra enviar.
  if (textoTrim.length < 1 && !imagemUrlValida) return respostaErro("Texto inválido.", 400);

  if (auth.sessao.modo === "replay") return respostaErro("Comentários desativados no replay.", 403);
  if (auth.sessao.temporario) return NextResponse.json({ erro: "Cadastre-se para enviar mensagens.", precisaCadastro: true }, { status: 403 });

  const db = dbAdmin();

  const { data: ultima } = await db
    .from("mensagens_suporte")
    .select("created_at")
    .eq("sessao_id", auth.sessao.sessaoId)
    .eq("autor", "participante")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const linhaUltima = ultima as LinhaUltimaMensagem | null;
  if (linhaUltima && Date.now() - new Date(linhaUltima.created_at).getTime() < LIMITE_ENTRE_MENSAGENS_MS) {
    return respostaErro("Aguarde um instante para enviar outra mensagem.", 429);
  }

  const { data: inserida, error: erroInsercao } = await db
    .from("mensagens_suporte")
    .insert({
      sessao_id: auth.sessao.sessaoId,
      webinar_id: auth.sessao.webinarId,
      autor: "participante",
      texto: textoTrim.length > 0 ? textoTrim : null,
      imagem_url: imagemUrlValida,
    })
    .select("id, texto, imagem_url, created_at")
    .single();
  if (erroInsercao || !inserida) return respostaErro("Não deu para enviar a mensagem.", 500);

  const { error: erroEvento } = await db
    .from("eventos")
    .insert({ sessao_id: auth.sessao.sessaoId, webinar_id: auth.sessao.webinarId, tipo: "mensagem_chat" });
  // Conflito (já tinha um evento mensagem_chat pra essa sessão) é esperado; qualquer outro erro no evento não
  // derruba a mensagem — ela já foi gravada e é o que a pessoa está esperando ver.
  void (erroEvento && !ehConflito(erroEvento));

  // Mensagem nova numa conversa já encerrada (atendido) ou dispensada: reabre — volta pra fila "Sem atendimento"
  // sem atendente, pra alguém responder. "atendendo" fica como está (o atendente atual continua). Falha aqui não
  // derruba a mensagem, que já foi gravada; a pior consequência é a conversa continuar na aba de antes.
  await db
    .from("sessoes")
    .update({ status_atendimento: "aguardando", atendente_id: null })
    .eq("id", auth.sessao.sessaoId)
    .in("status_atendimento", ["atendido", "dispensado"]);

  // Depois da resposta HTTP (`after`): o agente de IA decide, sozinho, se responde a esta mensagem (ver
  // `responderComAgente` — nunca lança, qualquer falha só vira log). Só mensagem com texto tem o que responder.
  if (textoTrim.length > 0) {
    after(() =>
      responderComAgente({
        sessaoId: auth.sessao.sessaoId,
        webinarId: auth.sessao.webinarId,
        texto: textoTrim,
        mensagemId: inserida.id,
      }),
    );
  }

  const linha = inserida as LinhaMensagemInserida;
  return NextResponse.json({ id: linha.id, texto: linha.texto, imagemUrl: linha.imagem_url, criadaEm: linha.created_at });
}
