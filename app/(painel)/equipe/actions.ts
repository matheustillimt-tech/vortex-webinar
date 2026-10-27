"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { validarPessoa } from "@/src/lib/regras/equipe";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; ok?: boolean };

/** Admin cria a pessoa com e-mail e senha (passada a ela por fora). Não existe cadastro aberto. */
export async function criarPessoa(_: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const d = {
    nome: String(form.get("nome") ?? ""),
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    senha: String(form.get("senha") ?? ""),
    papel: String(form.get("papel") ?? "atendente"),
  };
  const erro = validarPessoa(d);
  if (erro) return { erro };

  const admin = dbAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email: d.email, password: d.senha, email_confirm: true });
  if (error || !data.user) return { erro: error?.message.includes("already") ? "Esse e-mail já tem acesso." : "Não deu para criar o acesso." };

  const { error: erroTabela } = await admin.from("usuarios").insert({ auth_id: data.user.id, nome: d.nome.trim(), email: d.email, papel: d.papel });
  if (erroTabela) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { erro: "Não deu para salvar a pessoa." };
  }
  revalidatePath("/equipe");
  await registrarAuditoria({ usuarioId: eu.id, acao: "criou", descricao: `Criou o acesso de ${d.nome.trim()}` });
  return { ok: true };
}

export async function mudarPapel(id: string, papel: "admin" | "atendente"): Promise<void> {
  const eu = await exigirAdmin();
  if (id === eu.id) throw new Error("Você não pode mudar o próprio papel.");
  const db = await dbUsuario();
  const { data: pessoa } = await db.from("usuarios").select("nome, papel").eq("id", id).maybeSingle();
  const { error } = await db.from("usuarios").update({ papel }).eq("id", id);
  if (error) throw new Error("Não deu para salvar a alteração.");
  revalidatePath("/equipe");
  await registrarAuditoria({
    usuarioId: eu.id,
    acao: "editou",
    descricao: `Mudou o papel de ${(pessoa as { nome: string } | null)?.nome ?? "alguém"} para ${papel}`,
    antes: pessoa,
    depois: { nome: (pessoa as { nome: string } | null)?.nome, papel },
  });
}

export async function mudarAtivo(id: string, ativo: boolean): Promise<void> {
  const eu = await exigirAdmin();
  if (id === eu.id) throw new Error("Você não pode desativar o próprio acesso.");
  const db = await dbUsuario();
  const { data: pessoa } = await db.from("usuarios").select("nome, ativo").eq("id", id).maybeSingle();
  const { error } = await db.from("usuarios").update({ ativo }).eq("id", id);
  if (error) throw new Error("Não deu para salvar a alteração.");
  revalidatePath("/equipe");
  await registrarAuditoria({
    usuarioId: eu.id,
    acao: "editou",
    descricao: `${ativo ? "Ativou" : "Desativou"} o acesso de ${(pessoa as { nome: string } | null)?.nome ?? "alguém"}`,
    antes: pessoa,
    depois: { nome: (pessoa as { nome: string } | null)?.nome, ativo },
  });
}
