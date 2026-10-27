import { describe, expect, it } from "vitest";
import { decidirRota, hostDaRequisicao } from "@/src/lib/regras/rota";

const cfg = { hostSala: "sala.exemplo.com.br" };

describe("decidirRota", () => {
  it("domínio da sala reescreve para /s", () => {
    expect(decidirRota("sala.exemplo.com.br", "/minha-aula", cfg)).toEqual({ tipo: "sala", caminho: "/s/minha-aula" });
    expect(decidirRota("sala.exemplo.com.br", "/minha-aula/sala", cfg)).toEqual({ tipo: "sala", caminho: "/s/minha-aula/sala" });
  });

  it("domínio da sala com porta e maiúsculas", () => {
    expect(decidirRota("SALA.exemplo.com.br:443", "/x", cfg)).toEqual({ tipo: "sala", caminho: "/s/x" });
  });

  it("hostSala vem do hostname (sem porta) e bate com o host da requisição com porta", () => {
    expect(decidirRota("sala.exemplo.com.br:443", "/x", { hostSala: "sala.exemplo.com.br" })).toEqual({
      tipo: "sala",
      caminho: "/s/x",
    });
  });

  it("raiz da sala não abre o painel", () => {
    expect(decidirRota("sala.exemplo.com.br", "/", cfg)).toEqual({ tipo: "sala", caminho: "/s" });
  });

  it("api pública da sala passa sem reescrever", () => {
    expect(decidirRota("sala.exemplo.com.br", "/api/sala/eventos", cfg)).toEqual({ tipo: "publica" });
    expect(decidirRota("sala.exemplo.com.br", "/api/cron/tick", cfg)).toEqual({ tipo: "publica" });
  });

  it("api do painel no host da sala exige login (Host não é confiável)", () => {
    expect(decidirRota("sala.exemplo.com.br", "/api/webinars", cfg)).toEqual({ tipo: "painel" });
  });

  it("sem hostSala configurado, nada cai na sala", () => {
    expect(decidirRota("", "/x", { hostSala: "" })).toEqual({ tipo: "painel" });
  });

  it("no domínio do painel, /s/* vai pro domínio da sala (mesmo caminho, sem o /s)", () => {
    expect(decidirRota("painel.exemplo.com.br", "/s/minha-aula", cfg)).toEqual({ tipo: "redirecionar_sala", caminho: "/minha-aula" });
    expect(decidirRota("painel.exemplo.com.br", "/s/minha-aula/sala", cfg)).toEqual({ tipo: "redirecionar_sala", caminho: "/minha-aula/sala" });
    expect(decidirRota("painel.exemplo.com.br", "/s", cfg)).toEqual({ tipo: "redirecionar_sala", caminho: "/" });
    // Só o prefixo /s exato: /sobre não é da sala.
    expect(decidirRota("painel.exemplo.com.br", "/sobre", cfg)).toEqual({ tipo: "painel" });
  });

  it("dev: painel em localhost:3130 manda /s/* pra sala.localhost:3130; a sala continua reescrevendo", () => {
    const dev = { hostSala: "sala.localhost" };
    expect(decidirRota("localhost:3130", "/s/aula", dev)).toEqual({ tipo: "redirecionar_sala", caminho: "/aula" });
    expect(decidirRota("sala.localhost:3130", "/aula", dev)).toEqual({ tipo: "sala", caminho: "/s/aula" });
  });

  it("sem domínio da sala configurado, /s continua aberto no próprio host", () => {
    expect(decidirRota("localhost:3000", "/s/aula", { hostSala: "" })).toEqual({ tipo: "publica" });
  });

  it("no domínio do painel, rotas públicas passam sem login (dev e prévia)", () => {
    expect(decidirRota("localhost:3000", "/login", cfg)).toEqual({ tipo: "publica" });
    expect(decidirRota("localhost:3000", "/api/cron/tick", cfg)).toEqual({ tipo: "publica" });
    expect(decidirRota("localhost:3000", "/api/checkout/kiwify/abc", cfg)).toEqual({ tipo: "publica" });
    // O MCP se autentica pela própria chave (`Authorization: Bearer vw_…`).
    expect(decidirRota("painel.exemplo.com.br", "/api/mcp", cfg)).toEqual({ tipo: "publica" });
    expect(decidirRota("painel.exemplo.com.br", "/api/mcpx", cfg)).toEqual({ tipo: "painel" });
  });

  it("o resto do domínio do painel exige login", () => {
    expect(decidirRota("painel.exemplo.com.br", "/", cfg)).toEqual({ tipo: "painel" });
    expect(decidirRota("painel.exemplo.com.br", "/webinars", cfg)).toEqual({ tipo: "painel" });
  });

  it("no host da sala, caminho já interno (/s/<slug>/...) não ganha outro /s (seria 404)", () => {
    expect(decidirRota("sala.exemplo.com.br", "/s/minha-aula/entrar", cfg)).toEqual({ tipo: "sala", caminho: "/s/minha-aula/entrar" });
    expect(decidirRota("sala.exemplo.com.br", "/s", cfg)).toEqual({ tipo: "sala", caminho: "/s" });
    expect(decidirRota("sala.exemplo.com.br", "/sala-x", cfg)).toEqual({ tipo: "sala", caminho: "/s/sala-x" });
  });
});

describe("decidirRota: entrada do teste A/B (/t/<slug>)", () => {
  const cfg = { hostSala: "sala.exemplo.com.br" };
  it("no host da sala, /t/<slug> vira /s/t/<slug>", () => {
    expect(decidirRota("sala.exemplo.com.br", "/t/teste-x", cfg)).toEqual({ tipo: "sala", caminho: "/s/t/teste-x" });
  });
  it("no host do painel, /t/* vai pro domínio da sala (como o /s/*)", () => {
    expect(decidirRota("painel.exemplo.com.br", "/t/teste-x", cfg)).toEqual({ tipo: "redirecionar_sala", caminho: "/t/teste-x" });
    expect(decidirRota("painel.exemplo.com.br", "/s/t/teste-x", cfg)).toEqual({ tipo: "redirecionar_sala", caminho: "/t/teste-x" });
  });
  it("sem domínio da sala (dev), /t/* é servido aqui pela rota interna, sem login", () => {
    expect(decidirRota("localhost:3000", "/t/teste-x", { hostSala: "" })).toEqual({ tipo: "sala", caminho: "/s/t/teste-x" });
  });
  it("caminhos do painel que só começam com t continuam no painel", () => {
    expect(decidirRota("painel.exemplo.com.br", "/testes-ab", cfg)).toEqual({ tipo: "painel" });
  });
});

describe("hostDaRequisicao", () => {
  const cab = (h: Record<string, string>) => new Headers(h);
  it("prefere o x-forwarded-host (redirect de server action monta a tela num fetch para localhost)", () => {
    expect(hostDaRequisicao(cab({ host: "localhost:3150", "x-forwarded-host": "sala.localhost:3150" }))).toBe("sala.localhost:3150");
  });
  it("usa o primeiro da lista do x-forwarded-host", () => {
    expect(hostDaRequisicao(cab({ host: "a", "x-forwarded-host": "aovivo.exemplo.com, proxy.interno" }))).toBe("aovivo.exemplo.com");
  });
  it("sem x-forwarded-host, fica o host; sem nada, vazio", () => {
    expect(hostDaRequisicao(cab({ host: "painel.exemplo.com" }))).toBe("painel.exemplo.com");
    expect(hostDaRequisicao(cab({}))).toBe("");
  });
});
