import { afterEach, describe, expect, it, vi } from "vitest";
import {
  coluna,
  filtrarConversas,
  percentualAssistido,
  diaAnterior,
  turmaDe,
  turmaValida,
  bucketsAcessos,
  conversaDaLinha,
  estaOnline,
  previaUltimaMensagem,
  validarRespostaAtendente,
  type LinhaConversaSql,
} from "@/src/lib/regras/atendimento";
import { criarThrottle } from "@/src/lib/throttle";

describe("estaOnline", () => {
  const agora = new Date("2026-10-20T12:00:00.000Z");

  it("sem sinal nunca: offline", () => {
    expect(estaOnline(null, agora)).toBe(false);
  });
  it("sinal há 59 s: online", () => {
    expect(estaOnline(new Date("2026-10-20T11:59:01.000Z"), agora)).toBe(true);
  });
  it("sinal há exatos 60 s: online (≤ 60 s)", () => {
    expect(estaOnline(new Date("2026-10-20T11:59:00.000Z"), agora)).toBe(true);
  });
  it("sinal há 61 s: offline", () => {
    expect(estaOnline(new Date("2026-10-20T11:58:59.000Z"), agora)).toBe(false);
  });
});

describe("coluna", () => {
  it.each([
    [{ atendenteId: null, status: "aguardando" as const }, "ia"],
    [{ atendenteId: null, status: "dispensado" as const }, "ia"],
    [{ atendenteId: "a-1", status: "aguardando" as const }, "ia"],
    [{ atendenteId: "a-1", status: "atendido" as const }, "ia"],
    [{ atendenteId: null, status: "atendendo" as const }, "ia"],
    [{ atendenteId: "a-1", status: "atendendo" as const }, "humano"],
  ])("%j → %s", (conversa, esperado) => {
    expect(coluna(conversa)).toBe(esperado);
  });
});

describe("validarRespostaAtendente", () => {
  it("texto válido, sem imagem: ok", () => {
    expect(validarRespostaAtendente("Oi, tudo bem?", false)).toBeNull();
  });
  it("imagem sem texto: ok", () => {
    expect(validarRespostaAtendente("", true)).toBeNull();
  });
  it("texto só com espaços e sem imagem: erro", () => {
    expect(validarRespostaAtendente("   ", false)).toBe("Escreva uma mensagem ou envie uma imagem.");
  });
  it("texto vazio e sem imagem: erro", () => {
    expect(validarRespostaAtendente("", false)).toBe("Escreva uma mensagem ou envie uma imagem.");
  });
  it("texto com 1001 caracteres: erro", () => {
    expect(validarRespostaAtendente("a".repeat(1001), false)).toBe("A mensagem passa de 1000 caracteres.");
  });
  it("texto com exatos 1000 caracteres: ok", () => {
    expect(validarRespostaAtendente("a".repeat(1000), false)).toBeNull();
  });
});

describe("bucketsAcessos", () => {
  it("sem entradas: buckets zerados até agora", () => {
    const inicioDia = new Date("2026-10-20T00:00:00.000Z");
    const agora = new Date("2026-10-20T00:25:00.000Z");
    const r = bucketsAcessos([], inicioDia, 10, agora);
    expect(r).toEqual([
      { inicio: new Date("2026-10-20T00:00:00.000Z"), total: 0 },
      { inicio: new Date("2026-10-20T00:10:00.000Z"), total: 0 },
      { inicio: new Date("2026-10-20T00:20:00.000Z"), total: 0 },
    ]);
  });

  it("conta cada entrada no bucket de 10 min correto", () => {
    const inicioDia = new Date("2026-10-20T00:00:00.000Z");
    const agora = new Date("2026-10-20T00:25:00.000Z");
    const entradas = [
      new Date("2026-10-20T00:01:00.000Z"),
      new Date("2026-10-20T00:09:59.000Z"),
      new Date("2026-10-20T00:12:00.000Z"),
      new Date("2026-10-20T00:24:00.000Z"),
    ];
    const r = bucketsAcessos(entradas, inicioDia, 10, agora);
    expect(r.map((b) => b.total)).toEqual([2, 1, 1]);
  });

  it("entrada antes do início do dia ou depois de agora não conta", () => {
    const inicioDia = new Date("2026-10-20T00:00:00.000Z");
    const agora = new Date("2026-10-20T00:15:00.000Z");
    const entradas = [new Date("2026-10-19T23:59:00.000Z"), new Date("2026-10-20T00:20:00.000Z")];
    const r = bucketsAcessos(entradas, inicioDia, 10, agora);
    expect(r.reduce((a, b) => a + b.total, 0)).toBe(0);
  });
});

