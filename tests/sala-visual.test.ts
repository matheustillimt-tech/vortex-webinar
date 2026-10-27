import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { ItemMensagem, FaixaVenda } = await import("@/app/s/[slug]/sala/_sala/Mensagem");
const { corOuPadrao } = await import("@/app/s/[slug]/_ui/sala-ui");
const { corBotaoOferta, COR_BOTAO_OFERTA_PADRAO } = await import("@/app/s/[slug]/sala/_sala/Oferta");

function item(texto: string, tipo: "normal" | "eu" | "destaque" = "normal", live = false) {
  return renderToStaticMarkup(createElement(ItemMensagem, { nome: "Ana", texto, imagemUrl: null, tipo, live }));
}

describe("ItemMensagem", () => {
  it("links http(s) viram clicáveis em nova aba, sem opener", () => {
    const html = item("veja https://exemplo.com/a?b=1 agora");
    expect(html).toContain('<a href="https://exemplo.com/a?b=1" target="_blank" rel="noopener noreferrer nofollow"');
    expect(html).toContain("veja ");
    expect(html).toContain(" agora");
  });

  it("javascript: e outros esquemas ficam como texto", () => {
    const html = item("javascript:alert(1) e data:text/html,x");
    expect(html).not.toContain("<a ");
  });

  it("suporte/atendente em faixa na cor de marca; a própria mensagem com o nome na marca", () => {
    expect(item("oi", "destaque")).toContain("bg-marca");
    expect(item("oi", "eu")).toContain("text-marca");
    expect(item("oi")).toContain("text-[#9CA3AF]");
  });

  it("resposta da equipe pra pessoa: faixa verde começando com @Nome", () => {
    const html = renderToStaticMarkup(createElement(ItemMensagem, { nome: "Equipe Sua Empresa", texto: "Tem sim!", imagemUrl: null, tipo: "destaque", mencao: "Ana", live: false }));
    expect(html).toContain("@Ana");
    expect(html).toContain("bg-marca");
    expect(html.indexOf("@Ana")).toBeLessThan(html.indexOf("Tem sim!"));
  });

  it("venda simulada em faixa amarela", () => {
    expect(renderToStaticMarkup(createElement(FaixaVenda, { texto: "Ana comprou", live: false }))).toContain("bg-[#FEF9C3]");
  });
});

describe("cores da sala", () => {
  it("corOuPadrao aceita só hex válido", () => {
    expect(corOuPadrao("#0a8452", "#000")).toBe("#0a8452");
    expect(corOuPadrao(" #abc ", "#000")).toBe("#abc");
    expect(corOuPadrao("red", "#000")).toBe("#000");
    expect(corOuPadrao("url(x)", "#000")).toBe("#000");
    expect(corOuPadrao(null, "#000")).toBe("#000");
  });

  it("botão da oferta sem cor válida usa o verde padrão", () => {
    const base = { botaoCor: "" } as Parameters<typeof corBotaoOferta>[0];
    expect(COR_BOTAO_OFERTA_PADRAO).toBe("#02890B");
    expect(corBotaoOferta(base)).toBe("#02890B");
    expect(corBotaoOferta({ ...base, botaoCor: "#123456" })).toBe("#123456");
  });
});
