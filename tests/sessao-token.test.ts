import { describe, expect, it } from "vitest";
import { assinarToken, verificarToken } from "@/src/lib/regras/sessao-token";

const SEGREDO = "segredo-teste";

describe("sessao-token", () => {
  it("ida e volta: assina e verifica, devolvendo os mesmos dados", () => {
    const dados = { s: "sessao-1", w: "webinar-1", exp: 1_000_000 };
    const token = assinarToken(dados, SEGREDO);
    expect(verificarToken(token, SEGREDO, 500_000)).toEqual(dados);
  });

  it("token de teste (sem `s`, com `t: 1`)", () => {
    const dados = { w: "webinar-1", t: 1 as const, exp: 1_000_000 };
    const token = assinarToken(dados, SEGREDO);
    expect(verificarToken(token, SEGREDO, 500_000)).toEqual(dados);
  });

  it("assinatura adulterada: null", () => {
    const token = assinarToken({ w: "webinar-1", exp: 1_000_000 }, SEGREDO);
    const [dadosB64] = token.split(".");
    const adulterado = `${dadosB64}.assinaturafalsa`;
    expect(verificarToken(adulterado, SEGREDO, 500_000)).toBeNull();
  });

  it("dados adulterados (muda o payload, mantém a assinatura antiga): null", () => {
    const token = assinarToken({ w: "webinar-1", exp: 1_000_000 }, SEGREDO);
    const [, assinatura] = token.split(".");
    const outroPayload = Buffer.from(JSON.stringify({ w: "webinar-2", exp: 1_000_000 })).toString("base64url");
    expect(verificarToken(`${outroPayload}.${assinatura}`, SEGREDO, 500_000)).toBeNull();
  });

  it("expirado: null", () => {
    const token = assinarToken({ w: "webinar-1", exp: 1000 }, SEGREDO);
    expect(verificarToken(token, SEGREDO, 1001)).toBeNull();
  });

  it("exp igual a agora ainda é válido (exp < agoraSeg é que invalida)", () => {
    const token = assinarToken({ w: "webinar-1", exp: 1000 }, SEGREDO);
    expect(verificarToken(token, SEGREDO, 1000)).not.toBeNull();
  });

  it("malformado (sem ponto): null", () => {
    expect(verificarToken("tokeninvalido", SEGREDO, 0)).toBeNull();
  });

  it("malformado (payload não é JSON válido): null", () => {
    const b64 = Buffer.from("não é json").toString("base64url");
    const assinatura = assinarToken({ w: "x", exp: 0 }, SEGREDO).split(".")[1];
    expect(verificarToken(`${b64}.${assinatura}`, SEGREDO, 0)).toBeNull();
  });

  it("segredo errado: null", () => {
    const token = assinarToken({ w: "webinar-1", exp: 1_000_000 }, SEGREDO);
    expect(verificarToken(token, "outro-segredo", 500_000)).toBeNull();
  });
});

describe("token do teste A/B", () => {
  it("ida e volta com propósito próprio; não vale como token da sala nem de acesso", async () => {
    const { criarTokenAb, verificarTokenAb, verificarTokenAcesso } = await import("@/src/lib/regras/sessao-token");
    const token = criarTokenAb({ t: "teste-1", w: "web-1", exp: 1_000_000 }, SEGREDO);
    expect(verificarTokenAb(token, SEGREDO, 500_000)).toEqual({ t: "teste-1", w: "web-1", exp: 1_000_000 });
    expect(verificarToken(token, SEGREDO, 500_000)).toBeNull();
    expect(verificarTokenAcesso(token, SEGREDO, 500_000)).toBeNull();
    // e um token da sala não vale como A/B
    expect(verificarTokenAb(assinarToken({ w: "web-1", exp: 1_000_000 }, SEGREDO), SEGREDO, 500_000)).toBeNull();
  });

  it("adulterado, expirado ou sem teste: null", async () => {
    const { criarTokenAb, verificarTokenAb } = await import("@/src/lib/regras/sessao-token");
    const token = criarTokenAb({ t: "teste-1", w: "web-1", exp: 1_000_000 }, SEGREDO);
    const [dados, assinatura] = token.split(".");
    const outro = Buffer.from(JSON.stringify({ t: "teste-1", w: "web-2", exp: 1_000_000 })).toString("base64url");
    expect(verificarTokenAb(`${outro}.${assinatura}`, SEGREDO, 500_000)).toBeNull();
    expect(verificarTokenAb(`${dados}.${assinatura}x`, SEGREDO, 500_000)).toBeNull();
    expect(verificarTokenAb(token, "outro-segredo", 500_000)).toBeNull();
    expect(verificarTokenAb(token, SEGREDO, 1_000_001)).toBeNull();
    expect(verificarTokenAb(criarTokenAb({ t: "", w: "web-1", exp: 1_000_000 }, SEGREDO), SEGREDO, 500_000)).toBeNull();
  });
});
