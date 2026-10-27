"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { enviarImagem } from "@/src/lib/midias";
import { validarInicio } from "@/src/lib/regras/passos";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { seguirParaProximo } from "../_proximo";

export type Resultado = { erro?: string; ok?: boolean; valores?: Record<string, string> };

export async function salvarInicio(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]),
  );

  const r = validarInicio(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const db = await dbUsuario();
  const { data: webinar } = await db
    .from("webinars")
    .select("nome, titulo, slug, idioma, apresentador_nome, apresentador_avatar_url, acesso_facilitado, login_na_sala, sincronizar_video")
    .eq("id", webinarId)
    .maybeSingle();
  const atual = webinar as {
    nome: string;
    titulo: string;
    slug: string;
    idioma: string;
    apresentador_nome: string | null;
    apresentador_avatar_url: string | null;
    acesso_facilitado: boolean;
    login_na_sala: boolean;
    sincronizar_video: boolean;
  } | null;

  if (atual && d.slug !== atual.slug) {
    const { data: outro } = await db.from("webinars").select("id").eq("slug", d.slug).neq("id", webinarId).maybeSingle();
    if (outro) return { erro: "Esse endereço já está em uso.", valores: campos };
  }

  let avatarUrl = atual?.apresentador_avatar_url ?? null;
  const avatar = form.get("avatar");
  if (avatar instanceof File && avatar.size > 0) {
    const envio = await enviarImagem(webinarId, avatar);
    if ("erro" in envio) return { erro: envio.erro, valores: campos };
    avatarUrl = envio.url;
  }

  const depois = {
    nome: d.nome,
    titulo: d.titulo,
    slug: d.slug,
    idioma: d.idioma,
    apresentador_nome: d.apresentadorNome,
    apresentador_avatar_url: avatarUrl,
    acesso_facilitado: d.acessoFacilitado,
    login_na_sala: d.loginNaSala,
    sincronizar_video: d.sincronizarVideo,
  };

  const { error } = await db.from("webinars").update(depois).eq("id", webinarId);
  if (error) {
    // Corrida: outra pessoa salvou o mesmo slug entre a checagem acima e este update.
    if ((error as { code?: string }).code === "23505") return { erro: "Esse endereço já está em uso.", valores: campos };
    return { erro: "Não deu para salvar o início.", valores: campos };
  }

  revalidatePath(`/webinars/${webinarId}/inicio`);
  revalidatePath("/webinars");
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: "Editou o Início", antes: atual, depois });
  seguirParaProximo(form, webinarId);
  return { ok: true, valores: campos };
}
