"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { iniciarGeracao } from "@/src/lib/geracao";
import { lerXlsx } from "@/src/lib/planilha";
import { validarMensagemSimulada, validarOpcoesGeracao } from "@/src/lib/regras/passos";
import { ERRO_LIMITE_BYTES_PLANILHA, LIMITE_BYTES_PLANILHA, linhasParaMensagens } from "@/src/lib/regras/planilha";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; ok?: boolean; valores?: Record<string, string> };
export type ResultadoImportacao = { erro?: string; erros?: string[]; importadas?: number };
export type ResultadoGeracao = { erro?: string; ok?: boolean; valores?: Record<string, string> };

/** Pedido de uma geração nova de chat por IA (cartão "Gerar chat com IA"): valida as opções do formulário e
 *  entrega pra `iniciarGeracao` — a lógica de "IA desligada", "vídeo sem fonte válida" e "já tem uma geração em
 *  andamento" fica toda lá. O cron (`/api/cron/ia`) é quem de fato processa a partir daqui. */
export async function iniciarGeracaoAction(webinarId: string, _prev: ResultadoGeracao, form: FormData): Promise<ResultadoGeracao> {
  const eu = await exigirAdmin();
  const campos = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]),
  );

  const r = validarOpcoesGeracao(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };

  const resultado = await iniciarGeracao(webinarId, r.dados);
  if ("erro" in resultado) return { erro: resultado.erro, valores: campos };

  revalidatePath(`/webinars/${webinarId}/chat`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "criou", descricao: "Iniciou uma geração de chat por IA" });
  return { ok: true };
}

const LOTE = 500;
const MAX_ERROS_EXIBIDOS = 20;

export async function adicionarMensagem(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]),
  );

  const r = validarMensagemSimulada(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const db = await dbUsuario();
  const { error } = await db
    .from("mensagens_simuladas")
    .insert({ webinar_id: webinarId, segundo: d.segundo, nome: d.nome, texto: d.texto, suporte: d.suporte });
  if (error) return { erro: "Não deu para adicionar a mensagem.", valores: campos };

  revalidatePath(`/webinars/${webinarId}/chat`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "criou", descricao: "Adicionou uma mensagem no chat simulado" });
  return { ok: true };
}

export async function editarMensagem(webinarId: string, itemId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]),
  );

  const r = validarMensagemSimulada(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const db = await dbUsuario();
  const { data: atual } = await db
    .from("mensagens_simuladas")
    .select("segundo, nome, texto, suporte")
    .eq("id", itemId)
    .eq("webinar_id", webinarId)
    .maybeSingle();
  const depois = { segundo: d.segundo, nome: d.nome, texto: d.texto, suporte: d.suporte };
  const { error } = await db.from("mensagens_simuladas").update(depois).eq("id", itemId).eq("webinar_id", webinarId);
  if (error) return { erro: "Não deu para salvar a mensagem.", valores: campos };

  revalidatePath(`/webinars/${webinarId}/chat`);
  await registrarAuditoria({
    usuarioId: eu.id,
    webinarId,
    acao: "editou",
    descricao: "Editou uma mensagem do chat simulado",
    antes: atual,
    depois,
  });
  return { ok: true };
}

export async function excluirMensagem(webinarId: string, form: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const itemId = String(form.get("id") ?? "");
  if (!itemId) return;

  const db = await dbUsuario();
  await db.from("mensagens_simuladas").delete().eq("id", itemId).eq("webinar_id", webinarId);

  revalidatePath(`/webinars/${webinarId}/chat`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "excluiu", descricao: "Excluiu uma mensagem do chat simulado" });
}

/** Importa um .xlsx (`lerXlsx` → `linhasParaMensagens`) e **acrescenta** as mensagens válidas (não apaga as
 *  existentes). Se qualquer linha tiver erro, nada é gravado. */
export async function importarMensagens(webinarId: string, _prev: ResultadoImportacao, form: FormData): Promise<ResultadoImportacao> {
  const eu = await exigirAdmin();

  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: "Escolha um arquivo .xlsx." };
  if (arquivo.size > LIMITE_BYTES_PLANILHA) return { erro: ERRO_LIMITE_BYTES_PLANILHA };

  let linhas: unknown[][];
  try {
    const buf = await arquivo.arrayBuffer();
    linhas = await lerXlsx(buf);
  } catch {
    return { erro: "Não deu para ler a planilha." };
  }

  const { mensagens, erros } = linhasParaMensagens(linhas);
  if (erros.length > 0) return { erros: erros.slice(0, MAX_ERROS_EXIBIDOS) };
  if (mensagens.length === 0) return { erro: "A planilha não tem mensagens para importar." };

  const db = await dbUsuario();
  for (let i = 0; i < mensagens.length; i += LOTE) {
    const lote = mensagens
      .slice(i, i + LOTE)
      .map((m) => ({ webinar_id: webinarId, segundo: m.segundo, nome: m.nome, texto: m.texto, suporte: m.suporte }));
    const { error } = await db.from("mensagens_simuladas").insert(lote);
    if (error) {
      // Lotes anteriores já gravaram: diferente de um erro puro (nada chegou a entrar), isto é um erro parcial.
      if (i > 0) return { erro: "A importação parou no meio: algumas mensagens podem ter sido gravadas. Confira a lista." };
      return { erro: "Não deu para importar as mensagens." };
    }
  }

  revalidatePath(`/webinars/${webinarId}/chat`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "criou", descricao: `Importou ${mensagens.length} mensagens do chat` });
  return { importadas: mensagens.length };
}

export async function apagarChat(webinarId: string): Promise<{ erro?: string }> {
  const eu = await exigirAdmin();
  const db = await dbUsuario();
  const { count } = await db.from("mensagens_simuladas").select("id", { count: "exact", head: true }).eq("webinar_id", webinarId);
  const { error } = await db.from("mensagens_simuladas").delete().eq("webinar_id", webinarId);
  if (error) return { erro: "Não deu para apagar o chat." };

  revalidatePath(`/webinars/${webinarId}/chat`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "excluiu", descricao: `Apagou ${count ?? 0} mensagens do chat simulado` });
  return {};
}
