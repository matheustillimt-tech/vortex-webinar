"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { lerXlsx } from "@/src/lib/planilha";
import { validarTituloNotificacaoCompra, validarVendaSimulada } from "@/src/lib/regras/passos";
import { ERRO_LIMITE_BYTES_PLANILHA, LIMITE_BYTES_PLANILHA, linhasParaVendas } from "@/src/lib/regras/planilha";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { seguirParaProximo } from "../_proximo";

export type Resultado = { erro?: string; ok?: boolean; valores?: Record<string, string> };
export type ResultadoImportacao = { erro?: string; erros?: string[]; importadas?: number };

const LOTE = 500;
const MAX_ERROS_EXIBIDOS = 20;

export async function adicionarVenda(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]),
  );

  const r = validarVendaSimulada(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const db = await dbUsuario();
  const { error } = await db.from("vendas_simuladas").insert({ webinar_id: webinarId, segundo: d.segundo, texto: d.texto });
  if (error) return { erro: "Não deu para adicionar a venda.", valores: campos };

  revalidatePath(`/webinars/${webinarId}/vendas`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "criou", descricao: "Adicionou uma venda simulada" });
  return { ok: true };
}

export async function editarVenda(webinarId: string, itemId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]),
  );

  const r = validarVendaSimulada(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const db = await dbUsuario();
  const { data: atual } = await db.from("vendas_simuladas").select("segundo, texto").eq("id", itemId).eq("webinar_id", webinarId).maybeSingle();
  const depois = { segundo: d.segundo, texto: d.texto };
  const { error } = await db.from("vendas_simuladas").update(depois).eq("id", itemId).eq("webinar_id", webinarId);
  if (error) return { erro: "Não deu para salvar a venda.", valores: campos };

  revalidatePath(`/webinars/${webinarId}/vendas`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: "Editou uma venda simulada", antes: atual, depois });
  return { ok: true };
}

export async function excluirVenda(webinarId: string, form: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const itemId = String(form.get("id") ?? "");
  if (!itemId) return;

  const db = await dbUsuario();
  await db.from("vendas_simuladas").delete().eq("id", itemId).eq("webinar_id", webinarId);

  revalidatePath(`/webinars/${webinarId}/vendas`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "excluiu", descricao: "Excluiu uma venda simulada" });
}

/** Importa um .xlsx (`lerXlsx` → `linhasParaVendas`) e **acrescenta** as vendas válidas (não apaga as
 *  existentes). Se qualquer linha tiver erro, nada é gravado. */
export async function importarVendas(webinarId: string, _prev: ResultadoImportacao, form: FormData): Promise<ResultadoImportacao> {
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

  const { vendas, erros } = linhasParaVendas(linhas);
  if (erros.length > 0) return { erros: erros.slice(0, MAX_ERROS_EXIBIDOS) };
  if (vendas.length === 0) return { erro: "A planilha não tem vendas para importar." };

  const db = await dbUsuario();
  for (let i = 0; i < vendas.length; i += LOTE) {
    const lote = vendas.slice(i, i + LOTE).map((v) => ({ webinar_id: webinarId, segundo: v.segundo, texto: v.texto }));
    const { error } = await db.from("vendas_simuladas").insert(lote);
    if (error) {
      // Lotes anteriores já gravaram: diferente de um erro puro (nada chegou a entrar), isto é um erro parcial.
      if (i > 0) return { erro: "A importação parou no meio: algumas vendas podem ter sido gravadas. Confira a lista." };
      return { erro: "Não deu para importar as vendas." };
    }
  }

  revalidatePath(`/webinars/${webinarId}/vendas`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "criou", descricao: `Importou ${vendas.length} vendas simuladas` });
  return { importadas: vendas.length };
}

export async function apagarVendas(webinarId: string): Promise<{ erro?: string }> {
  const eu = await exigirAdmin();
  const db = await dbUsuario();
  const { count } = await db.from("vendas_simuladas").select("id", { count: "exact", head: true }).eq("webinar_id", webinarId);
  const { error } = await db.from("vendas_simuladas").delete().eq("webinar_id", webinarId);
  if (error) return { erro: "Não deu para apagar as vendas." };

  revalidatePath(`/webinars/${webinarId}/vendas`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "excluiu", descricao: `Apagou ${count ?? 0} vendas simuladas` });
  return {};
}

export async function salvarTituloNotificacaoCompra(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]),
  );

  const r = validarTituloNotificacaoCompra(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const db = await dbUsuario();
  const { data: atual } = await db.from("webinars").select("titulo_notificacao_compra").eq("id", webinarId).maybeSingle();
  const { error } = await db.from("webinars").update({ titulo_notificacao_compra: d.titulo }).eq("id", webinarId);
  if (error) return { erro: "Não deu para salvar o título.", valores: campos };

  revalidatePath(`/webinars/${webinarId}/vendas`);
  await registrarAuditoria({
    usuarioId: eu.id,
    webinarId,
    acao: "editou",
    descricao: "Editou o título da notificação de compra",
    antes: atual,
    depois: { titulo_notificacao_compra: d.titulo },
  });
  seguirParaProximo(form, webinarId);
  return { ok: true };
}
