import { describe, expect, it } from "vitest";
import {
  blocosDaTranscricao,
  fonteDeAudio,
  lerRespostaAgente,
  mensagensPorMinuto,
  promptAgente,
  falaDoValor,
  promptGeracao,
  validarMensagensGeradas,
} from "@/src/lib/regras/ia";

const cfgBunny = { libraryId: "123", apiKey: "chave", cdnHost: "vz-abc.b-cdn.net" };

describe("fonteDeAudio", () => {
  it("vídeo do Bunny usa o MP4 de baixa resolução (360p) do CDN", () => {
    expect(fonteDeAudio({ origem: "bunny", bunny_guid: "g1", hls_url: null }, cfgBunny)).toEqual({
      url: "https://vz-abc.b-cdn.net/g1/play_360p.mp4",
    });
  });

  it("vídeo do Bunny sem guid dá erro", () => {
    expect(fonteDeAudio({ origem: "bunny", bunny_guid: null, hls_url: null }, cfgBunny)).toEqual({ erro: "Vídeo sem arquivo no Bunny." });
  });

  it("link externo MP4 usa o próprio link", () => {
    expect(fonteDeAudio({ origem: "externo", bunny_guid: null, hls_url: "https://x.com/a.mp4" }, cfgBunny)).toEqual({
      url: "https://x.com/a.mp4",
    });
  });

  it("link externo MP4 com query string (token de assinatura) também é aceito", () => {
    expect(fonteDeAudio({ origem: "externo", bunny_guid: null, hls_url: "https://x.com/a.mp4?token=abc&exp=123" }, cfgBunny)).toEqual({
      url: "https://x.com/a.mp4?token=abc&exp=123",
    });
  });

  it("link externo HLS é recusado", () => {
    expect(fonteDeAudio({ origem: "externo", bunny_guid: null, hls_url: "https://x.com/a.m3u8" }, cfgBunny)).toEqual({
      erro: "Para gerar o chat com IA, use um vídeo do Bunny ou um link MP4.",
    });
  });

  it("link externo sem URL dá erro", () => {
    expect(fonteDeAudio({ origem: "externo", bunny_guid: null, hls_url: null }, cfgBunny)).toEqual({ erro: "Vídeo sem link." });
  });
});

describe("blocosDaTranscricao", () => {
  it("sem palavras devolve lista vazia", () => {
    expect(blocosDaTranscricao([], 300)).toEqual([]);
  });

  it("agrupa em blocos de 300s e o último termina no fim da última palavra", () => {
    const palavras = [
      { texto: "Oi", inicio: 0, fim: 1 },
      { texto: "gente", inicio: 2, fim: 3 },
      { texto: "bem-vindos", inicio: 301, fim: 302 },
      { texto: "aula", inicio: 310, fim: 311.5 },
    ];
    expect(blocosDaTranscricao(palavras, 300)).toEqual([
      { inicio: 0, fim: 300, texto: "Oi gente" },
      { inicio: 300, fim: 311.5, texto: "bem-vindos aula" },
    ]);
  });

  it("blocos sem nenhuma palavra (silêncio) não entram na lista", () => {
    const palavras = [
      { texto: "Oi", inicio: 0, fim: 1 },
      { texto: "fim", inicio: 650, fim: 651 },
    ];
    const blocos = blocosDaTranscricao(palavras, 300);
    expect(blocos).toHaveLength(2);
    expect(blocos[0]).toEqual({ inicio: 0, fim: 300, texto: "Oi" });
    expect(blocos[1]).toEqual({ inicio: 600, fim: 651, texto: "fim" });
  });
});

describe("mensagensPorMinuto", () => {
  it("baixa, média e alta", () => {
    expect(mensagensPorMinuto("baixa")).toBe(1);
    expect(mensagensPorMinuto("media")).toBe(3);
    expect(mensagensPorMinuto("alta")).toBe(6);
  });
});

describe("promptGeracao", () => {
  it("pede JSON, explica o timing dentro do bloco e cita nome/tom/intensidade", () => {
    const bloco = { inicio: 300, fim: 600, texto: "conteúdo da aula aqui" };
    const { sistema, usuario } = promptGeracao(bloco, { idioma: "pt", tom: "natural", intensidade: "media", instrucoes: "público iniciante" });

    expect(sistema).toContain("JSON");
    expect(sistema).toContain("português do Brasil");
    expect(usuario).toContain("300");
    expect(usuario).toContain("600");
    expect(usuario).toContain("nomes próprios brasileiros");
    expect(usuario).toContain("público iniciante");
    expect(usuario).toContain('"segundo"');
    expect(usuario).toContain("DENTRO DESTE BLOCO");
    expect(usuario).toContain('"mensagens"');
  });

  it("sem instruções não quebra e não menciona o texto de instruções", () => {
    const bloco = { inicio: 0, fim: 300, texto: "x" };
    const { usuario } = promptGeracao(bloco, { idioma: "en", tom: "formal", intensidade: "baixa" });
    expect(usuario).not.toContain("Instruções sobre o público");
  });
});

