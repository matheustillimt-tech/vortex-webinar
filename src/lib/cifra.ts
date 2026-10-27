import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM com a chave explícita. Formato: iv.tag.dados (base64 cada). Sem `server-only` de propósito: um
 *  script de linha de comando (rodado com `tsx`) consegue cifrar do mesmo jeito que o painel. No app, use `cifrar`/`decifrar` de `./crypto`, que pegam a `CRYPTO_KEY` e só rodam no servidor. */
export function cifrarCom(texto: string, chave: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), dados].map((b) => b.toString("base64")).join(".");
}

export function decifrarCom(valor: string, chave: Buffer): string {
  const [iv, tag, dados] = valor.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", chave, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]).toString("utf8");
}

/** `CRYPTO_KEY` (base64, 32 bytes) → chave; erro se não tiver o tamanho certo. */
export function chaveDeBase64(base64: string): Buffer {
  const k = Buffer.from(base64, "base64");
  if (k.length !== 32) throw new Error("CRYPTO_KEY precisa ter 32 bytes em base64");
  return k;
}