describe("conversaDaLinha", () => {
  const agora = new Date("2026-10-20T12:00:00.000Z");
  const linha: LinhaConversaSql = {
    sessao_id: "s1",
    participante_nome: "Clara",
    participante_email: "carla@exemplo.com",
    participante_telefone: null,
    inicio_sessao: "2026-10-20T11:00:00+00:00",
    ultimo_sinal_em: "2026-10-20T11:59:50+00:00",
    status_atendimento: "aguardando",
    atendente_id: null,
    atendente_nome: null,
    ultima_texto: null,
    ultima_imagem: true,
    ultima_autor: "participante",
    ultima_em: "2026-10-20T11:59:30.123456+00:00",
    ultima_apagada: false,
    nao_lidas: 2,
  };

  it("converte a linha da função SQL: datas, online (≤ 60 s), última mensagem e não lidas", () => {
    expect(conversaDaLinha(linha, agora)).toEqual({
      sessaoId: "s1",
      nome: "Clara",
      email: "carla@exemplo.com",
      telefoneE164: null,
      inicioSessao: new Date("2026-10-20T11:00:00.000Z"),
      online: true,
      status: "aguardando",
      atendenteId: null,
      nomeAtendente: null,
      ultimaMensagem: { texto: null, temImagem: true, apagada: false, autor: "participante", criadaEm: new Date("2026-10-20T11:59:30.123Z") },
      naoLidas: 2,
    });
  });

  it("offline sem sinal ou com sinal velho; sem nome vira 'Sem nome'", () => {
    expect(conversaDaLinha({ ...linha, ultimo_sinal_em: null }, agora).online).toBe(false);
    expect(conversaDaLinha({ ...linha, ultimo_sinal_em: "2026-10-20T11:58:00+00:00" }, agora).online).toBe(false);
    expect(conversaDaLinha({ ...linha, participante_nome: null }, agora).nome).toBe("Sem nome");
  });

  it("apagada: nunca leva texto nem imagem, mesmo que a linha traga", () => {
    const c = conversaDaLinha({ ...linha, ultima_apagada: true, ultima_texto: "segredo", ultima_imagem: true }, agora);
    expect(c.ultimaMensagem).toMatchObject({ texto: null, temImagem: false, apagada: true });
  });
});

describe("previaUltimaMensagem", () => {
  const base = { texto: null, temImagem: false, apagada: false, autor: "participante" as const, criadaEm: new Date() };
  it("apagada: 'Mensagem apagada'", () => {
    expect(previaUltimaMensagem({ ...base, apagada: true })).toBe("Mensagem apagada");
  });
  it("texto quando tem; senão 'Imagem'; sem nada: 'Sem mensagens'", () => {
    expect(previaUltimaMensagem({ ...base, texto: "Oi" })).toBe("Oi");
    expect(previaUltimaMensagem({ ...base, temImagem: true })).toBe("Imagem");
    expect(previaUltimaMensagem(null)).toBe("Sem mensagens");
  });
});