describe("validarMensagensGeradas", () => {
  const bloco = { inicio: 300, fim: 600, texto: "x" };

  it("aceita mensagens válidas e converte o segundo pra absoluto", () => {
    const json = { mensagens: [{ segundo: 10, nome: "Ana", texto: "Muito bom!", suporte: false }] };
    expect(validarMensagensGeradas(json, bloco, 10)).toEqual([{ segundo: 310, nome: "Ana", texto: "Muito bom!", suporte: false }]);
  });

  it("descarta segundo fora do bloco (negativo ou maior que a duração e fora da janela absoluta)", () => {
    const json = {
      mensagens: [
        { segundo: -1, nome: "Ana", texto: "a", suporte: false },
        { segundo: 650, nome: "Ana", texto: "b", suporte: false }, // fora de [0,300] e de [300,600]
        { segundo: 300, nome: "Ana", texto: "no limite", suporte: false },
      ],
    };
    expect(validarMensagensGeradas(json, bloco, 10)).toEqual([{ segundo: 600, nome: "Ana", texto: "no limite", suporte: false }]);
  });

  it("aceita segundo absoluto (dentro de [inicio, fim]) quando o modelo ignora o pedido de segundo relativo", () => {
    // 450 está fora de [0, duracao=300] (relativo), mas dentro de [inicio=300, fim=600]: usa direto, sem somar inicio de novo.
    const json = { mensagens: [{ segundo: 450, nome: "Ana", texto: "absoluto", suporte: false }] };
    expect(validarMensagensGeradas(json, bloco, 10)).toEqual([{ segundo: 450, nome: "Ana", texto: "absoluto", suporte: false }]);
  });

  it("descarta texto vazio, longo demais, com link, com preço (R$) ou de encurtador/domínio; e nome vazio ou longo demais", () => {
    const longo = "a".repeat(151);
    const nomeLongo = "a".repeat(41);
    const json = {
      mensagens: [
        { segundo: 1, nome: "Ana", texto: "", suporte: false },
        { segundo: 1, nome: "Ana", texto: longo, suporte: false },
        { segundo: 1, nome: "Ana", texto: "olha isso: https://x.com", suporte: false },
        { segundo: 1, nome: "Ana", texto: "visita www.site.com", suporte: false },
        { segundo: 1, nome: "Ana", texto: "manda no bit.ly/xyz", suporte: false },
        { segundo: 1, nome: "Ana", texto: "chama no t.me/grupo", suporte: false },
        { segundo: 1, nome: "Ana", texto: "chama no wa.me/5511999999999", suporte: false },
        { segundo: 1, nome: "Ana", texto: "só custa R$ 97", suporte: false },
        { segundo: 1, nome: "", texto: "tudo certo", suporte: false },
        { segundo: 1, nome: nomeLongo, texto: "nome longo demais", suporte: false },
        { segundo: 1, nome: "Bia", texto: "essa aqui fica", suporte: false },
      ],
    };
    expect(validarMensagensGeradas(json, bloco, 20)).toEqual([{ segundo: 301, nome: "Bia", texto: "essa aqui fica", suporte: false }]);
  });

  it("no máximo 1 em cada 20 mensagens aceitas pode ser suporte, e sempre com nome 'Suporte'", () => {
    const mensagens = Array.from({ length: 25 }, (_, i) => ({ segundo: 1, nome: "Qualquer", texto: `msg ${i}`, suporte: true }));
    const validas = validarMensagensGeradas({ mensagens }, bloco, 100);
    const suporte = validas.filter((m) => m.suporte);
    expect(suporte.length).toBeLessThanOrEqual(2); // 25/20 arredondado pra baixo nos pontos de corte
    for (const m of suporte) expect(m.nome).toBe("Suporte");
    for (const m of validas.filter((m) => !m.suporte)) expect(m.nome).toBe("Qualquer");
  });

  it("corta no limite do bloco", () => {
    const json = { mensagens: Array.from({ length: 5 }, (_, i) => ({ segundo: i, nome: "Ana", texto: `msg ${i}`, suporte: false })) };
    expect(validarMensagensGeradas(json, bloco, 2)).toHaveLength(2);
  });

  it("JSON sem a chave 'mensagens' devolve lista vazia, sem lançar", () => {
    expect(validarMensagensGeradas({}, bloco, 10)).toEqual([]);
    expect(validarMensagensGeradas(null, bloco, 10)).toEqual([]);
  });
});

