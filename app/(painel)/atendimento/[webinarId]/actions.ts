"use server";
import { validarRespostaAtendente } from "@/src/lib/regras/atendimento";
import { enviarImagem } from "@/src/lib/midias";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { exigirMembro } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string };

// Sem `revalidatePath`: a sala de atendimento é um componente cliente que se atualiza sozinho (Realtime +
// leituras por `GET /api/painel/atendimento/...`) — revalidar só re-renderizaria a página inteira à toa.
// As leituras ficam em route handlers (não em server actions) pra não entrarem na fila das ações de escrita.

const OUTRO_ATENDENTE = "Outra pessoa da equipe já pegou este atendimento.";

/** Quem não está com nenhum humano agora (a IA está respondendo): pode ser pego. */
const COM_A_IA = "atendente_id.is.null,status_atendimento.neq.atendendo";

/** Pega o atendimento de forma atômica: a conversa vai pra coluna Humano e a IA para de responder essa pessoa
 *  (`responderComAgente` pula `atendendo`). Só pega se ninguém da equipe está com ela — se outro atendente pegou
 *  entre a leitura da tela e o clique, a atualização não acerta nenhuma linha. */
export async function assumir(webinarId: string, sessaoId: string): Promise<Resultado> {
  const eu = await exigirMembro();
  const db = dbAdmin();
  const { data, error } = await db
    .from("sessoes")
    .update({ atendente_id: eu.id, status_atendimento: "atendendo" })
    .eq("id", sessaoId)
    .eq("webinar_id", webinarId)
    .or(COM_A_IA)
    .select("id")
    .maybeSingle();
  if (error) return { erro: "Não deu para pegar o atendimento." };
  if (!data) return { erro: OUTRO_ATENDENTE };
  return {};
}

/** Devolve a conversa pra IA (volta pra coluna IA, sem atendente). Quem está atendendo devolve a sua; admin pode
 *  devolver a de qualquer um (atendente que saiu e esqueceu a conversa presa). */
export async function devolverParaIa(webinarId: string, sessaoId: string): Promise<Resultado> {
  const eu = await exigirMembro();
  const db = dbAdmin();
  let query = db
    .from("sessoes")
    .update({ atendente_id: null, status_atendimento: "aguardando" })
    .eq("id", sessaoId)
    .eq("webinar_id", webinarId)
    .eq("status_atendimento", "atendendo");
  if (eu.papel !== "admin") query = query.eq("atendente_id", eu.id);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) return { erro: "Não deu para devolver pra IA." };
  if (!data) return { erro: "Você não está atendendo esta conversa." };
  return {};
}

/** Responde na conversa (texto e/ou imagem). Assume a conversa automaticamente se ninguém atende ainda; recusa
 *  se outro atendente já está atendendo. Na sala a mensagem sai com o nome do agente de IA do webinar (ex.: "Equipe
 *  Sua Empresa"), marcando a pessoa — ver `GET /api/sala/suporte`; no painel aparece também quem respondeu. */
export async function responder(webinarId: string, sessaoId: string, form: FormData): Promise<Resultado> {
  const eu = await exigirMembro();
  const texto = String(form.get("texto") ?? "");
  const arquivo = form.get("imagem");
  const imagem = arquivo instanceof File && arquivo.size > 0 ? arquivo : null;

  const erroValidacao = validarRespostaAtendente(texto, !!imagem);
  if (erroValidacao) return { erro: erroValidacao };

  const db = dbAdmin();
  const { data: sessaoData, error: erroSessao } = await db
    .from("sessoes")
    .select("id, webinar_id, atendente_id, status_atendimento")
    .eq("id", sessaoId)
    .eq("webinar_id", webinarId)
    .maybeSingle();
  if (erroSessao || !sessaoData) return { erro: "Conversa não encontrada." };
  const sessao = sessaoData as { id: string; webinar_id: string; atendente_id: string | null; status_atendimento: string };

  if (sessao.atendente_id && sessao.atendente_id !== eu.id && sessao.status_atendimento === "atendendo") {
    return { erro: "Outro atendente está atendendo esta conversa." };
  }

  // Assume de forma atômica ANTES de subir a imagem (vale também quando eu já sou o atendente — não muda nada
  // nesse caso): se outro atendente assumiu no meio, nada vai pro storage à toa.
  const { data: assumida, error: erroAssumir } = await db
    .from("sessoes")
    .update({ atendente_id: eu.id, status_atendimento: "atendendo" })
    .eq("id", sessaoId)
    .eq("webinar_id", webinarId)
    .or(`atendente_id.eq.${eu.id},${COM_A_IA}`)
    .select("id")
    .maybeSingle();
  if (erroAssumir) return { erro: "Não deu para enviar a mensagem." };
  if (!assumida) return { erro: "Outro atendente está atendendo esta conversa." };

  let imagemUrl: string | null = null;
  if (imagem) {
    const r = await enviarImagem(webinarId, imagem, "chat");
    if ("erro" in r) return { erro: r.erro };
    imagemUrl = r.url;
  }

  const textoTrim = texto.trim();
  const { error: erroInsercao } = await db.from("mensagens_suporte").insert({
    sessao_id: sessaoId,
    webinar_id: webinarId,
    autor: "atendente",
    autor_id: eu.id,
    texto: textoTrim.length > 0 ? textoTrim : null,
    imagem_url: imagemUrl,
  });
  if (erroInsercao) return { erro: "Não deu para enviar a mensagem." };

  return {};
}

/** Edita só as próprias mensagens (`autor = 'atendente' and autor_id = eu`) — nunca uma mensagem de outro
 *  atendente, do participante, do chatbot ou da IA. */
export async function editarMensagem(id: string, texto: string): Promise<Resultado> {
  const eu = await exigirMembro();
  const trim = texto.trim();
  if (trim.length < 1) return { erro: "Escreva uma mensagem." };
  if (trim.length > 1000) return { erro: "A mensagem passa de 1000 caracteres." };

  const db = dbAdmin();
  const { data, error } = await db
    .from("mensagens_suporte")
    .update({ texto: trim, editada: true })
    .eq("id", id)
    .eq("autor", "atendente")
    .eq("autor_id", eu.id)
    .select("id")
    .maybeSingle();
  if (error) return { erro: "Não deu para editar a mensagem." };
  if (!data) return { erro: "Você só pode editar as próprias mensagens." };
  return {};
}

/** Apaga (soft delete) só as próprias mensagens: marca `apagada` e mantém texto/imagem no banco (auditoria; o
 *  check da tabela exige um dos dois) — toda leitura (sala, conversa aberta, lista) esconde o conteúdo. */
export async function apagarMensagem(id: string): Promise<Resultado> {
  const eu = await exigirMembro();
  const db = dbAdmin();
  const { data, error } = await db
    .from("mensagens_suporte")
    .update({ apagada: true })
    .eq("id", id)
    .eq("autor", "atendente")
    .eq("autor_id", eu.id)
    .select("id")
    .maybeSingle();
  if (error) return { erro: "Não deu para apagar a mensagem." };
  if (!data) return { erro: "Você só pode apagar as próprias mensagens." };
  return {};
}
