import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { criarTokenAb, verificarTokenAb } from "@/src/lib/regras/sessao-token";

const carregarTesteAb = vi.fn();
const caminhoSalaMock = vi.fn();
const env = vi.fn();

vi.mock("@/src/lib/sala/teste-ab", () => ({ carregarTesteAb: (...a: unknown[]) => carregarTesteAb(...a) }));
vi.mock("@/src/lib/sala/caminho", () => ({ caminhoSala: (...a: unknown[]) => caminhoSalaMock(...a) }));
vi.mock("@/src/lib/env", () => ({ env: (...a: unknown[]) => env(...a) }));

const SEGREDO = "segredo-teste";
const TESTE = "11111111-2222-4333-8444-555555555555";
const WA = "aaaaaaaa-0000-4000-8000-000000000001";
const WB = "aaaaaaaa-0000-4000-8000-000000000002";

const TESTE_BASE = {
  id: TESTE,
  inicio: new Date(Date.now() - 86_400_000),
  fim: new Date(Date.now() + 86_400_000),
  arquivado: false,
  idioma: "pt-BR",
  variacoes: [
    { ordem: 0, webinarId: WA, percentual: 50, slug: "aula-a", idioma: "pt-BR" },
    { ordem: 1, webinarId: WB, percentual: 50, slug: "aula-b", idioma: "pt-BR" },
  ],
};

function req(qs = "", opcoes: { ua?: string; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opcoes.headers ?? {}) };
  if (opcoes.ua) headers["user-agent"] = opcoes.ua;
  if (opcoes.cookie) headers.cookie = opcoes.cookie;
  return new NextRequest(`https://aovivo.exemplo.com/s/t/teste-x${qs}`, { headers });
}

const params = (slug = "teste-x") => ({ params: Promise.resolve({ slug }) });
const rota = () => import("../app/s/t/[slug]/route");

/** `Set-Cookie` da resposta como {nome: valor}. */
function cookiesDa(res: Response): Record<string, string> {
  const r: Record<string, string> = {};
  for (const c of (res as unknown as { cookies: { getAll: () => { name: string; value: string }[] } }).cookies.getAll()) r[c.name] = c.value;
  return r;
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  carregarTesteAb.mockReset().mockResolvedValue(TESTE_BASE);
  caminhoSalaMock.mockReset().mockImplementation(async (slug: string) => `/${slug}`);
  env.mockReset().mockImplementation((nome: string) => {
    if (nome === "SALA_TOKEN_SECRET") return SEGREDO;
    throw new Error(`env inesperada no teste: ${nome}`);
  });
});

