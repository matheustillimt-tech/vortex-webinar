import { describe, expect, it } from "vitest";
import {
  conversasParaLinhas,
  eventosDoParametro,
  momentoParaLinhas,
  nomeArquivoExportacao,
  participantesParaLinhas,
  protegerFormula,
  tempoAssistido,
  vendasExportParaLinhas,
  type MensagemExport,
  type SessaoExport,
  type VendaExport,
} from "@/src/lib/regras/exportar";

const SESSAO: SessaoExport = {
  nome: "Ana",
  email: "ana@exemplo.com",
  telefoneE164: "+5511999999999",
  entrouEm: "2026-10-21T15:00:00.000Z", // 12:00 em Brasília
  modo: "ao_vivo",
  maxSegundo: 3725, // 1:02:05
  pais: "Brasil",
  cidade: "São Paulo",
  dispositivo: "desktop",
  utms: { utm_source: "meta", utm_medium: "cpc" },
  eventos: ["acessou_sala", "pitch"],
};

describe("tempoAssistido", () => {
  it("formata segundos em h:mm:ss", () => {
    expect(tempoAssistido(3725)).toBe("01:02:05");
    expect(tempoAssistido(0)).toBe("00:00:00");
    expect(tempoAssistido(65)).toBe("00:01:05");
  });

  it("nulo/indefinido vira 00:00:00", () => {
    expect(tempoAssistido(null)).toBe("00:00:00");
    expect(tempoAssistido(undefined)).toBe("00:00:00");
  });
});

describe("protegerFormula", () => {
  it.each(["=SOMA(A1)", "+1+1", "-1", "@SUM(1)", "\tx", "\rx"])("prefixa apóstrofo quando começa com '%s'", (valor) => {
    expect(protegerFormula(valor)).toBe(`'${valor}`);
  });

  it("texto normal não muda", () => {
    expect(protegerFormula("Ana Silva")).toBe("Ana Silva");
  });

  it("string vazia não muda", () => {
    expect(protegerFormula("")).toBe("");
  });

  it("caractere perigoso no meio (não no início) não muda", () => {
    expect(protegerFormula("Ana =Silva")).toBe("Ana =Silva");
  });
});

describe("eventosDoParametro", () => {
  it("sem parâmetro: lista vazia", () => {
    expect(eventosDoParametro(null)).toEqual([]);
  });

  it("um tipo válido", () => {
    expect(eventosDoParametro("pitch")).toEqual(["pitch"]);
  });

  it("dois tipos válidos, separados por vírgula", () => {
    expect(eventosDoParametro("pitch,oferta")).toEqual(["pitch", "oferta"]);
  });

  it("mais de 2 tipos: inválido (null)", () => {
    expect(eventosDoParametro("pitch,oferta,comprou")).toBeNull();
  });

  it("tipo desconhecido: inválido (null)", () => {
    expect(eventosDoParametro("banana")).toBeNull();
  });

  it("string com só vírgulas/espaços: trata como se não tivesse vindo (lista vazia, não é erro)", () => {
    expect(eventosDoParametro(" , ")).toEqual([]);
  });
});

describe("participantesParaLinhas", () => {
  it("monta o cabeçalho e uma linha por sessão", () => {
    const linhas = participantesParaLinhas([SESSAO]);
    expect(linhas[0]).toEqual([
      "Nome",
      "E-mail",
      "WhatsApp",
      "Entrou em",
      "Modo",
      "Tempo assistido",
      "País",
      "Cidade",
      "Dispositivo",
      "UTM Source",
      "UTM Medium",
      "UTM Campaign",
      "UTM Content",
      "UTM Term",
      "Eventos",
      "Comprou",
    ]);
    expect(linhas[1]).toEqual([
      "Ana",
      "ana@exemplo.com",
      "+5511999999999",
      "21/10/2026 12:00",
      "Ao vivo",
      "01:02:05",
      "Brasil",
      "São Paulo",
      "desktop",
      "meta",
      "cpc",
      "",
      "",
      "",
      "acessou_sala, pitch",
      "Não",
    ]);
  });

  it("quem comprou (evento 'comprou') aparece como Sim", () => {
    const linhas = participantesParaLinhas([{ ...SESSAO, eventos: ["comprou"] }]);
    expect(linhas[1].at(-1)).toBe("Sim");
  });

  it("sem e-mail/telefone/UTMs, colunas vazias (nunca undefined)", () => {
    const linhas = participantesParaLinhas([{ ...SESSAO, email: null, telefoneE164: null, utms: null }]);
    expect(linhas[1][1]).toBe("");
    expect(linhas[1][2]).toBe("");
    expect(linhas[1][9]).toBe("");
  });

  it("protege nome/e-mail/cidade/UTMs contra injeção de fórmula (Revisão final)", () => {
    const linhas = participantesParaLinhas([
      { ...SESSAO, nome: "=1+1", email: "+ana@exemplo.com", cidade: "@Curitiba", utms: { utm_source: "-meta", utm_medium: "cpc" } },
    ]);
    expect(linhas[1][0]).toBe("'=1+1");
    expect(linhas[1][1]).toBe("'+ana@exemplo.com");
    expect(linhas[1][7]).toBe("'@Curitiba");
    expect(linhas[1][9]).toBe("'-meta");
    expect(linhas[1][10]).toBe("cpc"); // sem caractere perigoso: não muda
  });
});

