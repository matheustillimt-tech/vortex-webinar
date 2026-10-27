import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const exigirUsuario = vi.fn();
const dbUsuario = vi.fn();
const dbAdmin = vi.fn();
const registrarAuditoria = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/src/lib/supabase/usuario", () => ({
  exigirAdmin: (...a: unknown[]) => exigirAdmin(...a),
  exigirUsuario: (...a: unknown[]) => exigirUsuario(...a),
  dbUsuario: (...a: unknown[]) => dbUsuario(...a),
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));
vi.mock("@/src/lib/env", () => ({ emailConfig: () => null }));
vi.mock("@/src/lib/email/resend", () => ({ enviarEmail: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (...a: [string]) => redirect(...a) }));

type Tabela = { lista?: unknown[]; unico?: unknown; inserido?: unknown; erroLer?: unknown; erroEscrita?: unknown };
type Chamada = { tabela: string; metodo: string; args: unknown[] };

/** Supabase falso: leitura devolve `lista` (await/range) ou `unico` (single/maybeSingle); escrita devolve
 *  `erroEscrita` e, com `.select().single()`, `inserido`. Registra todas as chamadas. */
function criarDb(tabelas: Record<string, Tabela>) {
  const chamadas: Chamada[] = [];
  const from = (tabela: string) => {
    const t = tabelas[tabela] ?? {};
    let escrita = false;
    const no: any = {};
    for (const m of ["select", "eq", "or", "in", "ilike", "like", "order", "limit", "insert", "upsert", "update", "delete"]) {
      no[m] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo: m, args });
        if (["insert", "upsert", "update", "delete"].includes(m)) escrita = true;
        return no;
      };
    }
    const unico = () =>
      Promise.resolve(escrita ? { data: t.erroEscrita ? null : (t.inserido ?? null), error: t.erroEscrita ?? null } : { data: t.unico ?? null, error: t.erroLer ?? null });
    no.single = unico;
    no.maybeSingle = unico;
    no.range = () => Promise.resolve({ data: t.lista ?? [], error: t.erroLer ?? null });
    no.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
      Promise.resolve(escrita ? { error: t.erroEscrita ?? null } : { data: t.lista ?? [], error: t.erroLer ?? null }).then(ok, falha);
    return no;
  };
  return {
    db: { from },
    chamadas,
    escritas: (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo).map((c) => c.args),
  };
}

function form(campos: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const ID = "11111111-2222-4333-8444-555555555555";
const WEB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const acoes = () => import("../app/(painel)/paginas/actions");

const CONFIG = { cor_fundo: "#101010", titulo: "Aulão", descricao: "Aula grátis", fonte: "Poppins", css_personalizado: ".x{color:red}" };
const PROJETO = { pages: [{ component: "<h1>Oi</h1>" }], styles: "" };

beforeEach(() => {
  vi.resetModules();
  exigirAdmin.mockReset().mockResolvedValue({ id: "admin-1", nome: "Paula", papel: "admin" });
  exigirUsuario.mockReset().mockResolvedValue({ id: "auth-1", email: "paula@exemplo.com" });
  dbUsuario.mockReset();
  dbAdmin.mockReset();
  registrarAuditoria.mockReset();
  revalidatePath.mockReset();
  redirect.mockClear();
});

describe("criarPagina", () => {
  it("grava html/css (limpos), componentes e config do modelo e abre o editor", async () => {
    const f = criarDb({ paginas: { inserido: { id: ID } } });
    dbUsuario.mockResolvedValue(f.db);
    const { criarPagina } = await acoes();
    await expect(criarPagina({}, form({ nome: " Registro novembro ", tipo: "registro_jit", modelo: "registro_form" }))).rejects.toThrow(`REDIRECT:/paginas/${ID}/editor`);

    const [[linha]] = f.escritas("paginas", "insert") as [[Record<string, any>]];
    expect(linha.nome).toBe("Registro novembro");
    expect(linha.tipo).toBe("registro_jit");
    expect(linha.modelo).toBe("registro_form");
    expect(linha.html).toContain('<div data-vw="formulario"></div>');
    expect(linha.css).toContain(".vw-pagina");
    expect(linha.componentes.pages[0].component).toContain('data-vw="formulario"');
    expect(linha.config).toEqual(expect.objectContaining({ titulo: "Registro novembro", fonte: "Inter" }));
    expect(linha.atualizado_por).toBe("admin-1");
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: "admin-1", acao: "criou", descricao: 'Criou a página "Registro novembro"' }));
  });

  it("recusa modelo de outro tipo, sem gravar", async () => {
    const f = criarDb({});
    dbUsuario.mockResolvedValue(f.db);
    const { criarPagina } = await acoes();
    const r = await criarPagina({}, form({ nome: "X", tipo: "espera_jit", modelo: "registro_form" }));
    expect(r.erro).toBe("Escolha um modelo deste tipo de página.");
    expect(r.valores).toEqual({ nome: "X", tipo: "espera_jit", modelo: "registro_form" });
    expect(f.chamadas).toEqual([]);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("sem admin: não faz nada", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { criarPagina } = await acoes();
    await expect(criarPagina({}, form({ nome: "X", tipo: "espera_jit", modelo: "espera_jit" }))).rejects.toThrow("Só administradores");
    expect(dbUsuario).not.toHaveBeenCalled();
  });
});

