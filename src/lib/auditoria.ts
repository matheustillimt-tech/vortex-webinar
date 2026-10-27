import "server-only";
import { dbAdmin } from "./supabase/admin";
import { limparParaAuditoria } from "./regras/auditoria";

export type AcaoAuditoria = "criou" | "editou" | "excluiu";

export type ParametrosAuditoria = {
  usuarioId: string;
  webinarId?: string | null;
  acao: AcaoAuditoria;
  /** Descrição curta em pt-BR ("Editou a oferta", "Importou 120 mensagens do chat"). */
  descricao: string;
  antes?: Record<string, unknown> | null;
  depois?: Record<string, unknown> | null;
};

/** Grava uma linha em `auditoria` com a service role (a RLS só libera leitura pra admin; quem grava é sempre o
 *  servidor). Chamada no fim de cada action do painel que cria/edita/exclui algo visível no histórico; `antes`/
 *  `depois` passam por `limparParaAuditoria` antes de ir pro banco. Nunca lança: uma falha aqui (rede, RLS,
 *  coluna) não pode derrubar a action que já fez o trabalho dela — só loga e segue. */
export async function registrarAuditoria(p: ParametrosAuditoria): Promise<void> {
  try {
    const admin = dbAdmin();
    const { error } = await admin.from("auditoria").insert({
      usuario_id: p.usuarioId,
      webinar_id: p.webinarId ?? null,
      acao: p.acao,
      descricao: p.descricao,
      antes: limparParaAuditoria(p.antes ?? null),
      depois: limparParaAuditoria(p.depois ?? null),
    });
    if (error) console.error("[auditoria] não deu para gravar:", error.message);
  } catch (e) {
    console.error("[auditoria] falhou:", e);
  }
}
