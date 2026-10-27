import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const carregarSala = vi.fn();
const salaCheia = vi.fn();
const criarSessao = vi.fn();
const lerSessaoDoCookie = vi.fn();
const cookieDaSessao = vi.fn();
const caminhoSalaMock = vi.fn();
const env = vi.fn();
const assinarTokenReal = await import("@/src/lib/regras/sessao-token");

vi.mock("@/src/lib/sala/dados", () => ({
  carregarSala: (...a: unknown[]) => carregarSala(...a),
  salaCheia: (...a: unknown[]) => salaCheia(...a),
}));
vi.mock("@/src/lib/sala/sessao", () => ({
  criarSessao: (...a: unknown[]) => criarSessao(...a),
  lerSessaoDoCookie: (...a: unknown[]) => lerSessaoDoCookie(...a),
  cookieDaSessao: (...a: unknown[]) => cookieDaSessao(...a),
  cookieNovoCadastro: (w: string) => ({ name: `vw_novo_cadastro_${w}`, value: "1", httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: 300 }),
  geoDoCabecalho: () => ({}),
  ipHashDoCabecalho: () => null,
}));
vi.mock("@/src/lib/sala/caminho", () => ({ caminhoSala: (...a: unknown[]) => caminhoSalaMock(...a) }));
vi.mock("@/src/lib/env", () => ({ env: (...a: unknown[]) => env(...a) }));

const SEGREDO = "segredo-teste";

const SALA_BASE = {
  webinar: { id: "web-1", status: "ativo" as const, acessoFacilitado: false, limiteSimultaneo: null },
  agenda: {
    fuso: "America/Sao_Paulo",
    inicio: new Date(Date.now() - 3_600_000),
    fim: new Date(Date.now() + 3_600_000),
    repeticao: "nenhuma" as const,
    diaSemana: null,
    horaInicio: null,
    horaFim: null,
    vigenciaFim: null,
  },
  telaLogin: { pedeEmail: true, emailObrigatorio: true, pedeTelefone: false, telefoneObrigatorio: false, paisPadrao: "BR" },
  video: { url: "https://x.com/a.m3u8" },
};

function req(qs: string, opcoes: { metodo?: "GET" | "POST"; ua?: string; corpo?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opcoes.ua) headers["user-agent"] = opcoes.ua;
  if (opcoes.corpo !== undefined) headers["content-type"] = "application/x-www-form-urlencoded";

  return new NextRequest(`https://aovivo.exemplo.com/s/turma-1/entrar${qs}`, {
    method: opcoes.metodo ?? "GET",
    headers,
    ...(opcoes.corpo !== undefined ? { body: opcoes.corpo } : {}),
  });
}

beforeEach(() => {
  vi.resetModules();
  carregarSala.mockReset();
  salaCheia.mockReset();
  criarSessao.mockReset();
  lerSessaoDoCookie.mockReset();
  cookieDaSessao.mockReset();
  caminhoSalaMock.mockReset();
  env.mockReset();

  carregarSala.mockResolvedValue(SALA_BASE);
  salaCheia.mockResolvedValue(false);
  lerSessaoDoCookie.mockResolvedValue(null);
  caminhoSalaMock.mockImplementation(async (slug: string, sufixo?: string) => (sufixo ? `/${slug}/${sufixo}` : `/${slug}`));
  env.mockImplementation((nome: string) => {
    if (nome === "SALA_TOKEN_SECRET") return SEGREDO;
    throw new Error(`env inesperada no teste: ${nome}`);
  });
  cookieDaSessao.mockReturnValue({ name: "vw_web-1", value: "token-x", httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 100 });
  criarSessao.mockResolvedValue({ sessaoId: "sess-1", token: "token-x" });
});

