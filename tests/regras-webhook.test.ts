import { describe, expect, it } from "vitest";
import {
  esperaTentativa,
  gatilhosDoEvento,
  montarRequisicao,
  rotuloGatilho,
  urlWebhookPermitida,
  validarRegra,
  type CandidataRegra,
} from "@/src/lib/regras/regras-webhook";

const BASE: CandidataRegra = {
  gatilho: "clicou_oferta",
  valorSeg: null,
  url: "https://exemplo.com/hook",
  metodo: "POST",
  headers: [["Authorization", "Bearer abc"]],
  params: [["origem", "vortex-webinar"]],
  corpo: '{"nome":"{{NOME}}"}',
};

describe("urlWebhookPermitida", () => {
  it("aceita https público", () => {
    expect(urlWebhookPermitida("https://exemplo.com/hook")).toBe(true);
  });

  it("recusa http", () => {
    expect(urlWebhookPermitida("http://exemplo.com/hook")).toBe(false);
  });

  it("recusa localhost e .local", () => {
    expect(urlWebhookPermitida("https://localhost/hook")).toBe(false);
    expect(urlWebhookPermitida("https://minha-maquina.local/hook")).toBe(false);
  });

  it("recusa IPv4 privado/loopback/link-local", () => {
    expect(urlWebhookPermitida("https://127.0.0.1/hook")).toBe(false);
    expect(urlWebhookPermitida("https://10.0.0.5/hook")).toBe(false);
    expect(urlWebhookPermitida("https://172.16.0.5/hook")).toBe(false);
    expect(urlWebhookPermitida("https://172.31.255.255/hook")).toBe(false);
    expect(urlWebhookPermitida("https://192.168.1.1/hook")).toBe(false);
    expect(urlWebhookPermitida("https://169.254.1.1/hook")).toBe(false);
    expect(urlWebhookPermitida("https://0.0.0.0/hook")).toBe(false);
  });

  it("aceita IPv4 público", () => {
    expect(urlWebhookPermitida("https://8.8.8.8/hook")).toBe(true);
    expect(urlWebhookPermitida("https://172.32.0.1/hook")).toBe(true); // fora de 172.16-31
  });

  it("recusa IPv6 loopback, link-local e unique-local, inclusive mapeado (::ffff:)", () => {
    expect(urlWebhookPermitida("https://[::1]/hook")).toBe(false);
    expect(urlWebhookPermitida("https://[fe80::1]/hook")).toBe(false);
    expect(urlWebhookPermitida("https://[fc00::1]/hook")).toBe(false);
    expect(urlWebhookPermitida("https://[fd12:3456::1]/hook")).toBe(false);
    expect(urlWebhookPermitida("https://[::ffff:127.0.0.1]/hook")).toBe(false);
    expect(urlWebhookPermitida("https://[::ffff:10.0.0.1]/hook")).toBe(false);
  });

  it("aceita IPv6 público", () => {
    expect(urlWebhookPermitida("https://[2001:4860:4860::8888]/hook")).toBe(true);
  });

  it("link inválido recusa", () => {
    expect(urlWebhookPermitida("não é url")).toBe(false);
  });

  it("ponto final no host não escapa da lista (localhost., x.local.)", () => {
    expect(urlWebhookPermitida("https://localhost./hook")).toBe(false);
    expect(urlWebhookPermitida("https://maquina.local./hook")).toBe(false);
    expect(urlWebhookPermitida("https://exemplo.com./hook")).toBe(true);
  });

  it("recusa *.localhost, *.internal e o metadata do Google", () => {
    expect(urlWebhookPermitida("https://app.localhost/hook")).toBe(false);
    expect(urlWebhookPermitida("https://servico.internal/hook")).toBe(false);
    expect(urlWebhookPermitida("https://metadata.google.internal/hook")).toBe(false);
  });

  it("recusa faixas IPv4 especiais (CGNAT, benchmark, multicast e reservadas, broadcast)", () => {
    expect(urlWebhookPermitida("https://0.1.2.3/hook")).toBe(false);
    expect(urlWebhookPermitida("https://100.64.0.1/hook")).toBe(false);
    expect(urlWebhookPermitida("https://100.127.255.255/hook")).toBe(false);
    expect(urlWebhookPermitida("https://198.18.0.1/hook")).toBe(false);
    expect(urlWebhookPermitida("https://198.19.255.1/hook")).toBe(false);
    expect(urlWebhookPermitida("https://224.0.0.1/hook")).toBe(false);
    expect(urlWebhookPermitida("https://240.0.0.1/hook")).toBe(false);
    expect(urlWebhookPermitida("https://255.255.255.255/hook")).toBe(false);
    expect(urlWebhookPermitida("https://100.128.0.1/hook")).toBe(true);
    expect(urlWebhookPermitida("https://198.20.0.1/hook")).toBe(true);
  });

  it("IPv4 em forma decimal/hex é normalizado pela URL e recusado", () => {
    expect(urlWebhookPermitida("https://2130706433/hook")).toBe(false); // 127.0.0.1
    expect(urlWebhookPermitida("https://0x7f.1/hook")).toBe(false);
  });

  it("recusa IPv6 especiais (::, IPv4-compatível, NAT64, site-local, multicast)", () => {
    expect(urlWebhookPermitida("https://[::]/hook")).toBe(false);
    expect(urlWebhookPermitida("https://[::7f00:1]/hook")).toBe(false); // ::127.0.0.1
    expect(urlWebhookPermitida("https://[::808:808]/hook")).toBe(false); // ::/96 inteiro
    expect(urlWebhookPermitida("https://[64:ff9b::a00:1]/hook")).toBe(false);
    expect(urlWebhookPermitida("https://[fec0::1]/hook")).toBe(false);
    expect(urlWebhookPermitida("https://[ff02::1]/hook")).toBe(false);
  });
});

