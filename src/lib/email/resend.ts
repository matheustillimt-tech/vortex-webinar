import "server-only";

export type CfgResend = { resendKey: string };
export type MensagemEmail = { de: string; para: string; assunto: string; html: string; texto: string };

const API = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

/** Envia um e-mail pelo Resend (`POST /emails`) e devolve o id. Erro HTTP vira mensagem com o status e o motivo do
 *  Resend (sem a chave, cortado em 200 caracteres) pra ficar no log do envio; rede/timeout de 15 s vira
 *  "O Resend não respondeu.". */
export async function enviarEmail(cfg: CfgResend, msg: MensagemEmail, f: typeof fetch = fetch): Promise<{ id: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let r: Response;
  let corpo: { id?: unknown; message?: unknown } = {};
  try {
    r = await f(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: msg.de, to: [msg.para], subject: msg.assunto, html: msg.html, text: msg.texto }),
      signal: controller.signal,
    });
    corpo = (await r.json().catch(() => ({}))) as typeof corpo;
  } catch {
    throw new Error("O Resend não respondeu.");
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    const motivo = typeof corpo.message === "string" ? corpo.message.split(cfg.resendKey).join("***").trim().slice(0, 200) : "";
    throw new Error(`O Resend recusou o e-mail (HTTP ${r.status})${motivo ? `: ${motivo}` : "."}`);
  }
  if (typeof corpo.id !== "string" || !corpo.id) throw new Error("O Resend não confirmou o envio.");
  return { id: corpo.id };
}
