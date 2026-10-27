import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chaveDeBase64, cifrarCom, decifrarCom } from "./cifra";

function chavePadrao(): Buffer {
  return chaveDeBase64(process.env.CRYPTO_KEY ?? "");
}

/** AES-256-GCM. Formato: iv.tag.dados (base64 cada). Implementação em `./cifra` (compartilhada com os scripts). */
export function cifrar(texto: string, chave: Buffer = chavePadrao()): string {
  return cifrarCom(texto, chave);
}

export function decifrar(valor: string, chave: Buffer = chavePadrao()): string {
  return decifrarCom(valor, chave);
}

export function segredoAleatorio(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function segredosIguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(`${process.env.CRYPTO_KEY ?? ""}:${ip}`).digest("hex").slice(0, 32);
}
