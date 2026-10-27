"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { cifrar, segredoAleatorio } from "@/src/lib/crypto";
import type { Plataforma } from "@/src/lib/regras/checkout";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; ok?: boolean; valores?: Record<string, string> };

const PLATAFORMAS: Plataforma[] = ["vortexpay", "kiwify", "hotmart", "eduzz", "hubla", "themembers"];

function caminho(): string {
  return "/configuracoes";
}

function ehPlataforma(v: string): v is Plataforma {
  return (PLATAFORMAS as string[]).includes(v);
}

/** Liga/desliga a plataforma e, se um segredo novo foi digitado, cifra e troca o salvo (campo vazio = mantém o
 *  que já está lá). */
export async function salvarCheckout(plataforma: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  if (!ehPlataforma(plataforma)) return { erro: "Plataforma inválida." };

  const ligado = form.get("ligado") === "on";
  const segredo = String(form.get("segredo") ?? "").trim();

  const db = await dbUsuario();
  const atualizacao: Record<string, unknown> = { plataforma, ligado };
  if (segredo) atualizacao.segredo_enc = cifrar(segredo);

  const { error } = await db.from("checkouts").upsert(atualizacao, { onConflict: "plataforma" });
  if (error) return { erro: "Não deu para salvar o checkout." };

  revalidatePath(caminho());
  await registrarAuditoria({ usuarioId: eu.id, acao: "editou", descricao: `${ligado ? "Ligou" : "Desligou"} o checkout ${plataforma}` });
  return { ok: true };
}

/** Novo webhook por webinar: gera um token aleatório (a URL com esse token é a autenticação do receptor). */
export async function adicionarWebhook(_prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const plataforma = String(form.get("plataforma") ?? "");
  const webinarId = String(form.get("webinar_id") ?? "");
  if (!ehPlataforma(plataforma)) return { erro: "Plataforma inválida." };
  if (!webinarId) return { erro: "Escolha o webinar." };

  const db = await dbUsuario();
  const { data: checkout } = await db.from("checkouts").select("id").eq("plataforma", plataforma).maybeSingle();
  if (!checkout) return { erro: "Configure essa plataforma antes de adicionar um webhook." };

  const token = segredoAleatorio();
  const { error } = await db.from("checkout_webhooks").insert({ checkout_id: (checkout as { id: string }).id, webinar_id: webinarId, token });
  if (error) return { erro: "Não deu para adicionar o webhook." };

  revalidatePath(caminho());
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "criou", descricao: `Adicionou um webhook de ${plataforma}` });
  return { ok: true };
}

export async function trocarWebinarWebhook(webhookId: string, form: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const webinarId = String(form.get("webinar_id") ?? "");
  if (!webinarId) return;

  const db = await dbUsuario();
  const { data: atual } = await db.from("checkout_webhooks").select("webinar_id").eq("id", webhookId).maybeSingle();
  await db.from("checkout_webhooks").update({ webinar_id: webinarId }).eq("id", webhookId);
  revalidatePath(caminho());
  await registrarAuditoria({
    usuarioId: eu.id,
    webinarId,
    acao: "editou",
    descricao: "Trocou o webinar de um webhook de checkout",
    antes: atual,
    depois: { webinar_id: webinarId },
  });
}

export async function salvarFiltroWebhook(webhookId: string, form: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const filtro = String(form.get("filtro_src") ?? "").trim();

  const db = await dbUsuario();
  const { data: atual } = await db.from("checkout_webhooks").select("webinar_id, filtro_src").eq("id", webhookId).maybeSingle();
  await db.from("checkout_webhooks").update({ filtro_src: filtro || null }).eq("id", webhookId);
  revalidatePath(caminho());
  const webinarId = (atual as { webinar_id?: string } | null)?.webinar_id;
  await registrarAuditoria({
    usuarioId: eu.id,
    webinarId,
    acao: "editou",
    descricao: "Editou o filtro (src) de um webhook de checkout",
    antes: { filtro_src: (atual as { filtro_src?: string | null } | null)?.filtro_src ?? null },
    depois: { filtro_src: filtro || null },
  });
}

export async function removerWebhook(form: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const webhookId = String(form.get("id") ?? "");
  if (!webhookId) return;

  const db = await dbUsuario();
  await db.from("checkout_webhooks").delete().eq("id", webhookId);
  revalidatePath(caminho());
  await registrarAuditoria({ usuarioId: eu.id, acao: "excluiu", descricao: "Removeu um webhook de checkout" });
}
