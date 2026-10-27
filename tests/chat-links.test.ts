import { describe, expect, it } from "vitest";
import { temLinkProibido } from "@/src/lib/regras/chat-links";

const OFERTA = "https://oferta.exemplo.com.br/aplicacao?utm_source=webinar&utm_campaign=gravado";

describe("temLinkProibido", () => {
  it("texto normal, preço e números passam", () => {
    for (const t of ["boa noite", "12x R$ 199,70 ou R$ 1.997", "tá.ok", "meu foi 12", "1.5 milhão", "Sim!!"]) expect(temLinkProibido(t, OFERTA)).toBe(false);
  });
  it("bloqueia links com e sem http", () => {
    for (const t of ["olha https://meusite.com", "www.loja.com.br", "entra em bit.ly/abc", "wa.me/5511999999999", "instagram.com/perfil", "visita site.com.br"]) {
      expect(temLinkProibido(t, OFERTA)).toBe(true);
    }
  });
  it("libera o link da oferta (com ou sem UTMs, com ou sem https)", () => {
    expect(temLinkProibido("aplica aqui https://oferta.exemplo.com.br/aplicacao", OFERTA)).toBe(false);
    expect(temLinkProibido("oferta.exemplo.com.br/aplicacao?utm_source=x", OFERTA)).toBe(false);
  });
  it("outro caminho do mesmo site é bloqueado", () => {
    expect(temLinkProibido("https://oferta.exemplo.com.br/outra", OFERTA)).toBe(true);
  });
  it("sem link de oferta, qualquer link é bloqueado", () => {
    expect(temLinkProibido("https://oferta.exemplo.com.br/aplicacao", null)).toBe(true);
  });
});
