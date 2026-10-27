"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { copiarWebinar } from "@/src/lib/webinars-duplicar";
import { apagarWebinarDeVez } from "@/src/lib/webinars-apagar";
import { gerarSlug, slugUnico, validarSlug } from "@/src/lib/regras/slug";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; valores?: { nome: string } };

export async function criarWebinar(_: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const nome = String(form.get("nome") ?? "").trim();
  const valores = { nome };
  if (!nome) return { erro: "Dê um nome ao webinar.", valores };
  const base = gerarSlug(nome);
  if (validarSlug(base)) return { erro: "Use um nome com pelo menos 3 letras ou números.", valores };

  const db = await dbUsuario();
  const parecidosCom = async (prefixo: string) => {
    const { data } = await db.from("webinars").select("slug").like("slug", `${prefixo}%`);
    return (data ?? []).map((p) => p.slug as string);
  };

  let slug = slugUnico(base, await parecidosCom(base));
  let { data, error } = await db.from("webinars").insert({ nome, slug }).select("id").single();

  if (error?.code === "23505") {
    // Colisão (outra criação concorrente pegou o mesmo slug): refaz a busca com um prefixo menor
    // (slugUnico pode ter truncado o slug existente) e tenta de novo, uma única vez.
    slug = slugUnico(base, await parecidosCom(base.slice(0, 50)));
    ({ data, error } = await db.from("webinars").insert({ nome, slug }).select("id").single());
  }

  if (error || !data) return { erro: "Não deu para criar o webinar.", valores };
  const { error: erroAgenda } = await db.from("agendas").insert({ webinar_id: data.id });
  if (erroAgenda) return { erro: "O webinar foi criado, mas não deu para criar a agenda. Abra o webinar e salve a agenda.", valores };
  await registrarAuditoria({ usuarioId: eu.id, webinarId: data.id, acao: "criou", descricao: `Criou o webinar "${nome}"` });
  redirect(`/webinars/${data.id}/inicio`);
}

export type ResultadoDuplicar = { erro: string };

/** Cria a cópia (`copiarWebinar`) e redireciona pro Início dela. */
export async function duplicarWebinar(id: string): Promise<ResultadoDuplicar | void> {
  const eu = await exigirAdmin();
  const r = await copiarWebinar(await dbUsuario(), id);
  if ("erro" in r) return { erro: r.erro === "Webinar não encontrado." ? "Não deu para duplicar o webinar." : r.erro };

  revalidatePath("/webinars");
  await registrarAuditoria({ usuarioId: eu.id, webinarId: r.id, acao: "criou", descricao: `Duplicou o webinar "${r.nomeOriginal}"` });
  redirect(`/webinars/${r.id}/inicio`);
}

export async function arquivarWebinar(id: string): Promise<{ erro?: string }> {
  const eu = await exigirAdmin();
  const db = await dbUsuario();
  const { error } = await db.from("webinars").update({ status: "arquivado" }).eq("id", id);
  if (error) return { erro: "Não deu para arquivar o webinar." };
  revalidatePath("/webinars");
  await registrarAuditoria({ usuarioId: eu.id, webinarId: id, acao: "editou", descricao: "Arquivou o webinar" });
  return {};
}

export async function reativarWebinar(id: string): Promise<{ erro?: string }> {
  const eu = await exigirAdmin();
  const db = await dbUsuario();
  const { error } = await db.from("webinars").update({ status: "ativo" }).eq("id", id);
  if (error) return { erro: "Não deu para reativar o webinar." };
  revalidatePath("/webinars");
  await registrarAuditoria({ usuarioId: eu.id, webinarId: id, acao: "editou", descricao: "Reativou o webinar" });
  return {};
}

/** Apaga o webinar de vez, com todos os dados dele (`apagarWebinarDeVez`: só arquivado e fora de teste A/B). */
export async function apagarWebinar(id: string): Promise<{ erro?: string }> {
  const eu = await exigirAdmin();
  const r = await apagarWebinarDeVez(id);
  if ("erro" in r) return { erro: r.erro };
  revalidatePath("/webinars");
  await registrarAuditoria({ usuarioId: eu.id, webinarId: null, acao: "excluiu", descricao: `Apagou de vez o webinar "${r.nome}" e todos os dados dele` });
  return {};
}
