"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { criarChave, revogarChave } from "@/src/lib/mcp/chaves";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { exigirAdmin } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; chave?: string };

/** Cria uma chave do MCP no nome de quem está logado (as alterações pelo MCP entram no histórico dela). A chave em
 *  texto volta UMA vez, pra mostrar na tela; o banco guarda só o hash. */
export async function criarChaveMcp(_prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const nome = String(form.get("nome") ?? "");
  const permissao = String(form.get("permissao") ?? "");
  const r = await criarChave(dbAdmin(), { nome, permissao, criadaPor: eu.id });
  if ("erro" in r) return { erro: r.erro };
  revalidatePath("/configuracoes");
  await registrarAuditoria({ usuarioId: eu.id, acao: "criou", descricao: `Criou a chave do MCP "${nome.trim()}" (${permissao})` });
  return { chave: r.chave };
}

export async function revogarChaveMcp(id: string): Promise<{ erro?: string }> {
  const eu = await exigirAdmin();
  const r = await revogarChave(dbAdmin(), id);
  if ("erro" in r) return { erro: r.erro };
  revalidatePath("/configuracoes");
  await registrarAuditoria({ usuarioId: eu.id, acao: "excluiu", descricao: "Revogou uma chave do MCP" });
  return {};
}