describe("validarRegra", () => {
  it("aceita uma regra válida", () => {
    const r = validarRegra(BASE);
    expect("dados" in r).toBe(true);
  });

  it("recusa gatilho desconhecido", () => {
    const r = validarRegra({ ...BASE, gatilho: "etc" });
    expect(r).toEqual({ erro: "Gatilho inválido." });
  });

  it("permaneceu e abandonou exigem valorSeg >= 0", () => {
    expect(validarRegra({ ...BASE, gatilho: "permaneceu", valorSeg: null })).toEqual({ erro: "Informe o tempo." });
    expect(validarRegra({ ...BASE, gatilho: "permaneceu", valorSeg: -1 })).toEqual({ erro: "Informe o tempo." });
    expect("dados" in validarRegra({ ...BASE, gatilho: "permaneceu", valorSeg: 30 })).toBe(true);
  });

  it("recusa URL privada", () => {
    expect(validarRegra({ ...BASE, url: "https://localhost/hook" })).toEqual({ erro: "Use um endereço https público." });
  });

  it("recusa método desconhecido", () => {
    expect(validarRegra({ ...BASE, metodo: "TRACE" })).toEqual({ erro: "Método inválido." });
  });

  it("limita headers e params a 20 pares", () => {
    const muitos: [string, string][] = Array.from({ length: 21 }, (_, i) => [`h${i}`, "v"]);
    expect(validarRegra({ ...BASE, headers: muitos })).toEqual({ erro: "No máximo 20 headers." });
    expect(validarRegra({ ...BASE, params: muitos })).toEqual({ erro: "No máximo 20 params." });
  });

  it("chave de header/param entre 1 e 100 caracteres", () => {
    expect(validarRegra({ ...BASE, headers: [["", "v"]] })).toEqual({ erro: "Chave de header inválida." });
    expect(validarRegra({ ...BASE, headers: [["x".repeat(101), "v"]] })).toEqual({ erro: "Chave de header inválida." });
  });

  it("nome de header tem que ser um token HTTP (sem espaço, dois-pontos ou acento)", () => {
    expect(validarRegra({ ...BASE, headers: [["X Teste", "v"]] })).toEqual({ erro: "Nome de header inválido." });
    expect(validarRegra({ ...BASE, headers: [["X:Teste", "v"]] })).toEqual({ erro: "Nome de header inválido." });
    expect(validarRegra({ ...BASE, headers: [["Autorização", "v"]] })).toEqual({ erro: "Nome de header inválido." });
    expect("dados" in validarRegra({ ...BASE, headers: [["X-Api_Key.v2", "v"]] })).toBe(true);
    // Params não têm essa restrição (vão codificados na URL).
    expect("dados" in validarRegra({ ...BASE, params: [["minha chave", "v"]] })).toBe(true);
  });

  it("valor de header não pode ter quebra de linha", () => {
    expect(validarRegra({ ...BASE, headers: [["X-A", "a\r\nb"]] })).toEqual({ erro: "Valor de header inválido." });
  });

  it("valor de header/param até 2000 caracteres", () => {
    expect(validarRegra({ ...BASE, params: [["x", "v".repeat(2001)]] })).toEqual({ erro: "Valor de param muito longo." });
  });

  it("corpo até 10000 caracteres", () => {
    expect(validarRegra({ ...BASE, corpo: "x".repeat(10001) })).toEqual({ erro: "Corpo muito longo." });
    expect("dados" in validarRegra({ ...BASE, corpo: "x".repeat(10000) })).toBe(true);
  });
});

