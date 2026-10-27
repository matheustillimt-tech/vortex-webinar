import { beforeEach, describe, expect, it, vi } from "vitest";

const carregarSala = vi.fn();
const salaCheia = vi.fn();
const criarSessao = vi.fn();
const lerSessaoDoCookie = vi.fn();
const cookieDaSessao = vi.fn();
const caminhoSalaMock = vi.fn();
const cookiesSet = vi.fn();
const headersMock = vi.fn();

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
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (...a: unknown[]) => cookiesSet(...a) }),
  headers: async () => headersMock(),
}));
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (...a: [string]) => redirect(...a) }));

const SALA_BASE = {
  webinar: { id: "web-1", status: "ativo" as const, acessoFacilitado: false, limiteSimultaneo: null },
  // Janela aberta agora, pra que o estado da agenda nunca entre no caminho dos testes de cadastro.
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

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.resetModules();
  carregarSala.mockReset();
  salaCheia.mockReset();
  criarSessao.mockReset();
  lerSessaoDoCookie.mockReset();
  cookieDaSessao.mockReset();
  caminhoSalaMock.mockReset();
  cookiesSet.mockReset();
  headersMock.mockReset();
  redirect.mockClear();

  carregarSala.mockResolvedValue(SALA_BASE);
  salaCheia.mockResolvedValue(false);
  lerSessaoDoCookie.mockResolvedValue(null);
  caminhoSalaMock.mockImplementation(async (slug: string, sufixo?: string) => (sufixo ? `/${slug}/${sufixo}` : `/${slug}`));
  headersMock.mockReturnValue(new Headers());
  cookieDaSessao.mockReturnValue({ name: "vw_web-1", value: "token-x", httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 100 });
  criarSessao.mockResolvedValue({ sessaoId: "sess-1", token: "token-x" });
});

