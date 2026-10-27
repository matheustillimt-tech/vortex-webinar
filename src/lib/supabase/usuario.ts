import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { env } from "../env";

export async function dbUsuario() {
  const jar = await cookies();
  return createServerClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (lista) => {
        try {
          lista.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          // chamado de Server Component: o middleware renova a sessão
        }
      },
    },
  });
}

/** Uma ida ao Auth por renderização (`cache`). */
export const exigirUsuario = cache(async () => {
  const db = await dbUsuario();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect("/login");
  return data.user;
});

export type Membro = { id: string; nome: string; papel: "admin" | "atendente" };

/** A pessoa logada na tabela `usuarios` (null se foi desativada ou ainda não cadastrada). */
export const membroAtual = cache(async (): Promise<Membro | null> => {
  const usuario = await exigirUsuario();
  const db = await dbUsuario();
  const { data } = await db.from("usuarios").select("id, nome, papel").eq("auth_id", usuario.id).eq("ativo", true).maybeSingle();
  return (data as Membro | null) ?? null;
});

export async function exigirAdmin(): Promise<Membro & { papel: "admin" }> {
  const m = await membroAtual();
  if (!m || m.papel !== "admin") throw new Error("Só administradores podem fazer isso.");
  return m as Membro & { papel: "admin" };
}

/** Qualquer membro ativo (admin ou atendente) — usado pelas ações de atendimento, que não exigem admin. */
export async function exigirMembro(): Promise<Membro> {
  const m = await membroAtual();
  if (!m) throw new Error("Acesso negado.");
  return m;
}

/** Variante de `membroAtual` para Route Handlers (ex.: exportação de planilha): nunca redireciona — sem usuário
 *  logado ou sem admin, devolve `null` e quem chama decide o status HTTP (401). */
export async function membroApi(): Promise<Membro | null> {
  const db = await dbUsuario();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;
  const { data } = await db.from("usuarios").select("id, nome, papel").eq("auth_id", auth.user.id).eq("ativo", true).maybeSingle();
  return (data as Membro | null) ?? null;
}
