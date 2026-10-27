import { describe, expect, it } from "vitest";
import {
  BLOCOS_VW,
  ESCOPO_PAGINA,
  MAX_CSS_PAGINA,
  MAX_HTML_PAGINA,
  limparCssPagina,
  limparHtmlPagina,
  partesDaPagina,
  temFormulario,
  validarConteudoPagina,
  validarNomePagina,
  validarPagina,
  validarVinculoPagina,
} from "@/src/lib/regras/paginas";
import { MODELOS_PAGINA, modeloPagina } from "@/src/lib/regras/paginas-modelos";

describe("validarPagina", () => {
  it("aceita nome, tipo e modelo compatíveis (nome aparado)", () => {
    expect(validarPagina({ nome: "  Minha LP  ", tipo: "registro_jit", modelo: "registro_form" })).toEqual({
      dados: { nome: "Minha LP", tipo: "registro_jit", modelo: "registro_form" },
    });
    expect(validarPagina({ nome: "Espera", tipo: "espera_unica", modelo: "espera_unica" })).toHaveProperty("dados");
  });

  it("recusa nome vazio ou longo demais", () => {
    expect(validarPagina({ nome: "  ", tipo: "registro_jit", modelo: "registro_botao" })).toEqual({ erro: "Informe o nome da página." });
    expect(validarNomePagina("x".repeat(121))).toBe("Use até 120 caracteres no nome.");
    expect(validarNomePagina("x".repeat(120))).toBeNull();
  });

  it("recusa tipo desconhecido e modelo que não é do tipo", () => {
    expect(validarPagina({ nome: "A", tipo: "landing", modelo: "registro_botao" })).toEqual({ erro: "Escolha o tipo da página." });
    expect(validarPagina({ nome: "A", tipo: "espera_jit", modelo: "registro_botao" })).toEqual({ erro: "Escolha um modelo deste tipo de página." });
    expect(validarPagina({ nome: "A", tipo: "registro_jit", modelo: "lp-legacy" })).toEqual({ erro: "Escolha um modelo deste tipo de página." });
  });
});

describe("validarConteudoPagina", () => {
  it("limita HTML a 300 KB e CSS a 100 KB (em bytes)", () => {
    expect(validarConteudoPagina({ html: "a".repeat(MAX_HTML_PAGINA), css: "b".repeat(MAX_CSS_PAGINA) })).toBeNull();
    expect(validarConteudoPagina({ html: "a".repeat(MAX_HTML_PAGINA + 1), css: "" })).toBe("A página ficou grande demais (máximo de 300 KB de HTML).");
    expect(validarConteudoPagina({ html: "", css: "b".repeat(MAX_CSS_PAGINA + 1) })).toBe("O CSS ficou grande demais (máximo de 100 KB).");
    // "é" ocupa 2 bytes: conta bytes, não caracteres.
    expect(validarConteudoPagina({ html: "é".repeat(MAX_HTML_PAGINA / 2 + 1), css: "" })).not.toBeNull();
  });
});