describe("montarRequisicao", () => {
  const contexto = {
    nome: "Ana Souza",
    email: "ana@x.com",
    telefone: "+5511987654321",
    tag: "Clicou na oferta",
    dataIso: "2026-10-20T12:00:00.000Z",
    utms: { utm_source: "ig", utm_medium: "story" },
    tempoSeg: 123,
    webinarNome: "Aula de teste",
  };

  it("monta URL com params trocados e codificados", () => {
    const req = montarRequisicao(
      { url: "https://exemplo.com/hook", metodo: "POST", headers: [], params: [["nome", "{{NOME}}"]], corpo: null },
      contexto,
    );
    expect(req.url).toBe("https://exemplo.com/hook?nome=Ana+Souza");
  });

  it("corpo JSON válido depois da troca vira application/json com valores escapados", () => {
    const req = montarRequisicao(
      { url: "https://exemplo.com/hook", metodo: "POST", headers: [], params: [], corpo: '{"nome":"{{NOME}}","obs":"{{TAG}}"}' },
      contexto,
    );
    expect(req.contentType).toBe("application/json");
    expect(JSON.parse(req.corpo!)).toEqual({ nome: "Ana Souza", obs: "Clicou na oferta" });
  });

  it("corpo que não vira JSON válido fica text/plain", () => {
    const req = montarRequisicao(
      { url: "https://exemplo.com/hook", metodo: "POST", headers: [], params: [], corpo: "Olá {{NOME}}, tudo bem?" },
      contexto,
    );
    expect(req.contentType).toBe("text/plain");
    expect(req.corpo).toBe("Olá Ana Souza, tudo bem?");
  });

  it("troca todas as variáveis", () => {
    const req = montarRequisicao(
      {
        url: "https://exemplo.com/hook",
        metodo: "POST",
        headers: [],
        params: [],
        corpo: "{{NOME}}|{{EMAIL}}|{{TELEFONE}}|{{TAG}}|{{DATA}}|{{UTMS}}|{{TEMPO}}|{{WEBINAR}}",
      },
      contexto,
    );
    expect(req.corpo).toBe(
      "Ana Souza|ana@x.com|+5511987654321|Clicou na oferta|2026-10-20T12:00:00.000Z|utm_source=ig&utm_medium=story|123|Aula de teste",
    );
  });

  it("sem corpo (null) devolve null", () => {
    const req = montarRequisicao({ url: "https://exemplo.com/hook", metodo: "GET", headers: [], params: [], corpo: null }, contexto);
    expect(req.corpo).toBeNull();
    expect(req.contentType).toBeNull();
  });

  it("mantém headers como vieram (sem trocar variáveis)", () => {
    const req = montarRequisicao(
      { url: "https://exemplo.com/hook", metodo: "POST", headers: [["Authorization", "Bearer {{NOME}}"]], params: [], corpo: null },
      contexto,
    );
    expect(req.headers).toEqual([["Authorization", "Bearer {{NOME}}"]]);
  });
});

describe("esperaTentativa", () => {
  it("1ª, 2ª e 3ª tentativa: 1, 5 e 15 minutos", () => {
    expect(esperaTentativa(1)).toBe(60_000);
    expect(esperaTentativa(2)).toBe(300_000);
    expect(esperaTentativa(3)).toBe(900_000);
  });

  it("depois da 3ª, desiste", () => {
    expect(esperaTentativa(4)).toBeNull();
    expect(esperaTentativa(10)).toBeNull();
  });
});

describe("gatilhosDoEvento", () => {
  it("mapeia eventos pros gatilhos de regra", () => {
    expect(gatilhosDoEvento("acessou_sala")).toEqual(["acessou"]);
    expect(gatilhosDoEvento("fez_login")).toEqual(["cadastrou"]);
    expect(gatilhosDoEvento("link_magico")).toEqual(["cadastrou"]);
    expect(gatilhosDoEvento("pitch")).toEqual(["pitch"]);
    expect(gatilhosDoEvento("oferta")).toEqual(["oferta"]);
    expect(gatilhosDoEvento("clicou_oferta")).toEqual(["clicou_oferta"]);
  });

  it("eventos sem gatilho de regra devolvem lista vazia", () => {
    expect(gatilhosDoEvento("clicou_video")).toEqual([]);
    expect(gatilhosDoEvento("min_15")).toEqual([]);
    expect(gatilhosDoEvento("comprou")).toEqual([]);
    // Login provisório não é o cadastro: quem completa (POST /api/sala/cadastro) grava `fez_login`.
    expect(gatilhosDoEvento("login_provisorio")).toEqual([]);
  });
});

describe("rotuloGatilho", () => {
  it("tem rótulo em pt-BR pra todo gatilho", () => {
    expect(rotuloGatilho("acessou")).toBe("Acessou a sala");
    expect(rotuloGatilho("inscreveu_lp")).toBe("Inscreveu na página");
    expect(rotuloGatilho("cadastrou")).toBe("Cadastrou");
    expect(rotuloGatilho("permaneceu")).toBe("Permaneceu");
    expect(rotuloGatilho("abandonou")).toBe("Abandonou");
    expect(rotuloGatilho("pitch")).toBe("Viu o pitch");
    expect(rotuloGatilho("oferta")).toBe("Viu a oferta");
    expect(rotuloGatilho("clicou_oferta")).toBe("Clicou na oferta");
    expect(rotuloGatilho("nao_viu_oferta")).toBe("Não viu a oferta");
  });
});
