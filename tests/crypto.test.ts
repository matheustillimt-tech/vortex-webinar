import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cifrar, decifrar, segredoAleatorio, segredosIguais } from "@/src/lib/crypto";

const chave = randomBytes(32);

describe("crypto", () => {
  it("cifra e decifra de volta", () => {
    const c = cifrar("segredo do webhook", chave);
    expect(c).not.toContain("segredo");
    expect(decifrar(c, chave)).toBe("segredo do webhook");
  });

  it("cada cifra sai diferente (iv aleatório)", () => {
    expect(cifrar("x", chave)).not.toBe(cifrar("x", chave));
  });

  it("chave errada não decifra", () => {
    expect(() => decifrar(cifrar("x", chave), randomBytes(32))).toThrow();
  });

  it("segredo aleatório é base64url", () => {
    expect(segredoAleatorio()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("compara segredos", () => {
    expect(segredosIguais("abc", "abc")).toBe(true);
    expect(segredosIguais("abc", "abd")).toBe(false);
    expect(segredosIguais("abc", "abcd")).toBe(false);
  });
});