describe("entrar", () => {
  it("slug fora do formato (ex.: \"/evil.com\"): devolve erro sem tocar em caminhoSala nem criar sessão", async () => {
    const { entrar } = await import("../app/s/[slug]/actions");
    const r = await entrar("/evil.com", {}, form({ nome: "Ana", email: "ana@x.com" }));
    expect(r).toEqual({ erro: "Sala não encontrada." });
    expect(carregarSala).not.toHaveBeenCalled();
    expect(criarSessao).not.toHaveBeenCalled();
    expect(caminhoSalaMock).not.toHaveBeenCalled();
  });

  it("utms do campo oculto passam pelo mesmo filtro de utmsDaUrl (só utm_*, só string, limite de chaves e tamanho)", async () => {
    const { entrar } = await import("../app/s/[slug]/actions");
    const utmsMaliciosas = {
      utm_source: "ig",
      naoEhUtm: "deveria cair fora",
      utm_numero: 123, // não é string: deve cair fora
      utm_longo: "a".repeat(250),
    };
    const f = form({ nome: "Ana", email: "ana@x.com", utms: JSON.stringify(utmsMaliciosas) });
    await expect(entrar("turma-1", {}, f)).rejects.toThrow("REDIRECT:");
    expect(criarSessao).toHaveBeenCalledWith(
      expect.objectContaining({ utms: { utm_source: "ig", utm_longo: "a".repeat(200) } }),
    );
  });

  it("nome vazio: devolve erro e os valores digitados, sem criar sessão", async () => {
    const { entrar } = await import("../app/s/[slug]/actions");
    const r = await entrar("turma-1", {}, form({ nome: "", email: "a@b.com" }));
    expect(r).toEqual({ erro: "Informe seu nome.", valores: { nome: "", email: "a@b.com", telefone: "" } });
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("webinar não existe: redireciona pra raiz da sala", async () => {
    carregarSala.mockResolvedValue(null);
    const { entrar } = await import("../app/s/[slug]/actions");
    await expect(entrar("turma-1", {}, form({ nome: "Ana", email: "ana@x.com" }))).rejects.toThrow("REDIRECT:/turma-1");
  });

  it("sala cheia: redireciona pra /cheia sem criar sessão", async () => {
    salaCheia.mockResolvedValue(true);
    const { entrar } = await import("../app/s/[slug]/actions");
    await expect(entrar("turma-1", {}, form({ nome: "Ana", email: "ana@x.com" }))).rejects.toThrow("REDIRECT:/turma-1/cheia");
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("webinar arquivado: redireciona pra raiz (indisponível), sem criar sessão", async () => {
    carregarSala.mockResolvedValue({ ...SALA_BASE, webinar: { ...SALA_BASE.webinar, status: "arquivado" } });
    const { entrar } = await import("../app/s/[slug]/actions");
    await expect(entrar("turma-1", {}, form({ nome: "Ana", email: "ana@x.com" }))).rejects.toThrow("REDIRECT:/turma-1");
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("já tem sessão válida: redireciona direto pra sala, sem criar outra sessão", async () => {
    lerSessaoDoCookie.mockResolvedValue({ sessaoId: "sess-0" });
    const { entrar } = await import("../app/s/[slug]/actions");
    await expect(entrar("turma-1", {}, form({ nome: "Ana", email: "ana@x.com" }))).rejects.toThrow("REDIRECT:/turma-1/sala");
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("sessão de teste no cookie: ignora e cria uma sessão ao vivo nova (link normal não cai no teste)", async () => {
    lerSessaoDoCookie.mockResolvedValue({ sessaoId: "sess-teste", modo: "teste" });
    const { entrar } = await import("../app/s/[slug]/actions");
    await expect(entrar("turma-1", {}, form({ nome: "Ana", email: "ana@x.com" }))).rejects.toThrow("REDIRECT:/turma-1/sala");
    expect(criarSessao).toHaveBeenCalledWith(expect.objectContaining({ modo: "ao_vivo" }));
    expect(cookiesSet).toHaveBeenCalledWith("vw_web-1", "token-x", expect.anything());
  });

  it("replay com sessão válida: vai pra sala levando replay=1", async () => {
    lerSessaoDoCookie.mockResolvedValue({ sessaoId: "sess-0" });
    const { entrar } = await import("../app/s/[slug]/actions");
    await expect(entrar("turma-1", {}, form({ nome: "Ana", email: "ana@x.com", replay: "1" }))).rejects.toThrow("REDIRECT:/turma-1/sala?replay=1");
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("tudo certo: cria a sessão, grava o cookie e redireciona pra sala", async () => {
    const { entrar } = await import("../app/s/[slug]/actions");
    await expect(entrar("turma-1", {}, form({ nome: "Ana", email: "ana@x.com" }))).rejects.toThrow("REDIRECT:/turma-1/sala");

    expect(criarSessao).toHaveBeenCalledWith(
      expect.objectContaining({ dados: { nome: "Ana", email: "ana@x.com", telefone: null }, modo: "ao_vivo", temporario: false }),
    );
    expect(cookiesSet).toHaveBeenCalledWith("vw_web-1", "token-x", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 100 });
    // Cadastro deu certo: cookie de uso único pro pixel de lead (nunca antes do sucesso).
    expect(cookiesSet).toHaveBeenCalledWith("vw_novo_cadastro_web-1", "1", expect.objectContaining({ httpOnly: false, maxAge: 300 }));
  });

  it("replay=1 cria sessão no modo replay", async () => {
    const { entrar } = await import("../app/s/[slug]/actions");
    await expect(entrar("turma-1", {}, form({ nome: "Ana", email: "ana@x.com", replay: "1" }))).rejects.toThrow("REDIRECT:/turma-1/sala?replay=1");
    expect(criarSessao).toHaveBeenCalledWith(expect.objectContaining({ modo: "replay" }));
  });

  it("criarSessao falha: devolve a mensagem de erro padrão, sem lançar", async () => {
    criarSessao.mockRejectedValue(new Error("Não deu para abrir sua sessão."));
    const { entrar } = await import("../app/s/[slug]/actions");
    const r = await entrar("turma-1", {}, form({ nome: "Ana", email: "ana@x.com" }));
    expect(r).toEqual({ erro: "Não deu para abrir sua sessão.", valores: { nome: "Ana", email: "ana@x.com", telefone: "" } });
    expect(cookiesSet).not.toHaveBeenCalled();
  });

  it("utms do campo oculto chegam até criarSessao", async () => {
    const { entrar } = await import("../app/s/[slug]/actions");
    const f = form({ nome: "Ana", email: "ana@x.com", utms: JSON.stringify({ utm_source: "ig" }) });
    await expect(entrar("turma-1", {}, f)).rejects.toThrow("REDIRECT:");
    expect(criarSessao).toHaveBeenCalledWith(expect.objectContaining({ utms: { utm_source: "ig" } }));
  });
});