describe("duplicarPagina", () => {
  it("copia conteúdo com (cópia) no nome e registra auditoria", async () => {
    const original = { nome: "Espera", tipo: "espera_jit", modelo: "espera_jit", config: CONFIG, componentes: PROJETO, html: "<p>a</p>", css: ".vw-pagina p{color:red}" };
    const f = criarDb({ paginas: { unico: original, inserido: { id: "nova" } } });
    dbUsuario.mockResolvedValue(f.db);
    const { duplicarPagina } = await acoes();
    expect(await duplicarPagina(ID)).toEqual({ id: "nova" });
    expect(f.escritas("paginas", "insert")).toEqual([[{ ...original, nome: "Espera (cópia)", atualizado_por: "admin-1" }]]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "criou", descricao: 'Duplicou a página "Espera"' }));
  });

  it("nome no limite: corta para caber o sufixo", async () => {
    const f = criarDb({ paginas: { unico: { nome: "a".repeat(120), tipo: "espera_jit", modelo: "espera_jit", config: {}, componentes: {}, html: "", css: "" }, inserido: { id: "n" } } });
    dbUsuario.mockResolvedValue(f.db);
    const { duplicarPagina } = await acoes();
    await duplicarPagina(ID);
    const [[linha]] = f.escritas("paginas", "insert") as [[{ nome: string }]];
    expect(linha.nome.length).toBe(120);
    expect(linha.nome.endsWith(" (cópia)")).toBe(true);
  });
});

describe("renomearPagina", () => {
  it("valida o nome", async () => {
    const { renomearPagina } = await acoes();
    expect(await renomearPagina(ID, "  ")).toEqual({ erro: "Informe o nome da página." });
    expect(await renomearPagina(ID, "x".repeat(121))).toEqual({ erro: "Use até 120 caracteres no nome." });
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("renomeia e audita antes/depois", async () => {
    const f = criarDb({ paginas: { unico: { nome: "Velho" } } });
    dbUsuario.mockResolvedValue(f.db);
    const { renomearPagina } = await acoes();
    expect(await renomearPagina(ID, " Novo ")).toEqual({});
    expect(f.escritas("paginas", "update")).toEqual([[{ nome: "Novo", atualizado_por: "admin-1" }]]);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "editou", descricao: 'Renomeou a página "Velho" para "Novo"', antes: { nome: "Velho" }, depois: { nome: "Novo" } }),
    );
  });
});

