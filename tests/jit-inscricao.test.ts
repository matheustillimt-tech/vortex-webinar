import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const carregarSala = vi.fn();
const salaCheia = vi.fn();
const criarSessao = vi.fn();
const lerSessaoDoCookie = vi.fn();
const buscarInscricaoJit = vi.fn();
const sessaoDoAcesso = vi.fn();
const enfileirarEmailsDaInscricao = vi.fn();
const caminhoSalaMock = vi.fn();
const cookiesSet = vi.fn();
const env = vi.fn();
const dbAdmin = vi.fn();

const SEGREDO = "segredo-teste";

vi.mock("@/src/lib/sala/dados", () => ({
  carregarSala: (...a: unknown[]) => carregarSala(...a),
  salaCheia: (...a: unknown[]) => salaCheia(...a),
}));
vi.mock("@/src/lib/sala/sessao", async () => {
  const token = await import("@/src/lib/regras/sessao-token");
  return {
    criarSessao: (...a: unknown[]) => criarSessao(...a),
    lerSessaoDoCookie: (...a: unknown[]) => lerSessaoDoCookie(...a),
    buscarInscricaoJit: (...a: unknown[]) => buscarInscricaoJit(...a),
    sessaoDoAcesso: (...a: unknown[]) => sessaoDoAcesso(...a),
    tokenDaSessao: (s: string, w: string, exp: number) => token.assinarToken({ s, w, exp }, SEGREDO),
    cookieDaSessao: (w: string, value: string, maxAge = 43200) => ({ name: `vw_${w}`, value, httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge }),
    cookieNovoCadastro: (w: string) => ({ name: `vw_novo_cadastro_${w}`, value: "1", httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: 300 }),
    geoDoCabecalho: () => ({}),
    ipHashDoCabecalho: () => null,
  };
});
vi.mock("@/src/lib/emails", () => ({ enfileirarEmailsDaInscricao: (...a: unknown[]) => enfileirarEmailsDaInscricao(...a) }));
vi.mock("@/src/lib/sala/caminho", () => ({ caminhoSala: (...a: unknown[]) => caminhoSalaMock(...a) }));
vi.mock("@/src/lib/env", () => ({ env: (...a: unknown[]) => env(...a) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (...a: unknown[]) => cookiesSet(...a) }),
  headers: async () => new Headers(),
}));
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (...a: [string]) => redirect(...a) }));

// Todo dia às 20:00 em Brasília: com "agora" fixo, o próximo é amanhã 20:00 (23:00Z).
const HORARIO_1 = "2026-11-03T23:00:00.000Z";
const HORARIO_2 = "2026-11-04T23:00:00.000Z";
const AGORA = new Date("2026-11-03T12:00:00Z");

