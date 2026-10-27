import { describe, expect, it } from "vitest";
import { BLOCOS_VW, limparCssPagina, limparHtmlPagina } from "@/src/lib/regras/paginas";
import {
  configDeLinha,
  configPadrao,
  cssParaSalvar,
  documentoDePrevia,
  PREVIA_BLOCO,
  ROTULO_BLOCO,
  urlEmbedVideo,
  validarConfigPagina,
} from "@/src/lib/regras/paginas-editor";

describe("blocos do editor", () => {
  it("tem rótulo e prévia para cada bloco de BLOCOS_VW, na mesma ordem", () => {
    expect(Object.keys(ROTULO_BLOCO)).toEqual([...BLOCOS_VW]);
    expect(Object.keys(PREVIA_BLOCO)).toEqual([...BLOCOS_VW]);
  });
});

describe("urlEmbedVideo", () => {
  it("YouTube (watch, youtu.be, shorts, embed)", () => {
    expect(urlEmbedVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(urlEmbedVideo("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(urlEmbedVideo("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(urlEmbedVideo("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("Vimeo e Bunny", () => {
    expect(urlEmbedVideo("https://vimeo.com/123456")).toBe("https://player.vimeo.com/video/123456");
    expect(urlEmbedVideo("https://player.vimeo.com/video/123456")).toBe("https://player.vimeo.com/video/123456");
    const bunny = "https://iframe.mediadelivery.net/play/987/0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601";
    expect(urlEmbedVideo(bunny)).toBe("https://iframe.mediadelivery.net/embed/987/0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601");
  });

  it("recusa outros hosts e esquemas", () => {
    expect(urlEmbedVideo("javascript:alert(1)")).toBeNull();
    expect(urlEmbedVideo("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(urlEmbedVideo("não é link")).toBeNull();
  });

  it("o iframe gerado passa pela limpeza", () => {
    const src = urlEmbedVideo("https://youtu.be/dQw4w9WgXcQ")!;
    expect(limparHtmlPagina(`<div class="vw-video"><iframe src="${src}"></iframe></div>`)).toContain(`<iframe src="${src}">`);
  });
});

describe("Ajustes", () => {
  it("valida cor, fonte, tamanhos", () => {
    const ok = validarConfigPagina({ ...configPadrao("T"), cor_fundo: "#fff" });
    expect(ok).toEqual({ dados: { cor_fundo: "#fff", titulo: "T", descricao: "", fonte: "Inter", css_personalizado: "" } });
    expect(validarConfigPagina({ ...configPadrao(), cor_fundo: "#fff;}body{" })).toEqual({ erro: "Escolha uma cor de fundo válida (ex.: #000000)." });
    expect(validarConfigPagina({ ...configPadrao(), fonte: "Arial" })).toEqual({ erro: "Escolha uma das fontes da lista." });
    expect(validarConfigPagina({ ...configPadrao(), titulo: "x".repeat(121) })).toEqual({ erro: "Use até 120 caracteres no título da aba." });
    expect(validarConfigPagina(null)).toEqual({ erro: "Escolha uma cor de fundo válida (ex.: #000000)." });
  });

  it("configDeLinha completa o que falta e descarta o que está fora da regra", () => {
    expect(configDeLinha({})).toEqual(configPadrao());
    expect(configDeLinha({ fonte: "Arial", cor_fundo: "url(x)", titulo: "Oi" })).toEqual({ ...configPadrao(), titulo: "Oi" });
  });

  it("CSS salvo = editor + Ajustes + personalizado, e a limpeza escopa tudo", () => {
    const css = limparCssPagina(cssParaSalvar("h1{color:red}", { ...configPadrao(), fonte: "Open Sans", css_personalizado: "body{padding:0}" }));
    expect(css).toBe(".vw-pagina h1{color:red}.vw-pagina{background-color:#000000;font-family:'Open Sans',system-ui,-apple-system,sans-serif}.vw-pagina{padding:0}");
  });
});

describe("documentoDePrevia", () => {
  it("troca marcadores por caixas, escapa título/descrição e usa a fonte escolhida", () => {
    const html = limparHtmlPagina('<h1>Oi</h1><div data-vw="vagas"></div>');
    const doc = documentoDePrevia(html, "", { ...configPadrao('</title><script>x</script>'), descricao: '"a"', fonte: "Poppins" });
    expect(doc).toContain('<div class="vw-previa-bloco" data-vw-previa="vagas">Barra de vagas');
    expect(doc).not.toContain("<script>");
    expect(doc).toContain("&lt;/title&gt;");
    expect(doc).toContain('content="&quot;a&quot;"');
    expect(doc).toContain("family=Poppins");
  });
});