describe("momentoParaLinhas", () => {
  const comAmbos: SessaoExport = { ...SESSAO, nome: "Bia", eventos: ["acessou_sala", "pitch", "oferta"] };
  const soUm: SessaoExport = { ...SESSAO, nome: "Caio", eventos: ["acessou_sala"] };

  it("só entra quem tem TODOS os eventos pedidos", () => {
    const linhas = momentoParaLinhas([comAmbos, soUm], ["pitch", "oferta"]);
    expect(linhas).toHaveLength(2); // cabeçalho + Bia
    expect(linhas[1][0]).toBe("Bia");
  });

  it("um evento só: filtra por ele", () => {
    const linhas = momentoParaLinhas([comAmbos, soUm], ["acessou_sala"]);
    expect(linhas).toHaveLength(3); // cabeçalho + Bia + Caio
  });

  it("ninguém tem os eventos pedidos: só o cabeçalho", () => {
    const linhas = momentoParaLinhas([soUm], ["comprou"]);
    expect(linhas).toHaveLength(1);
  });
});

describe("conversasParaLinhas", () => {
  const BASE: MensagemExport = {
    participanteNome: "Ana",
    participanteEmail: "ana@exemplo.com",
    criadaEm: "2026-10-21T15:00:00.000Z",
    autor: "participante",
    autorNome: null,
    texto: "Oi, tudo bem?",
    imagemUrl: null,
    apagada: false,
  };

  it("monta o cabeçalho e as colunas", () => {
    const linhas = conversasParaLinhas([BASE]);
    expect(linhas[0]).toEqual(["Participante", "E-mail", "Data", "Autor", "Mensagem", "Imagem"]);
    expect(linhas[1]).toEqual(["Ana", "ana@exemplo.com", "21/10/2026 12:00", "Participante", "Oi, tudo bem?", ""]);
  });

  it("mensagem apagada vira '[apagada]', mesmo tendo texto salvo", () => {
    const linhas = conversasParaLinhas([{ ...BASE, apagada: true }]);
    expect(linhas[1][4]).toBe("[apagada]");
  });

  it("atendente leva o nome de quem atendeu", () => {
    const linhas = conversasParaLinhas([{ ...BASE, autor: "atendente", autorNome: "Bruno" }]);
    expect(linhas[1][3]).toBe("Atendente Bruno");
  });

  it("chatbot e ia usam o rótulo fixo", () => {
    expect(conversasParaLinhas([{ ...BASE, autor: "chatbot" }])[1][3]).toBe("Chatbot");
    expect(conversasParaLinhas([{ ...BASE, autor: "ia" }])[1][3]).toBe("IA");
  });

  it("mensagem de imagem leva a URL", () => {
    const linhas = conversasParaLinhas([{ ...BASE, texto: null, imagemUrl: "https://x/img.png" }]);
    expect(linhas[1][5]).toBe("https://x/img.png");
  });

  it("protege nome/e-mail/mensagem contra injeção de fórmula (Revisão final)", () => {
    const linhas = conversasParaLinhas([{ ...BASE, participanteNome: "=HYPERLINK()", participanteEmail: "=x@y.com", texto: "=1+1" }]);
    expect(linhas[1][0]).toBe("'=HYPERLINK()");
    expect(linhas[1][1]).toBe("'=x@y.com");
    expect(linhas[1][4]).toBe("'=1+1");
  });
});

describe("vendasExportParaLinhas", () => {
  const VENDA: VendaExport = {
    criadaEm: "2026-10-21T15:00:00.000Z",
    plataforma: "hotmart",
    idTransacao: "T1",
    valorCentavos: 19700,
    compradorEmail: "ana@exemplo.com",
    sessaoId: "sessao-1",
  };

  it("monta o cabeçalho e as colunas; valor é número em reais, não texto formatado (Revisão final)", () => {
    const linhas = vendasExportParaLinhas([VENDA]);
    expect(linhas[0]).toEqual(["Data", "Plataforma", "Transação", "Valor", "Comprador", "Casada com sessão"]);
    expect(linhas[1]).toEqual(["21/10/2026 12:00", "hotmart", "T1", 197, "ana@exemplo.com", "Sim"]);
    expect(typeof linhas[1][3]).toBe("number");
  });

  it("e-mail do comprador começando com '=' leva apóstrofo (proteção contra fórmula)", () => {
    const linhas = vendasExportParaLinhas([{ ...VENDA, compradorEmail: "=cmd|'/c calc'!A1" }]);
    expect(linhas[1][4]).toBe("'=cmd|'/c calc'!A1");
  });

  it("sem sessao_id: 'Não' (venda sem sessão casada)", () => {
    const linhas = vendasExportParaLinhas([{ ...VENDA, sessaoId: null }]);
    expect(linhas[1].at(-1)).toBe("Não");
  });
});

describe("nomeArquivoExportacao", () => {
  it("monta '<tipo>-<slug>-<AAAA-MM-DD>.xlsx' na data de Brasília", () => {
    // 2026-10-22T02:00:00Z = 2026-10-21 23:00 em Brasília (ainda dia 21).
    expect(nomeArquivoExportacao("participantes", "aula-de-vendas", new Date("2026-10-22T02:00:00.000Z"))).toBe(
      "participantes-aula-de-vendas-2026-10-21.xlsx",
    );
  });
});