describe("promptAgente / lerRespostaAgente", () => {
  it("monta o prompt citando nome, instruções, contexto e FAQ, e pedindo o JSON responder/resposta", () => {
    const cfg = { nome: "Clara", instrucoes: "seja simpática", contexto: "curso de X por R$ 497", faq: "Tem garantia? Sim, 7 dias." };
    const { sistema, usuario } = promptAgente(cfg, "Tem garantia?", [{ autor: "participante", texto: "oi" }]);

    expect(sistema).toContain("Clara");
    expect(sistema).toContain("seja simpática");
    expect(sistema).toContain("curso de X por R$ 497");
    expect(sistema).toContain("Tem garantia? Sim, 7 dias.");
    expect(sistema).toContain("Nunca invente preço");
    expect(sistema).toContain('"responder"');
    expect(usuario).toContain("participante: oi");
    expect(usuario).toContain("Tem garantia?");
  });

  it("responde no próprio chat, sem começar marcando a pessoa (a sala já põe o @Nome)", () => {
    const { sistema } = promptAgente({ nome: "Clara" }, "oi?", []);
    expect(sistema).toContain("chat ao vivo");
    expect(sistema).toContain("Não comece com o nome nem com @ da pessoa");
  });

  it("sem nome configurado usa 'Suporte'", () => {
    const { sistema } = promptAgente({}, "oi", []);
    expect(sistema).toContain("Suporte");
  });

  it("manda o momento da aula em que a pessoa está (h:mm:ss), só quando informado", () => {
    expect(promptAgente({}, "quanto custa?", [], 4636).usuario).toContain("Momento da aula em que a pessoa está: 1:17:16.");
    expect(promptAgente({}, "quanto custa?", []).usuario).not.toContain("Momento da aula");
  });
});

describe("lerRespostaAgente", () => {
  it("responder true com resposta não vazia é aceito", () => {
    expect(lerRespostaAgente({ responder: true, resposta: "Sim, custa R$ 497." })).toEqual({ responder: true, resposta: "Sim, custa R$ 497." });
  });

  it("responder false não responde mesmo com texto", () => {
    expect(lerRespostaAgente({ responder: false, resposta: "qualquer coisa" })).toEqual({ responder: false, resposta: "" });
  });

  it("responder true com resposta vazia não responde", () => {
    expect(lerRespostaAgente({ responder: true, resposta: "" })).toEqual({ responder: false, resposta: "" });
  });

  it("resposta maior que 600 caracteres é cortada", () => {
    const r = lerRespostaAgente({ responder: true, resposta: "a".repeat(700) });
    expect(r.responder).toBe(true);
    expect(r.resposta).toHaveLength(600);
  });

  it("JSON inesperado não lança, só não responde", () => {
    expect(lerRespostaAgente(null)).toEqual({ responder: false, resposta: "" });
    expect(lerRespostaAgente("texto qualquer")).toEqual({ responder: false, resposta: "" });
    expect(lerRespostaAgente({})).toEqual({ responder: false, resposta: "" });
  });
});

describe("falaDoValor", () => {
  const precos = ["R$ 4.000", "12x R$ 199,70 ou R$ 1.997 à vista"];
  it("acha o preço da oferta em qualquer formato", () => {
    expect(falaDoValor("Sai por R$ 1.997", precos)).toBe(true);
    expect(falaDoValor("custa 1997 reais", precos)).toBe(true);
    expect(falaDoValor("de 4000 por menos", precos)).toBe(true);
    expect(falaDoValor("parcela de 199,70", precos)).toBe(true);
  });
  it("acha fala de pagamento (parcelas, à vista, desconto)", () => {
    expect(falaDoValor("dá pra fazer em 12x", precos)).toBe(true);
    expect(falaDoValor("tem desconto pra quem entra hoje", precos)).toBe(true);
    expect(falaDoValor("pagando à vista sai melhor", precos)).toBe(true);
  });
  it("número da aula que não é o preço não conta", () => {
    expect(falaDoValor("um agente nosso foi vendido por R$ 30 mil", precos)).toBe(false);
    expect(falaDoValor("são 5 agentes e 705 barbearias usando", precos)).toBe(false);
    expect(falaDoValor("Funciona, cara. O módulo zero começa do zero.", precos)).toBe(false);
  });
});
