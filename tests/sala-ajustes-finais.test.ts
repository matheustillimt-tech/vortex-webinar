import { describe, expect, it } from "vitest";
import { esperaAposFalhaMs, janelaInicial, vendasParaAvisar } from "@/src/lib/regras/linha-do-tempo";
import { estadoSorteioRestaurado, PLACEHOLDER_SORTEIO } from "@/src/lib/regras/sorteio";
import { nomeCookieNovoCadastro, valorCookie } from "@/src/lib/regras/pixels";
import { linkOfertaSeguro, modoDaSala } from "@/src/lib/regras/sala";

describe("janelaInicial", () => {
  it("inclui a janela anterior (quem chega atrasado vê o chat recente)", () => {
    expect(janelaInicial(1250)).toEqual({ de: 900, ate: 1500 });
  });
  it("no começo do vídeo não fica negativa", () => {
    expect(janelaInicial(10)).toEqual({ de: 0, ate: 300 });
    expect(janelaInicial(310)).toEqual({ de: 0, ate: 600 });
  });
});

describe("esperaAposFalhaMs", () => {
  it("2 s, 4 s, 8 s... até 30 s", () => {
    expect([1, 2, 3, 4, 5, 6].map((f) => esperaAposFalhaMs(f))).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

describe("vendasParaAvisar", () => {
  const vendas = [{ segundo: 10 }, { segundo: 20 }, { segundo: 1190 }];
  it("primeira leitura não avisa nada (sem rajada ao entrar)", () => {
    expect(vendasParaAvisar(vendas, null, 1200)).toEqual([]);
  });
  it("pulo grande (entrada atrasada/correção) não avisa", () => {
    expect(vendasParaAvisar(vendas, 0, 1200)).toEqual([]);
    expect(vendasParaAvisar(vendas, 1200, 15)).toEqual([]);
  });
  it("reprodução normal: avisa as do intervalo (ultimo, atual]", () => {
    expect(vendasParaAvisar(vendas, 18, 21)).toEqual([{ segundo: 20 }]);
    expect(vendasParaAvisar(vendas, 20, 21)).toEqual([]);
  });
});

describe("sorteio restaurado", () => {
  it("parado ou no meio da animação: vai direto pro número final", () => {
    expect(estadoSorteioRestaurado("parado")).toBe("parado");
    expect(estadoSorteioRestaurado("sorteando")).toBe("parado");
  });
  it("sem nada salvo: inicial", () => {
    expect(estadoSorteioRestaurado(null)).toBe("inicial");
    expect(estadoSorteioRestaurado("lixo")).toBe("inicial");
  });
  it("placeholder nunca é o número real", () => {
    expect(PLACEHOLDER_SORTEIO).toBe("?");
  });
});

describe("cookie de cadastro novo", () => {
  it("nome por webinar", () => expect(nomeCookieNovoCadastro("w1")).toBe("vw_novo_cadastro_w1"));
  it("lê o valor do cookie certo", () => {
    expect(valorCookie("a=1; vw_novo_cadastro_w1=1; b=2", "vw_novo_cadastro_w1")).toBe("1");
    expect(valorCookie("vw_novo_cadastro_w10=1", "vw_novo_cadastro_w1")).toBeNull();
    expect(valorCookie("", "x")).toBeNull();
  });
});

describe("modoDaSala", () => {
  it("teste nunca muda", () => expect(modoDaSala("teste", true)).toEqual({ modo: "teste", trocarParaReplay: false }));
  it("sessão ao vivo + ?replay=1: replay e troca a sessão no servidor", () =>
    expect(modoDaSala("ao_vivo", true)).toEqual({ modo: "replay", trocarParaReplay: true }));
  it("sessão replay continua replay sem trocar", () => expect(modoDaSala("replay", false)).toEqual({ modo: "replay", trocarParaReplay: false }));
  it("sessão ao vivo sem replay: ao vivo", () => expect(modoDaSala("ao_vivo", false)).toEqual({ modo: "ao_vivo", trocarParaReplay: false }));
});

describe("linkOfertaSeguro", () => {
  it("só http(s)", () => {
    expect(linkOfertaSeguro("javascript:alert(1)", {})).toBeNull();
    expect(linkOfertaSeguro("data:text/html,oi", {})).toBeNull();
    expect(linkOfertaSeguro("não é url", {})).toBeNull();
    expect(linkOfertaSeguro(null, {})).toBeNull();
    expect(linkOfertaSeguro("http://x.com/a", {})).toBe("http://x.com/a");
  });
  it("repassa UTMs sem sobrescrever as do link", () => {
    expect(linkOfertaSeguro("https://x.com/a?utm_source=b", { utm_source: "c", utm_medium: "d" })).toBe("https://x.com/a?utm_source=b&utm_medium=d");
  });
});

describe("linkOfertaSeguro com dados da pessoa", () => {
  const dados = { nome: "Ana Paula", email: "ana@x.com", telefoneE164: "+5537900001111" };
  it("troca os campos pelos dados de quem está na sala", () => {
    const l = linkOfertaSeguro("https://pay.x.com/c/p?name={{nome}}&email={{email}}&phone={{telefone_sem_ddi}}&tel={{telefone}}", {}, dados);
    const u = new URL(l!);
    expect(u.searchParams.get("name")).toBe("Ana Paula");
    expect(u.searchParams.get("email")).toBe("ana@x.com");
    expect(u.searchParams.get("phone")).toBe("37900001111");
    expect(u.searchParams.get("tel")).toBe("5537900001111");
  });
  it("campo sem dado sai do link", () => {
    expect(linkOfertaSeguro("https://pay.x.com/c?name={{nome}}&email={{email}}&utm_source=w", {}, { nome: "Ana" })).toBe(
      "https://pay.x.com/c?name=Ana&utm_source=w",
    );
  });
  it("sem campos, link igual; UTMs da sessão continuam entrando", () => {
    expect(linkOfertaSeguro("https://x.com/a?utm_source=b", { utm_medium: "d" }, dados)).toBe("https://x.com/a?utm_source=b&utm_medium=d");
  });
  it("telefone sem DDI (sessão de teste) é lido como Brasil", () => {
    expect(linkOfertaSeguro("https://x.com/c?phone={{telefone_sem_ddi}}&tel={{telefone}}", {}, { telefoneE164: "37900001111" })).toBe(
      "https://x.com/c?phone=37900001111&tel=5537900001111",
    );
  });
});