describe("salvarPagina", () => {
  it("grava html/css limpos (sem script, CSS escopado com Ajustes e personalizado), projeto, config e atualizado_por", async () => {
    const f = criarDb({ paginas: { unico: { nome: "Registro", html: "", css: "", config: {} } } });
    dbUsuario.mockResolvedValue(f.db);
    const { salvarPagina } = await acoes();
    const r = await salvarPagina(ID, {
      html: '<body><h1 onclick="alert(1)">Oi</h1><script>alert(1)</script><div data-vw="formulario"><b>prévia</b></div></body>',
      css: "body{margin:0} @import url(https://x.com/a.css); h1{color:#fff}",
      projeto: PROJETO,
      config: CONFIG,
    });
    expect(r).toEqual({ ok: true });
    const [[linha]] = f.escritas("paginas", "update") as [[Record<string, any>]];
    expect(linha.html).toBe('<h1>Oi</h1><div data-vw="formulario"></div>');
    expect(linha.css).not.toContain("@import");
    expect(linha.css).toContain(".vw-pagina h1{color:#fff}");
    expect(linha.css).toContain(".vw-pagina{background-color:#101010;font-family:'Poppins'");
    expect(linha.css).toContain(".vw-pagina .x{color:red}");
    expect(linha.componentes).toEqual(PROJETO);
    expect(linha.config).toEqual(CONFIG);
    expect(linha.atualizado_por).toBe("admin-1");
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "editou", descricao: 'Editou a página "Registro"' }));
  });

  it("recusa projeto acima de 1 MB", async () => {
    const f = criarDb({ paginas: { unico: { nome: "R", html: "", css: "", config: {} } } });
    dbUsuario.mockResolvedValue(f.db);
    const { salvarPagina } = await acoes();
    const r = await salvarPagina(ID, { html: "<p>a</p>", css: "", projeto: { pages: [{ component: "x".repeat(1024 * 1024) }] }, config: CONFIG });
    expect(r.erro).toMatch(/1 MB/);
    expect(f.escritas("paginas", "update")).toEqual([]);
  });

  it("recusa HTML acima de 300 KB e CSS personalizado acima de 100 KB", async () => {
    const f = criarDb({ paginas: { unico: { nome: "R", html: "", css: "", config: {} } } });
    dbUsuario.mockResolvedValue(f.db);
    const { salvarPagina } = await acoes();
    const html = await salvarPagina(ID, { html: `<p>${"a".repeat(300 * 1024)}</p>`, css: "", projeto: PROJETO, config: CONFIG });
    expect(html.erro).toBe("A página ficou grande demais (máximo de 300 KB de HTML).");
    const css = await salvarPagina(ID, { html: "<p>a</p>", css: "", projeto: PROJETO, config: { ...CONFIG, css_personalizado: `p{color:red}${" ".repeat(100 * 1024)}` } });
    expect(css.erro).toBe("O CSS personalizado ficou grande demais (máximo de 100 KB).");
    expect(f.escritas("paginas", "update")).toEqual([]);
  });

  it("recusa Ajustes inválidos (fonte fora da lista, cor)", async () => {
    dbUsuario.mockResolvedValue(criarDb({}).db);
    const { salvarPagina } = await acoes();
    expect((await salvarPagina(ID, { html: "", css: "", projeto: PROJETO, config: { ...CONFIG, fonte: "Comic Sans" } })).erro).toBe("Escolha uma das fontes da lista.");
    expect((await salvarPagina(ID, { html: "", css: "", projeto: PROJETO, config: { ...CONFIG, cor_fundo: "red;}" } })).erro).toMatch(/cor de fundo/);
  });

  it("sem admin: não salva", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { salvarPagina } = await acoes();
    await expect(salvarPagina(ID, { html: "", css: "", projeto: PROJETO, config: CONFIG })).rejects.toThrow("Só administradores");
    expect(dbUsuario).not.toHaveBeenCalled();
  });
});

describe("previaPagina", () => {
  it("devolve o documento limpo com os blocos como caixas", async () => {
    const { previaPagina } = await acoes();
    const r = await previaPagina({ html: '<h1>Oi</h1><script>x</script><div data-vw="contagem"></div>', css: "h1{color:red}", projeto: PROJETO, config: CONFIG });
    expect(r.documento).toContain('<div class="vw-pagina"><h1>Oi</h1><div class="vw-previa-bloco" data-vw-previa="contagem">Contagem regressiva');
    expect(r.documento).not.toContain("<script>");
    expect(r.documento).toContain("<title>Aulão</title>");
  });
});