describe("GET /s/[slug]/entrar", () => {
  it("nunca cria sessão: devolve o HTML do formulário de auto-envio", async () => {
    const { GET } = await import("../app/s/[slug]/entrar/route");
    const res = await GET(req("?nome=Ana&email=ana%40x.com"), { params: Promise.resolve({ slug: "turma-1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("<form method=\"POST\"");
    expect(html).toContain("document.forms[0].submit()");
    expect(html).toContain('name="nome" value="Ana"');
    expect(criarSessao).not.toHaveBeenCalled();
    expect(carregarSala).not.toHaveBeenCalled();
  });

  it("o form posta no caminho público (/<slug>/entrar), não no reescrito /s/<slug>/entrar", async () => {
    const { GET } = await import("../app/s/[slug]/entrar/route");
    const res = await GET(req("?acesso=abc"), { params: Promise.resolve({ slug: "turma-1" }) });
    const html = await res.text();
    expect(caminhoSalaMock).toHaveBeenCalledWith("turma-1", "entrar");
    expect(html).toContain('action="/turma-1/entrar"');
    expect(html).not.toContain('action="/s/turma-1/entrar"');
  });

  it("slug inválido (ex.: decodificado de /s/%2Fevil.com): HTML de indisponível, sem Location pra outro host", async () => {
    const { GET } = await import("../app/s/[slug]/entrar/route");
    const res = await GET(req(""), { params: Promise.resolve({ slug: "/evil.com" }) });
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(400);
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("escapa valores da query no HTML (não injeta HTML/JS)", async () => {
    const { GET } = await import("../app/s/[slug]/entrar/route");
    const res = await GET(req(`?nome=${encodeURIComponent('"><script>alert(1)</script>')}`), {
      params: Promise.resolve({ slug: "turma-1" }),
    });
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("POST /s/[slug]/entrar", () => {
  it("link mágico (nome e email na query): cria a sessão com evento link_magico e redireciona pra sala", async () => {
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req("?nome=Ana&email=ana%40x.com", { metodo: "POST" }), { params: Promise.resolve({ slug: "turma-1" }) });

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1/sala");
    expect(criarSessao).toHaveBeenCalledWith(
      expect.objectContaining({
        dados: { nome: "Ana", email: "ana@x.com", telefone: null },
        linkMagico: true,
        temporario: false,
        modo: "ao_vivo",
      }),
    );
    expect(res.cookies.get("vw_web-1")?.value).toBe("token-x");
    // Cadastro novo deu certo: cookie de uso único pro pixel de lead.
    expect(res.cookies.get("vw_novo_cadastro_web-1")?.value).toBe("1");
  });

  it("slug inválido: HTML de indisponível, sem criar sessão e sem Location", async () => {
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req("", { metodo: "POST" }), { params: Promise.resolve({ slug: "/evil.com" }) });
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(400);
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("User-Agent de bot de preview: devolve o formulário de novo, sem criar sessão", async () => {
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req("?nome=Ana&email=ana%40x.com", { metodo: "POST", ua: "facebookexternalhit/1.1" }), {
      params: Promise.resolve({ slug: "turma-1" }),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<form method=\"POST\"");
    expect(criarSessao).not.toHaveBeenCalled();
    expect(carregarSala).not.toHaveBeenCalled();
  });

  it("placeholder não substituído no link mágico: não é um link mágico válido -> volta pra raiz da sala", async () => {
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req("?nome=NOME_USUARIO", { metodo: "POST" }), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1");
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("acesso facilitado sem nenhum campo: cria sessão provisória", async () => {
    carregarSala.mockResolvedValue({ ...SALA_BASE, webinar: { ...SALA_BASE.webinar, acessoFacilitado: true } });
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req("", { metodo: "POST" }), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1/sala");
    expect(criarSessao).toHaveBeenCalledWith(expect.objectContaining({ temporario: true, linkMagico: false }));
    expect(res.cookies.get("vw_novo_cadastro_web-1")).toBeUndefined();
  });

  it("token de teste válido pro webinar: cria sessão de teste (modo teste)", async () => {
    const token = assinarTokenReal.assinarToken({ w: "web-1", t: 1, exp: Math.floor(Date.now() / 1000) + 60 }, SEGREDO);
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req(`?teste=${token}`, { metodo: "POST" }), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1/sala");
    expect(criarSessao).toHaveBeenCalledWith(expect.objectContaining({ modo: "teste", temporario: false, linkMagico: false }));
    // Teste não é cadastro novo: nada de pixel de lead.
    expect(res.cookies.get("vw_novo_cadastro_web-1")).toBeUndefined();
  });

  it("token de teste com nome e telefone na URL: sessão de teste com esses dados (pra testar webhook)", async () => {
    const token = assinarTokenReal.assinarToken({ w: "web-1", t: 1, exp: Math.floor(Date.now() / 1000) + 60 }, SEGREDO);
    const { POST } = await import("../app/s/[slug]/entrar/route");
    await POST(req(`?teste=${token}&nome=Ana&telefone=11900000002`, { metodo: "POST" }), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(criarSessao).toHaveBeenCalledWith(
      expect.objectContaining({ modo: "teste", linkMagico: false, dados: expect.objectContaining({ nome: "Ana", telefone: expect.stringContaining("11900000002") }) }),
    );
  });

  it("token de teste válido com sessão normal no cookie: cria uma sessão de teste nova mesmo assim", async () => {
    lerSessaoDoCookie.mockResolvedValue({ sessaoId: "sess-normal", modo: "ao_vivo" });
    const token = assinarTokenReal.assinarToken({ w: "web-1", t: 1, exp: Math.floor(Date.now() / 1000) + 60 }, SEGREDO);
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req(`?teste=${token}`, { metodo: "POST" }), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1/sala");
    expect(criarSessao).toHaveBeenCalledWith(expect.objectContaining({ modo: "teste", temporario: false }));
    expect(res.cookies.get("vw_web-1")?.value).toBe("token-x");
  });

  it("link mágico com sessão de teste no cookie: cria sessão ao vivo nova (sem loop pra raiz)", async () => {
    lerSessaoDoCookie.mockResolvedValue({ sessaoId: "sess-teste", modo: "teste" });
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req("?nome=Ana&email=ana%40x.com", { metodo: "POST" }), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1/sala");
    expect(criarSessao).toHaveBeenCalledWith(expect.objectContaining({ modo: "ao_vivo", linkMagico: true }));
    expect(res.cookies.get("vw_web-1")?.value).toBe("token-x");
  });

  it("token de teste de outro webinar: ignorado, volta pra raiz sem criar sessão", async () => {
    const token = assinarTokenReal.assinarToken({ w: "outro-webinar", t: 1, exp: Math.floor(Date.now() / 1000) + 60 }, SEGREDO);
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req(`?teste=${token}`, { metodo: "POST" }), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1");
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("sala cheia: sem link mágico nem facilitado, volta pra raiz sem criar sessão", async () => {
    salaCheia.mockResolvedValue(true);
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req("", { metodo: "POST" }), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1");
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("webinar não existe: volta pra raiz sem criar sessão", async () => {
    carregarSala.mockResolvedValue(null);
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req("?nome=Ana", { metodo: "POST" }), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1");
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("criarSessao falha: volta pra raiz sem lançar", async () => {
    criarSessao.mockRejectedValue(new Error("Não deu para abrir sua sessão."));
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req("?nome=Ana", { metodo: "POST" }), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1");
  });

  it("dev: aberto em sala.localhost, redireciona no mesmo host (o req.url do Next vem como localhost)", async () => {
    const antes = process.env.NEXT_PUBLIC_SALA_URL;
    process.env.NEXT_PUBLIC_SALA_URL = "http://sala.localhost:3150";
    try {
      const token = assinarTokenReal.assinarToken({ w: "web-1", t: 1, exp: Math.floor(Date.now() / 1000) + 60 }, SEGREDO);
      const { POST } = await import("../app/s/[slug]/entrar/route");
      const r = new NextRequest(`http://localhost:3150/s/turma-1/entrar?teste=${token}`, { method: "POST", headers: { host: "sala.localhost:3150" } });
      const res = await POST(r, { params: Promise.resolve({ slug: "turma-1" }) });
      expect(res.headers.get("location")).toBe("http://sala.localhost:3150/turma-1/sala");
    } finally {
      if (antes === undefined) delete process.env.NEXT_PUBLIC_SALA_URL;
      else process.env.NEXT_PUBLIC_SALA_URL = antes;
    }
  });
});
