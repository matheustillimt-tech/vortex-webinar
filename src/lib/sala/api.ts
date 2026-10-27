import "server-only";
import { NextResponse } from "next/server";
import { lerSessaoDoCookie, type SessaoLida } from "./sessao";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidValido(v: unknown): v is string {
  return typeof v === "string" && RE_UUID.test(v);
}

export function respostaErro(erro: string, status: number): NextResponse {
  return NextResponse.json({ erro }, { status });
}

/** Corpo JSON do request, ou `null` se vazio/malformado (nunca lança). */
export async function corpoJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export type AutenticacaoSala = { sessao: SessaoLida } | { erro: NextResponse };

/** Autentica toda API da sala pelo cookie `vw_<w>`, a partir do `w` (webinarId) recebido no corpo/query.
 *  `w` precisa ser um UUID válido (senão 400 "Parâmetros inválidos."); sem sessão válida no cookie pra esse
 *  webinar, 401 "Sessão expirada.". */
export async function autenticarSala(w: unknown): Promise<AutenticacaoSala> {
  if (!uuidValido(w)) return { erro: respostaErro("Parâmetros inválidos.", 400) };
  const sessao = await lerSessaoDoCookie(w);
  if (!sessao) return { erro: respostaErro("Sessão expirada.", 401) };
  return { sessao };
}