describe("excluirPagina e webinarsVinculados", () => {
  const jit = [{ webinar_id: WEB, pagina_registro_id: ID, pagina_espera_id: ID, webinars: { nome: "Aulão" } }];
  const agendas = [{ webinar_id: "w2", webinars: { nome: "Live" } }];

  it("lista os vínculos com o lugar", async () => {
    dbUsuario.mockResolvedValue(criarDb({ jit_config: { lista: jit }, agendas: { lista: agendas } }).db);
    const { webinarsVinculados } = await acoes();
    const r = await webinarsVinculados(ID);
    expect(r.vinculos?.map((v) => [v.nome, v.lugar])).toEqual([
      ["Aulão", "registro_jit"],
      ["Aulão", "espera_jit"],
      ["Live", "espera_unica"],
    ]);
    expect(r.vinculos?.[0].rotulo).toBe("Página de registro (just in time)");
  });

  it("exclui página vinculada: audita a exclusão com os webinars e uma linha no histórico de cada webinar", async () => {
    const f = criarDb({ paginas: { unico: { nome: "Registro", tipo: "registro_jit", modelo: "registro_form" } }, jit_config: { lista: jit }, agendas: { lista: agendas } });
    dbUsuario.mockResolvedValue(f.db);
    const { excluirPagina } = await acoes();
    expect(await excluirPagina(ID)).toEqual({});
    expect(f.escritas("paginas", "delete")).toHaveLength(1);
    const geral = registrarAuditoria.mock.calls[0][0];
    expect(geral).toEqual(expect.objectContaining({ acao: "excluiu", descricao: 'Excluiu a página "Registro"' }));
    expect(geral.antes.webinars_vinculados).toHaveLength(3);
    const porWebinar = registrarAuditoria.mock.calls.slice(1).map((c) => c[0]);
    expect(porWebinar.map((a) => a.webinarId)).toEqual([WEB, "w2"]);
    expect(porWebinar[0].descricao).toContain("página de registro (just in time) e página de espera (just in time) voltou ao padrão");
  });

  it("id inválido não vai para o filtro", async () => {
    const f = criarDb({});
    dbUsuario.mockResolvedValue(f.db);
    const { excluirPagina, webinarsVinculados } = await acoes();
    expect(await excluirPagina("x),id.neq.0")).toEqual({ erro: "Página não encontrada." });
    expect(await webinarsVinculados("x),id.neq.0")).toEqual({ vinculos: [] });
    expect(f.chamadas.filter((c) => c.metodo === "or")).toEqual([]);
  });
});

