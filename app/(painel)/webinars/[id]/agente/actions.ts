"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { testarAgente as testarAgenteLib } from "@/src/lib/agente";
import { validarAgente } from "@/src/lib/regras/passos";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { seguirParaProximo } from "../_proximo";

export type Resultado = { erro?: string; ok?: boolean; valores?: Record<string, string> };
export type ResultadoPlayground = { erro?: string; resposta?: string | null };

export async function salvarAgente(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]),
  );

  const r = validarAgente(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const db = await dbUsuario();
  const { data: atual } = await db.from("agentes_ia").select("ligado, nome, instrucoes, contexto, faq").eq("webinar_id", webinarId).maybeSingle();

  const depois = { webinar_id: webinarId, ligado: d.ligado, nome: d.nome, instrucoes: d.instrucoes, contexto: d.contexto, faq: d.faq };
  const { error } = await db.from("agentes_ia").upsert(depois, { onConflict: "webinar_id" });
  if (error) return { erro: "Não deu para salvar o agente.", valores: campos };

  revalidatePath(`/webinars/${webinarId}/agente`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: "Editou o agente de IA", antes: atual, depois });
  seguirParaProximo(form, webinarId);
  return { ok: true, valores: campos };
}

/** Playground: testa a mesma lógica do agente (`testarAgente`) com os campos ainda não salvos do formulário, sem
 *  gravar nada. */
export async function testarAgente(form: FormData): Promise<ResultadoPlayground> {
  await exigirAdmin();

  const pergunta = String(form.get("pergunta") ?? "").trim();
  if (!pergunta) return { erro: "Escreva uma pergunta para testar." };

  const cfg = {
    nome: String(form.get("nome") ?? "") || null,
    instrucoes: String(form.get("instrucoes") ?? "") || null,
    contexto: String(form.get("contexto") ?? "") || null,
    faq: String(form.get("faq") ?? "") || null,
  };

  const r = await testarAgenteLib(cfg, pergunta);
  return { resposta: r.resposta, erro: r.erro };
}