describe("GET /t/[slug]", () => {
  it("sorteia pelo percentual, grava o cookie da escolha e o de marcação, e redireciona mantendo a query", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    const { GET } = await rota();
    const res = await GET(req("?utm_source=ig&utm_campaign=x"), params());

    expect(res.status).toBe(307);
    const destino = new URL(res.headers.get("location")!);
    expect(destino.pathname).toBe("/aula-b");
    expect(destino.searchParams.get("utm_source")).toBe("ig");
    expect(destino.searchParams.get("utm_campaign")).toBe("x");

    const c = cookiesDa(res);
    const escolha = verificarTokenAb(c[`vw_ab_${TESTE}`], SEGREDO, Math.floor(Date.now() / 1000));
    expect(escolha).toMatchObject({ t: TESTE, w: WB });
    expect(escolha!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 29 * 86_400);
    expect(verificarTokenAb(c[`vw_abw_${WB}`], SEGREDO, Math.floor(Date.now() / 1000))).toMatchObject({ t: TESTE, w: WB });
  });

  it("cookie válido mantém a mesma variação (sem sortear de novo)", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = criarTokenAb({ t: TESTE, w: WA, exp }, SEGREDO);
    const { GET } = await rota();
    const res = await GET(req("", { cookie: `vw_ab_${TESTE}=${token}` }), params());

    expect(new URL(res.headers.get("location")!).pathname).toBe("/aula-a");
    expect(random).not.toHaveBeenCalled();
    expect(verificarTokenAb(cookiesDa(res)[`vw_abw_${WA}`], SEGREDO, Math.floor(Date.now() / 1000))).toMatchObject({ t: TESTE, w: WA });
  });

  it("cookie adulterado é ignorado: sorteia de novo", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const [, assinatura] = criarTokenAb({ t: TESTE, w: WB, exp }, SEGREDO).split(".");
    const falso = `${Buffer.from(JSON.stringify({ t: TESTE, w: WA, exp })).toString("base64url")}.${assinatura}`;
    const { GET } = await rota();
    const res = await GET(req("", { cookie: `vw_ab_${TESTE}=${falso}` }), params());
    expect(new URL(res.headers.get("location")!).pathname).toBe("/aula-b");
  });

  it("cookie de um webinar que saiu do teste (ou de outro teste): sorteia de novo", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const { GET } = await rota();
    const fora = criarTokenAb({ t: TESTE, w: "aaaaaaaa-0000-4000-8000-000000000009", exp }, SEGREDO);
    let res = await GET(req("", { cookie: `vw_ab_${TESTE}=${fora}` }), params());
    expect(new URL(res.headers.get("location")!).pathname).toBe("/aula-a");
    const outroTeste = criarTokenAb({ t: "outro", w: WB, exp }, SEGREDO);
    res = await GET(req("", { cookie: `vw_ab_${TESTE}=${outroTeste}` }), params());
    expect(new URL(res.headers.get("location")!).pathname).toBe("/aula-a");
  });

  it("robô de pré-visualização: vai para a variação A, sem cookie e sem sorteio", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const { GET } = await rota();
    const res = await GET(req("?utm_source=wpp", { ua: "WhatsApp/2.23" }), params());
    expect(res.status).toBe(307);
    const destino = new URL(res.headers.get("location")!);
    expect(destino.pathname).toBe("/aula-a");
    expect(destino.search).toBe("?utm_source=wpp");
    expect(cookiesDa(res)).toEqual({});
    expect(random).not.toHaveBeenCalled();
  });

  it("pré-busca/pré-renderização do navegador sorteia e grava os cookies (é a resposta que a pessoa vai usar)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    const { GET } = await rota();
    const variantes: Record<string, string>[] = [{ "sec-purpose": "prefetch;prerender" }, { purpose: "prefetch" }];
    for (const headers of variantes) {
      const res = await GET(req("", { headers }), params());
      expect(new URL(res.headers.get("location")!).pathname).toBe("/aula-b");
      const c = cookiesDa(res);
      expect(verificarTokenAb(c[`vw_ab_${TESTE}`], SEGREDO, Math.floor(Date.now() / 1000))).toMatchObject({ t: TESTE, w: WB });
      expect(verificarTokenAb(c[`vw_abw_${WB}`], SEGREDO, Math.floor(Date.now() / 1000))).toMatchObject({ t: TESTE, w: WB });
    }
  });

  it("teste inexistente: 404", async () => {
    carregarTesteAb.mockResolvedValue(null);
    const { GET } = await rota();
    const res = await GET(req(), params());
    expect(res.status).toBe(404);
    expect(cookiesDa(res)).toEqual({});
  });

  it("slug fora do formato: 404 sem consultar o banco", async () => {
    const { GET } = await rota();
    const res = await GET(req(), params("A"));
    expect(res.status).toBe(404);
    expect(carregarTesteAb).not.toHaveBeenCalled();
  });

  it("fora do período: página de link indisponível, sem cookie", async () => {
    carregarTesteAb.mockResolvedValue({ ...TESTE_BASE, inicio: new Date(Date.now() + 3_600_000), fim: new Date(Date.now() + 7_200_000) });
    const { GET } = await rota();
    const res = await GET(req(), params());
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("Este link não está disponível agora.");
    expect(cookiesDa(res)).toEqual({});
  });

  it("arquivado: página de link indisponível (mesmo para robô)", async () => {
    carregarTesteAb.mockResolvedValue({ ...TESTE_BASE, arquivado: true });
    const { GET } = await rota();
    const res = await GET(req("", { ua: "facebookexternalhit/1.1" }), params());
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("Este link não está disponível agora.");
  });

  it("nenhum webinar ativo no teste: link indisponível", async () => {
    carregarTesteAb.mockResolvedValue({ ...TESTE_BASE, variacoes: [] });
    const { GET } = await rota();
    const res = await GET(req(), params());
    expect(await res.text()).toContain("Este link não está disponível agora.");
  });
});