describe("enviarImagemPagina", () => {
  function storageFalso() {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const getPublicUrl = vi.fn((caminho: string) => ({ data: { publicUrl: `https://cdn.exemplo/${caminho}` } }));
    dbAdmin.mockReturnValue({ storage: { from: () => ({ upload, getPublicUrl }) } });
    return upload;
  }

  it("envia GIF para midias/paginas/<id>/ e devolve a URL", async () => {
    const upload = storageFalso();
    dbUsuario.mockResolvedValue(criarDb({ paginas: { unico: { nome: "P" } } }).db);
    const { enviarImagemPagina } = await acoes();
    const r = await enviarImagemPagina(ID, form({ arquivo: new File([new Uint8Array(10)], "a.gif", { type: "image/gif" }) }));
    expect(r.url).toMatch(new RegExp(`^https://cdn.exemplo/paginas/${ID}/[0-9a-f-]{36}\\.gif$`));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "criou" }));
  });

  it("recusa tipo fora da lista e arquivo acima de 3 MB", async () => {
    const upload = storageFalso();
    dbUsuario.mockResolvedValue(criarDb({ paginas: { unico: { nome: "P" } } }).db);
    const { enviarImagemPagina } = await acoes();
    expect(await enviarImagemPagina(ID, form({ arquivo: new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }) }))).toEqual({ erro: "Use uma imagem JPG, PNG, WEBP ou GIF." });
    expect(await enviarImagemPagina(ID, form({ arquivo: new File([new Uint8Array(3 * 1024 * 1024 + 1)], "a.png", { type: "image/png" }) }))).toEqual({
      erro: "A imagem precisa ter até 3 MB.",
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it("sem admin: não envia", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const upload = storageFalso();
    const { enviarImagemPagina } = await acoes();
    await expect(enviarImagemPagina(ID, form({ arquivo: new File([new Uint8Array(10)], "a.png", { type: "image/png" }) }))).rejects.toThrow("Só administradores");
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("vínculos no webinar", () => {
  const PAG_REG = "22222222-2222-4333-8444-555555555555";
  const PAG_ESP = "33333333-2222-4333-8444-555555555555";

  it("JIT: grava registro e espera validados e audita", async () => {
    let n = 0;
    const paginas = [
      { tipo: "registro_jit", html: '<div data-vw="formulario"></div>' },
      { tipo: "espera_jit", html: "<p>a</p>" },
    ];
    const f = criarDb({ jit_config: { unico: { pagina_registro_id: null, pagina_espera_id: null } } });
    const base = f.db.from;
    f.db.from = (t: string) => (t === "paginas" ? { ...criarDb({ paginas: { unico: paginas[n++] } }).db.from(t) } : base(t));
    dbUsuario.mockResolvedValue(f.db);
    const { salvarPaginasJit } = await import("../app/(painel)/webinars/[id]/agenda/jit/actions");
    const r = await salvarPaginasJit(WEB, {}, form({ pagina_registro_id: PAG_REG, pagina_espera_id: PAG_ESP }));
    expect(r).toEqual({ ok: true });
    expect(f.escritas("jit_config", "upsert")).toEqual([[{ webinar_id: WEB, pagina_registro_id: PAG_REG, pagina_espera_id: PAG_ESP }, { onConflict: "webinar_id" }]]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ webinarId: WEB, descricao: "Mudou as páginas do just in time" }));
  });

  it("JIT: recusa página de registro sem formulário", async () => {
    const f = criarDb({ paginas: { unico: { tipo: "registro_jit", html: "<p>sem form</p>" } } });
    dbUsuario.mockResolvedValue(f.db);
    const { salvarPaginasJit } = await import("../app/(painel)/webinars/[id]/agenda/jit/actions");
    const r = await salvarPaginasJit(WEB, {}, form({ pagina_registro_id: PAG_REG, pagina_espera_id: "" }));
    expect(r).toEqual({ erro: "A página de registro precisa ter o formulário." });
    expect(f.escritas("jit_config", "upsert")).toEqual([]);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("JIT: Padrão grava null sem consultar páginas", async () => {
    const f = criarDb({});
    dbUsuario.mockResolvedValue(f.db);
    const { salvarPaginasJit } = await import("../app/(painel)/webinars/[id]/agenda/jit/actions");
    expect(await salvarPaginasJit(WEB, {}, form({ pagina_registro_id: "", pagina_espera_id: "" }))).toEqual({ ok: true });
    expect(f.escritas("jit_config", "upsert")[0][0]).toEqual({ webinar_id: WEB, pagina_registro_id: null, pagina_espera_id: null });
    expect(f.chamadas.some((c) => c.tabela === "paginas")).toBe(false);
  });

  it("Agenda: recusa página de outro tipo e grava a do tipo certo", async () => {
    const errada = criarDb({ paginas: { unico: { tipo: "espera_jit", html: "" } } });
    dbUsuario.mockResolvedValue(errada.db);
    const { salvarPaginaEspera } = await import("../app/(painel)/webinars/[id]/agenda/actions");
    expect(await salvarPaginaEspera(WEB, {}, form({ pagina_espera_id: PAG_ESP }))).toEqual({ erro: "Esta página não é do tipo certo para este lugar." });
    expect(errada.escritas("agendas", "upsert")).toEqual([]);

    const certa = criarDb({ paginas: { unico: { tipo: "espera_unica", html: "" } }, agendas: { unico: { pagina_espera_id: null } } });
    dbUsuario.mockResolvedValue(certa.db);
    expect(await salvarPaginaEspera(WEB, {}, form({ pagina_espera_id: PAG_ESP }))).toEqual({ ok: true });
    expect(certa.escritas("agendas", "upsert")[0][0]).toEqual({ webinar_id: WEB, pagina_espera_id: PAG_ESP });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ webinarId: WEB, descricao: "Mudou a página de espera" }));
  });

  it("sem admin: não grava vínculo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { salvarPaginaEspera } = await import("../app/(painel)/webinars/[id]/agenda/actions");
    await expect(salvarPaginaEspera(WEB, {}, form({ pagina_espera_id: "" }))).rejects.toThrow("Só administradores");
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("duplicarWebinar leva os ids de página do jit_config e da agenda", async () => {
    const f = criarDb({
      webinars: { unico: { id: WEB, nome: "Aulão", slug: "aulao", status: "ativo" }, inserido: { id: "novo" } },
      agendas: { unico: { id: "a1", webinar_id: WEB, pagina_espera_id: PAG_ESP, created_at: "x", updated_at: "x" } },
      jit_config: { unico: { id: "j1", webinar_id: WEB, pagina_registro_id: PAG_REG, pagina_espera_id: PAG_ESP } },
    });
    dbUsuario.mockResolvedValue(f.db);
    const { duplicarWebinar } = await import("../app/(painel)/webinars/actions");
    await expect(duplicarWebinar(WEB)).rejects.toThrow("REDIRECT:/webinars/novo/inicio");
    expect(f.escritas("agendas", "insert")).toEqual([[{ pagina_espera_id: PAG_ESP, webinar_id: "novo" }]]);
    expect(f.escritas("jit_config", "insert")).toEqual([[{ pagina_registro_id: PAG_REG, pagina_espera_id: PAG_ESP, webinar_id: "novo" }]]);
  });
});
