import "server-only";
import { dbAdmin } from "../supabase/admin";
import { FORMATO_CHAVE, hashDaChave, type Permissao } from "./chaves";

/** Chave que autenticou a chamada. `usuarioId` é quem criou a chave: as alterações feitas pelo MCP entram no
 *  Histórico de ações no nome dessa pessoa. */
export type ChaveAutenticada = { id: string; nome: string; permissao: Permissao; usuarioId: string | null };

export const LIMITE_POR_MINUTO = 120;

export const ERROS_AUTH = {
  naoAutenticado: "Chave do MCP ausente ou inválida.",
  limite: `Limite de ${LIMITE_POR_MINUTO} chamadas por minuto atingido. Tente de novo em instantes.`,
  indisponivel: "Não deu para conferir a chave agora. Tente de novo.",
} as const;

const SEM_CACHE = { "cache-control": "no-store" };
const erro = (status: number, mensagem: string, cabecalhos: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: mensagem } }, { status, headers: { ...SEM_CACHE, ...cabecalhos } });

/** Lê `Authorization: Bearer vw_…`. Nunca loga a chave nem o header. */
function chaveDoHeader(req: Request): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return m && FORMATO_CHAVE.test(m[1]) ? m[1] : null;
}

/** Soma 1 chamada no minuto da chave. Erro do banco → `indisponivel` (fecha: sem contador, sem chamada). */
export async function registrarUso(chaveId: string): Promise<"ok" | "limite" | "indisponivel"> {
  const { data, error } = await dbAdmin().rpc("api_registrar_uso", { p_chave: chaveId });
  if (error) return "indisponivel";
  return Number(data) > LIMITE_POR_MINUTO ? "limite" : "ok";
}

/** Autentica a chamada do MCP pela chave: inexistente, revogada ou mal formada → 401; acima do limite por minuto
 *  → 429. A chave de quem foi desativado na equipe para de valer. Devolve a chave ou a `Response` de erro pronta. */
export async function autenticarMcp(req: Request): Promise<{ chave: ChaveAutenticada } | Response> {
  const texto = chaveDoHeader(req);
  if (!texto) return erro(401, ERROS_AUTH.naoAutenticado);
  const { data, error } = await dbAdmin()
    .from("chaves_api")
    .select("id, nome, permissao, criada_por, revogada_em, usuarios(ativo, papel)")
    .eq("hash", hashDaChave(texto))
    .maybeSingle();
  if (error) return erro(503, ERROS_AUTH.indisponivel);
  const linha = data as {
    id: string;
    nome: string;
    permissao: Permissao;
    criada_por: string | null;
    revogada_em: string | null;
    usuarios: { ativo: boolean; papel: string } | null;
  } | null;
  if (!linha || linha.revogada_em) return erro(401, ERROS_AUTH.naoAutenticado);
  if (!linha.usuarios?.ativo || linha.usuarios.papel !== "admin") return erro(401, ERROS_AUTH.naoAutenticado);

  const uso = await registrarUso(linha.id);
  if (uso === "indisponivel") return erro(503, ERROS_AUTH.indisponivel);
  if (uso === "limite") return erro(429, ERROS_AUTH.limite, { "retry-after": String(60 - new Date().getUTCSeconds()) });
  return { chave: { id: linha.id, nome: linha.nome, permissao: linha.permissao, usuarioId: linha.criada_por } };
}