describe("limparHtmlPagina: XSS", () => {
  it("remove <script> e o conteúdo dele", () => {
    const r = limparHtmlPagina('<p>oi</p><script>alert(1)</script><SCRIPT src="https://x.com/a.js"></SCRIPT>');
    expect(r).toBe("<p>oi</p>");
  });

  it("remove atributos on* (onerror, onclick, onload)", () => {
    const r = limparHtmlPagina('<img src="https://x.com/a.png" onerror="alert(1)"><div onclick="alert(2)" onmouseover="x()">a</div>');
    expect(r).not.toMatch(/on\w+=/i);
    expect(r).toContain('src="https://x.com/a.png"');
    expect(r).toContain("<div>a</div>");
  });

  it("remove javascript: de href e src (inclusive disfarçado)", () => {
    const r = limparHtmlPagina(
      '<a href="javascript:alert(1)">a</a><a href="JaVaScRiPt:alert(1)">b</a><a href="java&#x09;script:alert(1)">c</a><img src="javascript:alert(1)">',
    );
    expect(r.toLowerCase()).not.toContain("javascript");
    expect(r).toContain("<a>a</a>");
  });

  it("remove iframe de host não permitido e mantém YouTube/Vimeo/Bunny em https", () => {
    expect(limparHtmlPagina('<iframe src="https://evil.com/x"></iframe>')).toBe("");
    expect(limparHtmlPagina('<iframe src="http://www.youtube.com/embed/abc"></iframe>')).toBe("");
    expect(limparHtmlPagina("<iframe></iframe>")).toBe("");
    expect(limparHtmlPagina('<iframe src="javascript:alert(1)"></iframe>')).toBe("");
    for (const src of [
      "https://www.youtube.com/embed/abc",
      "https://www.youtube-nocookie.com/embed/abc",
      "https://player.vimeo.com/video/123",
      "https://iframe.mediadelivery.net/embed/1/abc",
    ]) {
      expect(limparHtmlPagina(`<iframe src="${src}" allowfullscreen></iframe>`)).toContain(`src="${src}"`);
    }
  });

  it("limpa style inline com expression() e url(javascript:), mantendo o resto", () => {
    const r = limparHtmlPagina(
      '<div style="color: red; width: expression(alert(1)); background: url(javascript:alert(1))">a</div>' +
        "<p style=\"background-image: url('JAVASCRIPT:alert(1)'); padding: 4px\">b</p>" +
        '<p style="behavior: url(x.htc); -moz-binding: url(x.xml#y); margin: 0">c</p>',
    );
    expect(r.toLowerCase()).not.toContain("expression");
    expect(r.toLowerCase()).not.toContain("javascript");
    expect(r).not.toContain("behavior");
    expect(r).not.toContain("binding");
    expect(r).toContain("color:red");
    expect(r).toContain("padding:4px");
    expect(r).toContain("margin:0");
  });

  it("remove style com expression() disfarçado por escape de CSS", () => {
    const r = limparHtmlPagina('<div style="width: e\\78pression(alert(1)); color: blue">a</div>');
    expect(r.toLowerCase()).not.toContain("pression");
    expect(r).toContain("color:blue");
  });

  it("remove form, input, textarea, select, object, embed, style, link e meta", () => {
    const r = limparHtmlPagina(
      '<form action="https://x.com"><input name="a"><textarea>t</textarea><select><option>1</option></select></form>' +
        '<object data="x"></object><embed src="x"><style>body{}</style><link rel="stylesheet" href="x"><meta http-equiv="refresh" content="0">',
    );
    expect(r).not.toMatch(/<(form|input|textarea|select|option|object|embed|style|link|meta)\b/i);
    expect(r).not.toContain("body{}");
  });

  it("aceita data: só para imagem (png/jpg/gif/webp) em img", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(limparHtmlPagina(`<img src="${png}">`)).toContain(png);
    expect(limparHtmlPagina('<img src="data:text/html;base64,PHNjcmlwdD4=">')).not.toContain("data:");
    expect(limparHtmlPagina('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).not.toContain("data:");
    expect(limparHtmlPagina('<a href="data:text/html,<script>alert(1)</script>">x</a>')).not.toContain("data:");
  });

  it("remove svg (pode carregar script) e math", () => {
    expect(limparHtmlPagina('<svg onload="alert(1)"><script>alert(1)</script></svg>')).not.toMatch(/svg|script|alert/);
  });
});

describe("limparHtmlPagina: o que fica", () => {
  it("preserva class, id, style e title; links http(s)/mailto/#; imagens", () => {
    const html =
      '<section id="topo" class="hero escuro" style="background-color: #000" title="t"><h1 class="t">Oi</h1>' +
      '<a href="https://x.com/a?b=1" target="_blank">x</a><a href="mailto:a@b.com">m</a><a href="#form">ancora</a>' +
      '<img src="https://cdn.x.com/a.webp" alt="foto" width="100"></section>';
    const r = limparHtmlPagina(html);
    expect(r).toContain('id="topo"');
    expect(r).toContain('class="hero escuro"');
    expect(r).toContain("background-color:#000");
    expect(r).toContain('href="https://x.com/a?b=1"');
    expect(r).toContain('rel="noopener noreferrer"');
    expect(r).toContain('href="mailto:a@b.com"');
    expect(r).toContain('href="#form"');
    expect(r).toContain('alt="foto"');
  });

  it("preserva os marcadores data-vw válidos, sempre vazios e sem outros atributos", () => {
    const r = limparHtmlPagina(
      '<div data-vw="titulo" class="x" onclick="a()"><span>conteúdo de prévia</span><img src="https://x.com/a.png"></div>' +
        '<div data-vw="formulario"><form><input></form><div><div>fundo</div></div></div><p>depois</p>',
    );
    expect(r).toBe('<div data-vw="titulo"></div><div data-vw="formulario"></div><p>depois</p>');
  });

  it("descarta data-vw desconhecido (o div fica, sem o atributo) e data-vw fora de div", () => {
    expect(limparHtmlPagina('<div data-vw="script">a</div>')).toBe("<div>a</div>");
    expect(limparHtmlPagina('<span data-vw="titulo">a</span>')).toBe("<span>a</span>");
  });

  it("é idempotente", () => {
    const html = '<section class="a"><div data-vw="contagem"><b>x</b></div><p style="color:red">y</p></section>';
    const uma = limparHtmlPagina(html);
    expect(limparHtmlPagina(uma)).toBe(uma);
  });
});

describe("partesDaPagina", () => {
  it("quebra nos marcadores em qualquer nível, na ordem", () => {
    const partes = partesDaPagina(
      '<section class="a"><h1>Oi</h1><div class="col"><div data-vw="titulo">prévia</div></div><div data-vw="contagem"></div></section><footer>f</footer>',
    );
    expect(partes).toEqual([
      { tipo: "html", html: '<section class="a"><h1>Oi</h1><div class="col">' },
      { tipo: "bloco", bloco: "titulo" },
      { tipo: "html", html: "</div>" },
      { tipo: "bloco", bloco: "contagem" },
      { tipo: "html", html: "</section><footer>f</footer>" },
    ]);
  });

  it("sem marcador → uma parte só; vazio → nenhuma", () => {
    expect(partesDaPagina("<p>a</p>")).toEqual([{ tipo: "html", html: "<p>a</p>" }]);
    expect(partesDaPagina("")).toEqual([]);
  });

  it("marcadores colados não geram parte html vazia", () => {
    expect(partesDaPagina('<div data-vw="vagas"></div><div data-vw="horarios"></div>')).toEqual([
      { tipo: "bloco", bloco: "vagas" },
      { tipo: "bloco", bloco: "horarios" },
    ]);
  });

  it("limpa antes de quebrar (XSS nunca chega numa parte html)", () => {
    const partes = partesDaPagina('<img src=x onerror="alert(1)"><script>alert(2)</script><div data-vw="formulario"><script>x</script></div>');
    expect(JSON.stringify(partes)).not.toMatch(/onerror|script|alert/);
    expect(partes.at(-1)).toEqual({ tipo: "bloco", bloco: "formulario" });
  });

  it("marcador dentro de outro marcador some junto com o conteúdo do de fora", () => {
    expect(partesDaPagina('<div data-vw="vagas"><div data-vw="formulario"></div></div>')).toEqual([{ tipo: "bloco", bloco: "vagas" }]);
  });
});

describe("temFormulario", () => {
  it("só conta o marcador formulario válido", () => {
    expect(temFormulario('<div><div data-vw="formulario"></div></div>')).toBe(true);
    expect(temFormulario('<div data-vw="horarios"></div>')).toBe(false);
    expect(temFormulario('<span data-vw="formulario"></span>')).toBe(false);
    expect(temFormulario('<script><div data-vw="formulario"></div></script>')).toBe(false);
  });
});

describe("validarVinculoPagina", () => {
  it("página de registro sem formulário não pode ser vinculada", () => {
    expect(validarVinculoPagina({ tipo: "registro_jit", html: "<p>a</p>" }, "registro_jit")).toBe("A página de registro precisa ter o formulário.");
    expect(validarVinculoPagina({ tipo: "registro_jit", html: '<div data-vw="formulario"></div>' }, "registro_jit")).toBeNull();
  });

  it("só no lugar do tipo certo", () => {
    expect(validarVinculoPagina({ tipo: "espera_jit", html: "" }, "espera_unica")).toBe("Esta página não é do tipo certo para este lugar.");
    expect(validarVinculoPagina({ tipo: "espera_unica", html: "" }, "espera_unica")).toBeNull();
  });
});

describe("limparCssPagina", () => {
  it("escapa < (nunca fecha o <style>)", () => {
    const r = limparCssPagina('p{color:red}</style><script>alert(1)</script><style>a{content:"<"}');
    expect(r).not.toContain("<");
    expect(r.toLowerCase()).not.toContain("</style");
  });

  it("remove @import, @charset e @namespace", () => {
    const r = limparCssPagina('@import url("https://x.com/a.css"); @charset "utf-8"; @IMPORT "b.css"; p{color:red}');
    expect(r.toLowerCase()).not.toContain("@import");
    expect(r).not.toContain("@charset");
    expect(r).toContain("color:red");
  });

  it("remove declarações com expression(), url(javascript:), behavior e -moz-binding", () => {
    const r = limparCssPagina(
      "p{color:red;width:expression(alert(1));background:url(javascript:alert(1))} a{background-image:url('JaVaScRiPt:x');behavior:url(x.htc);-moz-binding:url(x);margin:0} b{width:e\\78pression(1)}",
    );
    expect(r.toLowerCase()).not.toMatch(/expression|javascript|behavior|binding|pression/);
    expect(r).toContain("color:red");
    expect(r).toContain("margin:0");
  });

  it("mantém url http(s), relativa e data:image (com ; dentro)", () => {
    const r = limparCssPagina("p{background:url(https://x.com/a.png) no-repeat;background-image:url('data:image/png;base64,AAA=')}");
    expect(r).toContain("url(https://x.com/a.png) no-repeat");
    expect(r).toContain("url('data:image/png;base64,AAA=')");
  });

  it("escopa tudo em .vw-pagina (body/html/:root viram o contêiner)", () => {
    const r = limparCssPagina("* { box-sizing: border-box; } body { margin: 0 } h1, .x > p { color: #fff } body .a { color: red } #i{top:0}");
    expect(ESCOPO_PAGINA).toBe("vw-pagina");
    expect(r).toContain(".vw-pagina *{box-sizing: border-box}");
    expect(r).toContain(".vw-pagina{margin: 0}");
    expect(r).toContain(".vw-pagina h1,.vw-pagina .x > p{color: #fff}");
    expect(r).toContain(".vw-pagina .a{color: red}");
    expect(r).toContain(".vw-pagina #i{top:0}");
  });

  it("escopa dentro de @media/@supports; mantém @keyframes e @font-face sem escopo; descarta at-rule desconhecida", () => {
    const r = limparCssPagina(
      "@media (max-width: 768px){ .a{color:red} } @keyframes pulsar{ from{opacity:0} 50%{opacity:.5} to{opacity:1} } @font-face{font-family:X;src:url(https://x.com/x.woff2)} @document url(x){p{color:red}}",
    );
    expect(r).toContain("@media (max-width: 768px){.vw-pagina .a{color:red}}");
    expect(r).toContain("@keyframes pulsar{from{opacity:0}50%{opacity:.5}to{opacity:1}}");
    expect(r).toContain("@font-face{font-family:X;src:url(https://x.com/x.woff2)}");
    expect(r).not.toContain("@document");
  });

  it("é idempotente (o CSS salvo pelo editor pode passar de novo na sala)", () => {
    const uma = limparCssPagina("body{margin:0} h1,.x{color:#fff} @media (max-width: 768px){.a{color:red}} p{content:'<'}");
    expect(limparCssPagina(uma)).toBe(uma);
    expect(uma).not.toContain(".vw-pagina .vw-pagina");
  });

  it("remove comentários e tolera CSS quebrado sem lançar", () => {
    expect(limparCssPagina("/* oi */p{color:red}")).toBe(".vw-pagina p{color:red}");
    expect(() => limparCssPagina("p{color:red")).not.toThrow();
    expect(() => limparCssPagina("}}}{{{")).not.toThrow();
    expect(limparCssPagina("")).toBe("");
  });
});

describe("BLOCOS_VW e modelos", () => {
  it("lista os 8 blocos dinâmicos", () => {
    expect([...BLOCOS_VW]).toEqual(["titulo", "apresentador", "foto-apresentador", "data-sessao", "contagem", "formulario", "horarios", "vagas"]);
  });

  it("4 modelos, um por id, com projeto do GrapesJS equivalente ao html/css", () => {
    expect(MODELOS_PAGINA.map((m) => m.id)).toEqual(["registro_botao", "registro_form", "espera_jit", "espera_unica"]);
    for (const m of MODELOS_PAGINA) {
      expect(modeloPagina(m.id)).toBe(m);
      expect(m.projeto).toEqual({ pages: [{ component: m.html }], styles: m.css });
      // O HTML do modelo já sai limpo (nada que a limpeza arranque) e o CSS limpa sem perder regra.
      expect(limparHtmlPagina(m.html)).toBe(m.html.replace(/>\s+</g, "><").trim());
      expect(limparCssPagina(m.css).length).toBeGreaterThan(0);
      expect(validarConteudoPagina({ html: m.html, css: m.css })).toBeNull();
      expect(validarPagina({ nome: "x", tipo: m.tipo, modelo: m.id })).toHaveProperty("dados");
    }
  });

  it("modelos de registro têm formulário; de espera têm contagem e data, sem formulário", () => {
    for (const m of MODELOS_PAGINA) {
      const blocos = partesDaPagina(m.html).flatMap((p) => (p.tipo === "bloco" ? [p.bloco] : []));
      expect(blocos).toEqual(expect.arrayContaining(["titulo", "apresentador", "foto-apresentador"]));
      if (m.tipo === "registro_jit") {
        expect(temFormulario(m.html)).toBe(true);
        expect(validarVinculoPagina({ tipo: m.tipo, html: m.html }, "registro_jit")).toBeNull();
      } else {
        expect(blocos).toEqual(expect.arrayContaining(["contagem", "data-sessao"]));
        expect(temFormulario(m.html)).toBe(false);
      }
    }
    expect(modeloPagina("nao-existe")).toBeUndefined();
  });
});
