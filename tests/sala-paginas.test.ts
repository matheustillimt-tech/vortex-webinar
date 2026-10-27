import { beforeEach, describe, expect, it, vi } from "vitest";
import { configDaPaginaUsada, formularioMostraHorarios, metadadosDaPagina, montarPagina, type EstaticosPagina } from "@/src/lib/sala/pagina-montagem";
import { configPadrao } from "@/src/lib/regras/paginas-editor";

const dbAdmin = vi.fn();
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));

const EST: EstaticosPagina = {
  lugar: "espera",
  idioma: "pt-BR",
  titulo: "Aulão de IA",
  apresentador: "Rodrigo",
  fotoUrl: "https://cdn.exemplo.com/foto.jpg",
  dataSessao: "quinta-feira, 20/11 às 20:00",
};

const pagina = (html: string, css = "", config: unknown = {}) => ({ html, css, config });

describe("montarPagina", () => {
  it("junta tudo numa string só, com o bloco aninhado no meio das tags (sem quebrar a estrutura)", () => {
    const r = montarPagina(
      pagina('<section class="a"><div class="b"><p>Oi</p><div data-vw="contagem"></div></div></section>'),
      EST,
    );
    expect(r).not.toBeNull();
    expect(r!.html).toBe(
      '<section class="a"><div class="b"><p>Oi</p><span data-vw-montar="contagem" class="vw-bloco vw-contagem"></span></div></section>',
    );
    expect(r!.montar).toEqual(["contagem"]);
  });

  it("blocos estáticos saem prontos e escapados", () => {
    const r = montarPagina(
      pagina('<div data-vw="titulo"></div><div data-vw="apresentador"></div><div data-vw="foto-apresentador"></div><div data-vw="data-sessao"></div>'),
      { ...EST, titulo: '<img src=x onerror="alert(1)">', apresentador: 'Ana & "Bia"', fotoUrl: 'https://x.com/a.jpg" onerror="alert(1)' },
    )!;
    expect(r.html).toContain('<span class="vw-bloco vw-titulo">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</span>');
    expect(r.html).toContain('<span class="vw-bloco vw-apresentador">Ana &amp; &quot;Bia&quot;</span>');
    expect(r.html).toContain('src="https://x.com/a.jpg&quot; onerror=&quot;alert(1)"');
    expect(r.html).toContain('<span class="vw-bloco vw-data-sessao">quinta-feira, 20/11 às 20:00</span>');
    expect(r.html).not.toMatch(/<img[^>]* onerror="/);
    expect(r.montar).toEqual([]);
  });

  it("foto sem URL http(s) e campos vazios somem", () => {
    const r = montarPagina(
      pagina('<p>x</p><div data-vw="foto-apresentador"></div><div data-vw="titulo"></div><div data-vw="apresentador"></div>'),
      { ...EST, fotoUrl: "javascript:alert(1)", titulo: null, apresentador: null },
    )!;
    expect(r.html).toBe("<p>x</p>");
  });

  it("data da sessão sem texto pronto (JIT): vira ponto de montagem", () => {
    const r = montarPagina(pagina('<div data-vw="data-sessao"></div>'), { ...EST, dataSessao: null })!;
    expect(r.html).toBe('<span data-vw-montar="data-sessao" class="vw-bloco vw-data-sessao"></span>');
    expect(r.montar).toEqual(["data-sessao"]);
  });

  it("vagas: barra fixa em 87%", () => {
    const r = montarPagina(pagina('<div data-vw="vagas"></div>'), EST)!;
    expect(r.html).toContain("width:87%");
    expect(r.html).toContain("87% das vagas preenchidas");
  });

  it("remove XSS do HTML e do CSS (mesmo se o banco tiver algo sujo)", () => {
    const r = montarPagina(
      pagina(
        '<p onclick="alert(1)">a</p><script>alert(2)</script><a href="javascript:alert(3)">b</a><div data-vw="titulo" onmouseover="x()"></div>',
        "p{color:red}</style><script>alert(4)</script>div{background:url(javascript:alert(5))}",
      ),
      EST,
    )!;
    expect(r.html).not.toMatch(/onclick|<script|javascript:|onmouseover/);
    expect(r.html).toContain('<span class="vw-bloco vw-titulo">Aulão de IA</span>');
    expect(r.css).not.toMatch(/<\/style|<script|javascript:/);
    expect(r.css).toContain(".vw-pagina p{color:red}");
  });

  it("na espera, formulário e horários não renderizam nada", () => {
    const r = montarPagina(pagina('<p>a</p><div data-vw="formulario"></div><div data-vw="horarios"></div>'), EST)!;
    expect(r.html).toBe("<p>a</p>");
    expect(r.montar).toEqual([]);
  });

  it("no registro, formulário e horários viram pontos de montagem", () => {
    const r = montarPagina(pagina('<div data-vw="horarios"></div><div data-vw="formulario"></div>'), { ...EST, lugar: "registro", dataSessao: null })!;
    expect(r.html).toBe(
      '<span data-vw-montar="horarios" class="vw-bloco vw-horarios"></span><span data-vw-montar="formulario" class="vw-bloco vw-formulario"></span>',
    );
    expect(r.montar).toEqual(["horarios", "formulario"]);
  });

  it("fallback: página vazia, só espaço ou registro sem formulário → null (fica a tela atual)", () => {
    expect(montarPagina(pagina(""), EST)).toBeNull();
    expect(montarPagina(pagina("   \n "), EST)).toBeNull();
    expect(montarPagina(pagina("<script>alert(1)</script>"), EST)).toBeNull();
    expect(montarPagina(null, EST)).toBeNull();
    expect(montarPagina(pagina("<p>sem form</p>"), { ...EST, lugar: "registro" })).toBeNull();
  });

  it("fonte dos Ajustes (com padrão quando a config vem vazia)", () => {
    expect(montarPagina(pagina("<p>a</p>", "", { fonte: "Poppins" }), EST)!.fonte).toBe("Poppins");
    expect(montarPagina(pagina("<p>a</p>", "", null), EST)!.fonte).toBe("Inter");
  });
});

describe("formularioMostraHorarios", () => {
  it("com o bloco horarios na página, o formulário não repete a lista", () => {
    expect(formularioMostraHorarios(["horarios", "formulario"])).toBe(false);
    expect(formularioMostraHorarios(["formulario"])).toBe(true);
  });
});

describe("metadadosDaPagina", () => {
  const base = { title: "Aulão", description: "Desc", openGraph: { title: "Aulão", description: "Desc" } };
  it("usa título e descrição da página quando existem", () => {
    const m = metadadosDaPagina(base, { ...configPadrao(), titulo: "Inscreva-se", descricao: "Grátis" });
    expect(m.title).toBe("Inscreva-se");
    expect(m.description).toBe("Grátis");
    expect(m.openGraph).toMatchObject({ title: "Inscreva-se", description: "Grátis" });
  });
  it("sem página ou sem título/descrição: fica o que já era", () => {
    expect(metadadosDaPagina(base, null)).toEqual(base);
    expect(metadadosDaPagina(base, configPadrao())).toEqual(base);
  });
});

describe("configDaPaginaUsada", () => {
  it("só devolve os Ajustes quando a página vai aparecer", () => {
    expect(configDaPaginaUsada(pagina("<p>a</p>", "", { titulo: "T" }), "espera")?.titulo).toBe("T");
    expect(configDaPaginaUsada(pagina("", "", { titulo: "T" }), "espera")).toBeNull();
    expect(configDaPaginaUsada(pagina("<p>a</p>", "", { titulo: "T" }), "registro")).toBeNull();
    expect(configDaPaginaUsada(null, "registro")).toBeNull();
  });
});

// Carregamento ------------------------------------------------------------------------------------------------------

function chain(resultado: unknown, chamadas: string[] = []) {
  const p: Record<string, unknown> = Promise.resolve(resultado) as unknown as Record<string, unknown>;
  for (const m of ["select", "eq", "maybeSingle"]) {
    p[m] = (...a: unknown[]) => {
      chamadas.push(`${m}(${a.join(",")})`);
      return p;
    };
  }
  return p;
}

function db(mapa: Record<string, unknown>, chamadas: Record<string, string[]> = {}) {
  return {
    from: vi.fn((tabela: string) => {
      if (!(tabela in mapa)) throw new Error(`tabela inesperada: ${tabela}`);
      chamadas[tabela] = chamadas[tabela] ?? [];
      return chain(mapa[tabela], chamadas[tabela]);
    }),
  };
}

const LINHA_PAGINA = { tipo: "registro_jit", html: '<div data-vw="formulario"></div>', css: "", config: {} };

describe("vinculoDaPagina", () => {
  it("escolhe a coluna e o tipo certos por tipo de agenda e lugar", async () => {
    const { vinculoDaPagina } = await import("@/src/lib/sala/paginas");
    expect(vinculoDaPagina("jit", "registro")).toEqual({ tabela: "jit_config", coluna: "pagina_registro_id", tipo: "registro_jit" });
    expect(vinculoDaPagina("jit", "espera")).toEqual({ tabela: "jit_config", coluna: "pagina_espera_id", tipo: "espera_jit" });
    expect(vinculoDaPagina("unica", "espera")).toEqual({ tabela: "agendas", coluna: "pagina_espera_id", tipo: "espera_unica" });
    expect(vinculoDaPagina("recorrente", "espera")).toEqual({ tabela: "agendas", coluna: "pagina_espera_id", tipo: "espera_unica" });
    expect(vinculoDaPagina("unica", "registro")).toBeNull();
  });
});

describe("carregarPaginaDaSala", () => {
  beforeEach(() => {
    vi.resetModules();
    dbAdmin.mockReset();
  });

  it("JIT /lp: lê o vínculo em jit_config e a página (só os campos públicos)", async () => {
    const chamadas: Record<string, string[]> = {};
    dbAdmin.mockReturnValue(
      db({ jit_config: { data: { pagina_registro_id: "pag-1" } }, paginas: { data: LINHA_PAGINA } }, chamadas),
    );
    const { carregarPaginaDaSala } = await import("@/src/lib/sala/paginas");
    const p = await carregarPaginaDaSala("web-1", "jit", "registro");
    expect(p).toEqual({ tipo: "registro_jit", html: LINHA_PAGINA.html, css: "", config: {} });
    expect(chamadas.jit_config).toContain("select(pagina_registro_id)");
    expect(chamadas.jit_config).toContain("eq(webinar_id,web-1)");
    expect(chamadas.paginas).toContain("select(tipo, html, css, config)");
    expect(chamadas.paginas).toContain("eq(id,pag-1)");
  });

  it("sessão única /espera: lê o vínculo em agendas", async () => {
    const chamadas: Record<string, string[]> = {};
    dbAdmin.mockReturnValue(
      db({ agendas: { data: { pagina_espera_id: "pag-2" } }, paginas: { data: { ...LINHA_PAGINA, tipo: "espera_unica" } } }, chamadas),
    );
    const { carregarPaginaDaSala } = await import("@/src/lib/sala/paginas");
    expect((await carregarPaginaDaSala("web-1", "unica", "espera"))?.tipo).toBe("espera_unica");
    expect(chamadas.agendas).toContain("select(pagina_espera_id)");
  });

  it("sem vínculo, página de outro tipo ou lugar sem página: null", async () => {
    const { carregarPaginaDaSala } = await import("@/src/lib/sala/paginas");
    dbAdmin.mockReturnValue(db({ jit_config: { data: { pagina_espera_id: null } } }));
    expect(await carregarPaginaDaSala("web-1", "jit", "espera")).toBeNull();
    dbAdmin.mockReturnValue(db({ jit_config: { data: null } }));
    expect(await carregarPaginaDaSala("web-1", "jit", "espera")).toBeNull();
    dbAdmin.mockReturnValue(db({ jit_config: { data: { pagina_espera_id: "p" } }, paginas: { data: LINHA_PAGINA } }));
    expect(await carregarPaginaDaSala("web-1", "jit", "espera")).toBeNull();
    dbAdmin.mockReturnValue(db({}));
    expect(await carregarPaginaDaSala("web-1", "unica", "registro")).toBeNull();
  });

  it("erro no banco: loga e cai na tela atual (null), sem lançar", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    dbAdmin.mockReturnValue(db({ jit_config: { data: null, error: { message: "fora do ar" } } }));
    const { carregarPaginaDaSala } = await import("@/src/lib/sala/paginas");
    expect(await carregarPaginaDaSala("web-1", "jit", "registro")).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