describe("criarThrottle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("chama na hora, segura as chamadas seguintes e garante uma chamada no fim (trailing)", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = criarThrottle(fn, 1000);
    t.chamar();
    expect(fn).toHaveBeenCalledTimes(1);
    t.chamar();
    t.chamar();
    t.chamar();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2); // uma só pela rajada inteira
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("nunca passa de 1 chamada por intervalo numa rajada longa", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = criarThrottle(fn, 1000);
    for (let i = 0; i < 50; i++) {
      t.chamar();
      vi.advanceTimersByTime(100);
    }
    // 5 s de rajada: no máximo 1 por segundo (+ a primeira na hora).
    expect(fn.mock.calls.length).toBeLessThanOrEqual(6);
    vi.advanceTimersByTime(1000);
    const total = fn.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(fn.mock.calls.length).toBe(total);
  });

  it("depois de um intervalo parado, chama na hora de novo; cancelar descarta o trailing pendente", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = criarThrottle(fn, 1000);
    t.chamar();
    vi.advanceTimersByTime(3000);
    t.chamar();
    expect(fn).toHaveBeenCalledTimes(2);
    t.chamar();
    t.cancelar();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("turmas", () => {
  it("turmaDe: dia em Brasília com virada às 06:00", () => {
    expect(turmaDe(new Date("2026-10-22T22:30:00Z"))).toBe("2026-10-22"); // 19:30
    expect(turmaDe(new Date("2026-10-23T03:40:00Z"))).toBe("2026-10-22"); // 00:40, ainda a turma da noite
    expect(turmaDe(new Date("2026-10-23T08:59:00Z"))).toBe("2026-10-22"); // 05:59
    expect(turmaDe(new Date("2026-10-23T09:00:00Z"))).toBe("2026-10-23"); // 06:00
  });
  it("diaAnterior: vira mês", () => {
    expect(diaAnterior("2026-10-23")).toBe("2026-10-22");
    expect(diaAnterior("2026-11-01")).toBe("2026-10-31");
  });
  it("turmaValida", () => {
    expect(turmaValida("2026-10-23")).toBe(true);
    expect(turmaValida("2026-13-40")).toBe(false);
    expect(turmaValida("23/10")).toBe(false);
  });
});

describe("percentualAssistido", () => {
  it("arredonda, limita a 0–100 e sem duração vira null", () => {
    expect(percentualAssistido(2700, 5400)).toBe(50);
    expect(percentualAssistido(1, 300)).toBe(0);
    expect(percentualAssistido(9999, 5400)).toBe(100);
    expect(percentualAssistido(null, 5400)).toBe(0);
    expect(percentualAssistido(100, 0)).toBeNull();
    expect(percentualAssistido(100, null)).toBeNull();
  });
});

describe("filtrarConversas", () => {
  const lista = [
    { nome: "José Antônio", telefoneE164: "+5524900001234", email: null },
    { nome: "Ana Souza", telefoneE164: null, email: "ana@x.com" },
    { nome: "Pedro", telefoneE164: "+5511900000000", email: null },
  ];
  it("nome sem acento e sem caixa", () => {
    expect(filtrarConversas(lista, "jose ant").map((c) => c.nome)).toEqual(["José Antônio"]);
    expect(filtrarConversas(lista, "SOUZA").map((c) => c.nome)).toEqual(["Ana Souza"]);
  });
  it("pedaço do telefone, com ou sem formatação", () => {
    expect(filtrarConversas(lista, "90000-1234").map((c) => c.nome)).toEqual(["José Antônio"]);
    expect(filtrarConversas(lista, "(11) 9000").map((c) => c.nome)).toEqual(["Pedro"]);
  });
  it("e-mail; termo vazio devolve tudo; 2 dígitos não buscam telefone", () => {
    expect(filtrarConversas(lista, "ana@").map((c) => c.nome)).toEqual(["Ana Souza"]);
    expect(filtrarConversas(lista, "  ")).toHaveLength(3);
    expect(filtrarConversas(lista, "55")).toEqual([]);
  });
});
