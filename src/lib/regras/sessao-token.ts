import { createHmac, timingSafeEqual } from "node:crypto";

/** `s` = id da sessão, `w` = id do webinar, `t: 1` = token de teste (Pronto), `exp` = expiração (segundos Unix). */
export type DadosToken = { s?: string; w: string; t?: 1; exp: number };

function assinarBase(dadosB64: string, segredo: string): string {
  return createHmac("sha256", segredo).update(dadosB64).digest("base64url");
}

export function assinarToken(dados: DadosToken, segredo: string): string {
  const dadosB64 = Buffer.from(JSON.stringify(dados), "utf8").toString("base64url");
  return `${dadosB64}.${assinarBase(dadosB64, segredo)}`;
}

/** Abre `<dadosB64>.<assinatura>` conferindo o HMAC (com `prefixo` antes dos dados, para separar propósitos) e a
 *  expiração. Devolve o objeto decodificado ou `null`. */
function abrir(token: string, segredo: string, agoraSeg: number, prefixo: string): Record<string, unknown> | null {
  const ponto = token.indexOf(".");
  if (ponto < 0) return null;
  const dadosB64 = token.slice(0, ponto);
  const assinatura = token.slice(ponto + 1);
  if (!dadosB64 || !assinatura) return null;

  const esperada = assinarBase(`${prefixo}${dadosB64}`, segredo);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let dados: unknown;
  try {
    dados = JSON.parse(Buffer.from(dadosB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
  const d = dados as Record<string, unknown>;
  if (typeof d.w !== "string" || typeof d.exp !== "number") return null;
  if (d.exp < agoraSeg) return null;
  return d;
}

/** `null` se a assinatura não bate, o token está malformado ou já expirou (`exp < agoraSeg`). */
export function verificarToken(token: string, segredo: string, agoraSeg: number): DadosToken | null {
  const d = abrir(token, segredo, agoraSeg, "");
  if (!d) return null;
  if (d.s !== undefined && typeof d.s !== "string") return null;
  if (d.t !== undefined && d.t !== 1) return null;
  return d as DadosToken;
}

/** Como `verificarToken`, mas só aceita token de teste (`t: 1`, sem `s`): o gerado no Pronto para `?teste=`. */
export function verificarTokenTeste(token: string, segredo: string, agoraSeg: number): { w: string } | null {
  const dados = verificarToken(token, segredo, agoraSeg);
  if (!dados) return null;
  if (dados.t !== 1 || dados.s !== undefined) return null;
  return { w: dados.w };
}

// Link de acesso por e-mail ---------------------------------------------------------------------------------------

/** Token do link de acesso (`?acesso=`) que vai nos e-mails do just in time: identifica a sessão (`s`) do webinar
 *  (`w`) até `exp`. Assinado com o mesmo segredo do cookie, mas com outro propósito no HMAC (`acesso.` antes dos
 *  dados): um token de cookie nunca vale como acesso e vice-versa. */
export type DadosAcesso = { s: string; w: string; exp: number };

const PREFIXO_ACESSO = "acesso.";
/** O link do e-mail vale até 12 h depois do horário escolhido (dá para ver o replay pelo mesmo link). */
export const HORAS_VALIDADE_ACESSO = 12;

export function criarTokenAcesso(dados: DadosAcesso, segredo: string): string {
  const dadosB64 = Buffer.from(JSON.stringify({ s: dados.s, w: dados.w, exp: dados.exp }), "utf8").toString("base64url");
  return `${dadosB64}.${assinarBase(`${PREFIXO_ACESSO}${dadosB64}`, segredo)}`;
}

/** `null` se a assinatura (de acesso) não bate, está malformado, sem sessão, ou expirado. */
export function verificarTokenAcesso(token: string, segredo: string, agoraSeg: number): DadosAcesso | null {
  const d = abrir(token, segredo, agoraSeg, PREFIXO_ACESSO);
  if (!d || typeof d.s !== "string" || !d.s) return null;
  return { s: d.s, w: d.w as string, exp: d.exp as number };
}

/** Expiração (segundos Unix) do link de acesso: horário escolhido + 12 h. */
export function expTokenAcesso(jitHorario: Date): number {
  return Math.floor(jitHorario.getTime() / 1000) + HORAS_VALIDADE_ACESSO * 60 * 60;
}

/** `<SALA_URL>/<slug>?acesso=<token>` (a entrada da sala trata o `?acesso=` sem criar nada num GET). */
export function linkDeAcesso(salaUrl: string, slug: string, token: string): string {
  return `${salaUrl.replace(/\/+$/, "")}/${encodeURIComponent(slug)}?acesso=${encodeURIComponent(token)}`;
}

// Teste A/B -------------------------------------------------------------------------------------------------------

/** Cookie do teste A/B: `t` = id do teste, `w` = webinar sorteado, `exp` em segundos Unix. Mesmo segredo da sala,
 *  outro propósito no HMAC (`ab.`): não vale como cookie da sala nem como link de acesso, e vice-versa. */
export type DadosTokenAb = { t: string; w: string; exp: number };

const PREFIXO_AB = "ab.";

export function criarTokenAb(dados: DadosTokenAb, segredo: string): string {
  const dadosB64 = Buffer.from(JSON.stringify({ t: dados.t, w: dados.w, exp: dados.exp }), "utf8").toString("base64url");
  return `${dadosB64}.${assinarBase(`${PREFIXO_AB}${dadosB64}`, segredo)}`;
}

/** `null` se a assinatura (do A/B) não bate, está malformado, sem teste, ou expirado. */
export function verificarTokenAb(token: string, segredo: string, agoraSeg: number): DadosTokenAb | null {
  const d = abrir(token, segredo, agoraSeg, PREFIXO_AB);
  if (!d || typeof d.t !== "string" || !d.t || !d.w) return null;
  return { t: d.t, w: d.w as string, exp: d.exp as number };
}