const SALA_JIT = {
  webinar: { id: "web-1", status: "ativo" as const, tipoAgenda: "jit" as const, idioma: "pt-BR" as const, acessoFacilitado: false, limiteSimultaneo: null },
  agenda: null,
  jit: {
    horarios: [{ quando: "todo_dia" as const, hora: "20:00", intervaloMin: null, data: null, diaSemana: null }],
    config: { fuso: "America/Sao_Paulo", esconderDe: null, esconderAte: null, fim: null, exibicao: "todos" as const },
  },
  telaLogin: { pedeEmail: true, emailObrigatorio: true, pedeTelefone: false, telefoneObrigatorio: false, paisPadrao: "BR" },
  video: { url: "https://x.com/a.m3u8", duracaoSeg: 3600 },
};

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  for (const m of [carregarSala, salaCheia, criarSessao, lerSessaoDoCookie, buscarInscricaoJit, sessaoDoAcesso, enfileirarEmailsDaInscricao, caminhoSalaMock, cookiesSet, env, dbAdmin]) m.mockReset();
  redirect.mockClear();
  carregarSala.mockResolvedValue(SALA_JIT);
  salaCheia.mockResolvedValue(false);
  lerSessaoDoCookie.mockResolvedValue(null);
  buscarInscricaoJit.mockResolvedValue(null);
  caminhoSalaMock.mockImplementation(async (slug: string, sufixo?: string) => (sufixo ? `/${slug}/${sufixo}` : `/${slug}`));
  env.mockImplementation((nome: string) => {
    if (nome === "SALA_TOKEN_SECRET") return SEGREDO;
    throw new Error(`env inesperada: ${nome}`);
  });
  criarSessao.mockResolvedValue({ sessaoId: "sess-nova", token: "token-novo", exp: Math.floor(AGORA.getTime() / 1000) + 86_400 });
  enfileirarEmailsDaInscricao.mockResolvedValue(3);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("inscrever (/lp)", () => {
  it("horário válido: cria a sessão com o horário, grava o cookie, enfileira e-mails e vai pro /inscrito", async () => {
    const { inscrever } = await import("../app/s/[slug]/lp/actions");
    await expect(inscrever("turma-1", {}, form({ nome: "Ana", email: "Ana@X.com", horario: HORARIO_1 }))).rejects.toThrow("REDIRECT:/turma-1/inscrito");
    expect(criarSessao).toHaveBeenCalledWith(
      expect.objectContaining({ jitHorario: new Date(HORARIO_1), modo: "ao_vivo", temporario: false, dados: { nome: "Ana", email: "ana@x.com", telefone: null } }),
    );
    expect(cookiesSet).toHaveBeenCalledWith("vw_web-1", "token-novo", expect.objectContaining({ maxAge: 86_400, httpOnly: true }));
    expect(enfileirarEmailsDaInscricao).toHaveBeenCalledWith({
      sessaoId: "sess-nova",
      webinarId: "web-1",
      email: "ana@x.com",
      jitHorario: new Date(HORARIO_1),
      agora: AGORA,
    });
  });

  it("horário fora da lista: erro 'Esse horário não está mais disponível.' sem criar nada", async () => {
    const { inscrever } = await import("../app/s/[slug]/lp/actions");
    const r = await inscrever("turma-1", {}, form({ nome: "Ana", email: "ana@x.com", horario: "2026-11-03T22:00:00.000Z" }));
    expect(r).toEqual({ erro: "Esse horário não está mais disponível.", valores: { nome: "Ana", email: "ana@x.com", telefone: "" } });
    expect(criarSessao).not.toHaveBeenCalled();
    expect(cookiesSet).not.toHaveBeenCalled();
  });

  it("entrar_direto: ignora o campo e usa o próximo horário", async () => {
    carregarSala.mockResolvedValue({ ...SALA_JIT, jit: { ...SALA_JIT.jit, config: { ...SALA_JIT.jit.config, exibicao: "entrar_direto" } } });
    const { inscrever } = await import("../app/s/[slug]/lp/actions");
    await expect(inscrever("turma-1", {}, form({ nome: "Ana", email: "ana@x.com" }))).rejects.toThrow("REDIRECT:/turma-1/inscrito");
    expect(criarSessao).toHaveBeenCalledWith(expect.objectContaining({ jitHorario: new Date(HORARIO_1) }));
  });

  it("grava o fuso da configuração quando não é 'participante' (ignora o do navegador)", async () => {
    const { inscrever } = await import("../app/s/[slug]/lp/actions");
    await expect(
      inscrever("turma-1", {}, form({ nome: "Ana", email: "ana@x.com", horario: HORARIO_1, fuso: "Europe/Lisbon" })),
    ).rejects.toThrow("REDIRECT:/turma-1/inscrito");
    expect(criarSessao).toHaveBeenCalledWith(expect.objectContaining({ jitFuso: "America/Sao_Paulo" }));
  });

  it("fuso 'participante': usa o fuso do navegador validado (Lisboa: 20:00 = 20:00Z)", async () => {
    carregarSala.mockResolvedValue({ ...SALA_JIT, jit: { ...SALA_JIT.jit, config: { ...SALA_JIT.jit.config, fuso: "participante" } } });
    const { inscrever } = await import("../app/s/[slug]/lp/actions");
    await expect(
      inscrever("turma-1", {}, form({ nome: "Ana", email: "ana@x.com", horario: "2026-11-03T20:00:00.000Z", fuso: "Europe/Lisbon" })),
    ).rejects.toThrow("REDIRECT:/turma-1/inscrito");
    expect(criarSessao).toHaveBeenCalledWith(expect.objectContaining({ jitFuso: "Europe/Lisbon" }));
    // Fuso forjado: cai em Brasília, e o horário de Lisboa deixa de valer.
    const r = await inscrever("turma-1", {}, form({ nome: "Ana", email: "ana@x.com", horario: "2026-11-03T20:00:00.000Z", fuso: "Marte/Base" }));
    expect(r.erro).toBe("Esse horário não está mais disponível.");
  });

  it("mesma pessoa no mesmo horário: reaproveita a sessão (sem criar outra nem enfileirar), renovando o cookie", async () => {
    buscarInscricaoJit.mockResolvedValue("sess-antiga");
    const { inscrever } = await import("../app/s/[slug]/lp/actions");
    await expect(inscrever("turma-1", {}, form({ nome: "Ana", email: "ana@x.com", horario: HORARIO_2 }))).rejects.toThrow("REDIRECT:/turma-1/inscrito");
    expect(buscarInscricaoJit).toHaveBeenCalledWith("web-1", "ana@x.com", new Date(HORARIO_2));
    expect(criarSessao).not.toHaveBeenCalled();
    expect(enfileirarEmailsDaInscricao).not.toHaveBeenCalled();

    const [nome, valor, opcoes] = cookiesSet.mock.calls[0] as [string, string, { maxAge: number }];
    expect(nome).toBe("vw_web-1");
    const { verificarToken } = await import("@/src/lib/regras/sessao-token");
    const dados = verificarToken(valor, SEGREDO, Math.floor(AGORA.getTime() / 1000));
    // até 12 h depois do fim (horário + 1 h de vídeo)
    const expEsperado = Math.floor(new Date(HORARIO_2).getTime() / 1000) + 3600 + 12 * 3600;
    expect(dados).toMatchObject({ s: "sess-antiga", w: "web-1", exp: expEsperado });
    expect(opcoes.maxAge).toBe(expEsperado - Math.floor(AGORA.getTime() / 1000));
  });

  it("mesmas validações da tela de login", async () => {
    const { inscrever } = await import("../app/s/[slug]/lp/actions");
    expect(await inscrever("turma-1", {}, form({ nome: "", email: "ana@x.com", horario: HORARIO_1 }))).toMatchObject({ erro: "Informe seu nome." });
    expect(await inscrever("turma-1", {}, form({ nome: "Ana", email: "x", horario: HORARIO_1 }))).toMatchObject({ erro: "Informe um e-mail válido." });
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("modo teste (token do Pronto): sessão de teste, sem reaproveitar nem enfileirar e-mail", async () => {
    const { assinarToken } = await import("@/src/lib/regras/sessao-token");
    const teste = assinarToken({ w: "web-1", t: 1, exp: Math.floor(AGORA.getTime() / 1000) + 60 }, SEGREDO);
    const { inscrever } = await import("../app/s/[slug]/lp/actions");
    await expect(inscrever("turma-1", {}, form({ nome: "Ana", email: "ana@x.com", horario: HORARIO_1, teste }))).rejects.toThrow("REDIRECT:");
    expect(criarSessao).toHaveBeenCalledWith(expect.objectContaining({ modo: "teste", jitHorario: new Date(HORARIO_1) }));
    expect(buscarInscricaoJit).not.toHaveBeenCalled();
    expect(enfileirarEmailsDaInscricao).not.toHaveBeenCalled();
  });

  it("webinar que não é JIT: volta pra raiz sem criar nada", async () => {
    carregarSala.mockResolvedValue({ ...SALA_JIT, webinar: { ...SALA_JIT.webinar, tipoAgenda: "unica" }, jit: null });
    const { inscrever } = await import("../app/s/[slug]/lp/actions");
    await expect(inscrever("turma-1", {}, form({ nome: "Ana", email: "ana@x.com", horario: HORARIO_1 }))).rejects.toThrow("REDIRECT:/turma-1");
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("falha ao criar a sessão: erro amigável", async () => {
    criarSessao.mockRejectedValue(new Error("banco"));
    const { inscrever } = await import("../app/s/[slug]/lp/actions");
    const r = await inscrever("turma-1", {}, form({ nome: "Ana", email: "ana@x.com", horario: HORARIO_1 }));
    expect(r.erro).toBe("Não deu para concluir sua inscrição.");
  });
});

function req(qs: string) {
  return new NextRequest(`https://aovivo.exemplo.com/s/turma-1/entrar${qs}`, { method: "POST" });
}

describe("POST /entrar com ?acesso= (link do e-mail)", () => {
  const agoraSeg = Math.floor(AGORA.getTime() / 1000);

  it("token válido do webinar: grava o cookie da sessão apontada e vai pra raiz", async () => {
    sessaoDoAcesso.mockResolvedValue({ jitHorario: new Date(HORARIO_1) });
    const { criarTokenAcesso, verificarToken } = await import("@/src/lib/regras/sessao-token");
    const acesso = criarTokenAcesso({ s: "sess-9", w: "web-1", exp: agoraSeg + 3600 }, SEGREDO);
    const { POST } = await import("../app/s/[slug]/entrar/route");
    const res = await POST(req(`?acesso=${acesso}`), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1");
    expect(sessaoDoAcesso).toHaveBeenCalledWith("sess-9", "web-1");
    const cookie = res.cookies.get("vw_web-1")!.value;
    expect(verificarToken(cookie, SEGREDO, agoraSeg)).toMatchObject({ s: "sess-9", w: "web-1" });
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("expirado, de outro webinar, de cookie ou sessão inexistente: volta pra raiz sem cookie", async () => {
    const { criarTokenAcesso, assinarToken } = await import("@/src/lib/regras/sessao-token");
    const casos = [
      criarTokenAcesso({ s: "sess-9", w: "web-1", exp: agoraSeg - 1 }, SEGREDO),
      criarTokenAcesso({ s: "sess-9", w: "web-2", exp: agoraSeg + 3600 }, SEGREDO),
      assinarToken({ s: "sess-9", w: "web-1", exp: agoraSeg + 3600 }, SEGREDO),
    ];
    const { POST } = await import("../app/s/[slug]/entrar/route");
    for (const token of casos) {
      const res = await POST(req(`?acesso=${token}`), { params: Promise.resolve({ slug: "turma-1" }) });
      expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1");
      expect(res.cookies.get("vw_web-1")).toBeUndefined();
    }
    expect(sessaoDoAcesso).not.toHaveBeenCalled();

    sessaoDoAcesso.mockResolvedValue(null);
    const valido = criarTokenAcesso({ s: "sess-x", w: "web-1", exp: agoraSeg + 3600 }, SEGREDO);
    const res = await POST(req(`?acesso=${valido}`), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1");
    expect(res.cookies.get("vw_web-1")).toBeUndefined();
    expect(criarSessao).not.toHaveBeenCalled();
  });

  it("webinar JIT: link mágico no /entrar não cria sessão (a inscrição é na /lp)", async () => {
    const { POST } = await import("../app/s/[slug]/entrar/route");
    carregarSala.mockResolvedValue({ ...SALA_JIT, webinar: { ...SALA_JIT.webinar, acessoFacilitado: true } });
    const res = await POST(req("?nome=Ana&email=ana%40x.com"), { params: Promise.resolve({ slug: "turma-1" }) });
    expect(res.headers.get("location")).toBe("https://aovivo.exemplo.com/turma-1");
    expect(criarSessao).not.toHaveBeenCalled();
  });
});
