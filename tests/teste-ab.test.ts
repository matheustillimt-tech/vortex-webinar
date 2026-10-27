import { describe, expect, it } from "vitest";
import { LETRAS_VARIACAO, dentroDoPeriodo, sortearVariacao, validarTesteAb } from "@/src/lib/regras/teste-ab";

const SP = "America/Sao_Paulo";
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const D = "44444444-4444-4444-4444-444444444444";
const E = "55555555-5555-5555-5555-555555555555";

const base = {
  nome: "Teste de headline",
  slug: "teste-headline",
  inicio: "2026-10-20T08:00",
  fim: "2026-10-30T23:59",
  fuso: SP,
  variacoes: [
    { webinar_id: A, percentual: "50" },
    { webinar_id: B, percentual: 50 },
  ],
};
const ctx = { webinarsAtivos: [A, B, C, D, E], slugsOcupados: ["aula-x"] };

function erro(entrada: Partial<typeof base> & Record<string, unknown>, c: Parameters<typeof validarTesteAb>[1] = ctx): string | undefined {
  const r = validarTesteAb({ ...base, ...entrada }, c);
  return "erro" in r ? r.erro : undefined;
}

describe("validarTesteAb", () => {
  it("aceita um teste válido e converte datas no fuso", () => {
    const r = validarTesteAb(base, ctx);
    expect(r).toEqual({
      dados: {
        nome: "Teste de headline",
        slug: "teste-headline",
        inicio: new Date("2026-10-20T11:00:00Z"),
        fim: new Date("2026-10-31T02:59:00Z"),
        fuso: SP,
        variacoes: [
          { webinarId: A, percentual: 50 },
          { webinarId: B, percentual: 50 },
        ],
      },
    });
  });

  it("aceita Date/ISO com fuso (do banco) e fim idêntico ao início", () => {
    const r = validarTesteAb({ ...base, inicio: "2026-10-20T11:00:00Z", fim: new Date("2026-10-20T11:00:00Z") }, ctx);
    expect(r).toHaveProperty("dados");
  });

  it("nome obrigatório e até 120", () => {
    expect(erro({ nome: "  " })).toBe("Informe o nome do teste.");
    expect(erro({ nome: "x".repeat(121) })).toBe("Use até 120 caracteres no nome.");
  });

  it("slug com as regras do webinar e sem colidir com outro teste ou webinar", () => {
    expect(erro({ slug: "AB" })).toBe("Use de 3 a 60 caracteres.");
    expect(erro({ slug: "Teste AB" })).toBe("Use só letras minúsculas, números e hífen.");
    expect(erro({ slug: "aula-x" })).toBe("Este link já está em uso.");
  });

  it("datas obrigatórias, fim ≥ início, fuso válido", () => {
    expect(erro({ inicio: "" })).toBe("Informe o início e o fim do teste.");
    expect(erro({ fim: "ontem" })).toBe("Informe o início e o fim do teste.");
    expect(erro({ fim: "2026-10-19T08:00" })).toBe("O fim não pode vir antes do início.");
    expect(erro({ fuso: "Marte/Base" })).toBe("Escolha um fuso válido.");
  });

  it("2 a 4 variações", () => {
    expect(erro({ variacoes: [{ webinar_id: A, percentual: 100 }] })).toBe("Escolha de 2 a 4 webinars.");
    expect(
      erro({
        variacoes: [A, B, C, D, E].map((w) => ({ webinar_id: w, percentual: 20 })),
      }),
    ).toBe("Escolha de 2 a 4 webinars.");
    expect(erro({ variacoes: [A, B, C, D].map((w) => ({ webinar_id: w, percentual: 25 })) })).toBeUndefined();
  });

  it("webinars escolhidos, distintos e ativos", () => {
    expect(erro({ variacoes: [{ webinar_id: A, percentual: 50 }, { webinar_id: "", percentual: 50 }] })).toBe("Escolha o webinar da variação B.");
    expect(erro({ variacoes: [{ webinar_id: A, percentual: 50 }, { webinar_id: A, percentual: 50 }] })).toBe("Cada variação precisa ser um webinar diferente.");
    expect(erro({}, { ...ctx, webinarsAtivos: [A] })).toBe("O webinar da variação B não está ativo.");
  });

  it("percentuais inteiros ≥ 1 somando 100", () => {
    expect(erro({ variacoes: [{ webinar_id: A, percentual: 0 }, { webinar_id: B, percentual: 100 }] })).toBe(
      "O percentual da variação A precisa ser um número inteiro de 1 a 100.",
    );
    expect(erro({ variacoes: [{ webinar_id: A, percentual: "33.5" }, { webinar_id: B, percentual: 66.5 }] })).toBe(
      "O percentual da variação A precisa ser um número inteiro de 1 a 100.",
    );
    expect(erro({ variacoes: [{ webinar_id: A, percentual: 40 }, { webinar_id: B, percentual: 50 }] })).toBe(
      "Os percentuais precisam somar 100% (faltam 10%).",
    );
    expect(erro({ variacoes: [{ webinar_id: A, percentual: 60 }, { webinar_id: B, percentual: 50 }] })).toBe(
      "Os percentuais precisam somar 100% (sobram 10%).",
    );
  });

  it("com participantes, as variações não podem mudar (só nome/datas)", () => {
    const atuais = [
      { webinarId: A, percentual: 50 },
      { webinarId: B, percentual: 50 },
    ];
    const c = { ...ctx, temParticipantes: true, variacoesAtuais: atuais };
    expect(erro({ variacoes: [{ webinar_id: A, percentual: 60 }, { webinar_id: B, percentual: 40 }] }, c)).toBe(
      "Este teste já tem participantes; as variações não podem mudar.",
    );
    expect(erro({ variacoes: [{ webinar_id: B, percentual: 50 }, { webinar_id: A, percentual: 50 }] }, c)).toBe(
      "Este teste já tem participantes; as variações não podem mudar.",
    );
    const r = validarTesteAb({ ...base, nome: "Outro nome", variacoes: undefined }, c);
    expect(r).toHaveProperty("dados.nome", "Outro nome");
    expect(r).toHaveProperty("dados.variacoes", atuais);
    // Mesmas variações enviadas de novo: tudo bem. Webinar arquivado depois de começar não trava a edição.
    expect(erro({}, { ...c, webinarsAtivos: [] })).toBeUndefined();
  });
});

describe("sortearVariacao", () => {
  const v = [
    { webinarId: A, percentual: 50 },
    { webinarId: B, percentual: 30 },
    { webinarId: C, percentual: 20 },
  ];

  it("escolhe pela faixa acumulada", () => {
    expect(sortearVariacao(v, 0)?.webinarId).toBe(A);
    expect(sortearVariacao(v, 0.4999)?.webinarId).toBe(A);
    expect(sortearVariacao(v, 0.5)?.webinarId).toBe(B);
    expect(sortearVariacao(v, 0.7999)?.webinarId).toBe(B);
    expect(sortearVariacao(v, 0.8)?.webinarId).toBe(C);
    expect(sortearVariacao(v, 0.9999)?.webinarId).toBe(C);
  });

  it("aleatório fora de 0..1 é limitado; lista vazia → null", () => {
    expect(sortearVariacao(v, 1)?.webinarId).toBe(C);
    expect(sortearVariacao(v, -0.2)?.webinarId).toBe(A);
    expect(sortearVariacao(v, Number.NaN)?.webinarId).toBe(A);
    expect(sortearVariacao([], 0.3)).toBeNull();
  });

  it("ignora percentual ≤ 0 e normaliza quando não soma 100", () => {
    const w = [
      { webinarId: A, percentual: 0 },
      { webinarId: B, percentual: 1 },
      { webinarId: C, percentual: 3 },
    ];
    expect(sortearVariacao(w, 0)?.webinarId).toBe(B);
    expect(sortearVariacao(w, 0.24)?.webinarId).toBe(B);
    expect(sortearVariacao(w, 0.25)?.webinarId).toBe(C);
    expect(sortearVariacao([{ webinarId: A, percentual: 0 }], 0.5)).toBeNull();
  });

  it("distribuição bate com os percentuais numa grade uniforme", () => {
    const contagem: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const r = sortearVariacao(v, i / 1000)!;
      contagem[r.webinarId] = (contagem[r.webinarId] ?? 0) + 1;
    }
    expect(contagem).toEqual({ [A]: 500, [B]: 300, [C]: 200 });
  });
});

describe("dentroDoPeriodo", () => {
  const teste = { inicio: new Date("2026-10-20T11:00:00Z"), fim: new Date("2026-10-30T11:00:00Z"), arquivado: false };

  it("inclui as bordas", () => {
    expect(dentroDoPeriodo(teste, new Date("2026-10-20T11:00:00Z"))).toBe(true);
    expect(dentroDoPeriodo(teste, new Date("2026-10-25T00:00:00Z"))).toBe(true);
    expect(dentroDoPeriodo(teste, new Date("2026-10-30T11:00:00Z"))).toBe(true);
  });

  it("fora do período ou arquivado → false", () => {
    expect(dentroDoPeriodo(teste, new Date("2026-10-20T10:59:59Z"))).toBe(false);
    expect(dentroDoPeriodo(teste, new Date("2026-10-30T11:00:01Z"))).toBe(false);
    expect(dentroDoPeriodo({ ...teste, arquivado: true }, new Date("2026-10-25T00:00:00Z"))).toBe(false);
  });
});

describe("LETRAS_VARIACAO", () => {
  it("A, B, C, D", () => {
    expect([...LETRAS_VARIACAO]).toEqual(["A", "B", "C", "D"]);
  });
});

describe("cookies do teste A/B", () => {
  it("nomes por teste e por webinar", async () => {
    const { nomeCookieAb, nomeCookieAbWebinar, DIAS_COOKIE_AB } = await import("@/src/lib/regras/teste-ab");
    expect(nomeCookieAb("t-1")).toBe("vw_ab_t-1");
    expect(nomeCookieAbWebinar("w-1")).toBe("vw_abw_w-1");
    expect(DIAS_COOKIE_AB).toBe(30);
  });
});

describe("escolherVariacaoAb", () => {
  const vs = [
    { webinarId: A, percentual: 50, slug: "aula-a" },
    { webinarId: B, percentual: 50, slug: "aula-b" },
  ];
  it("cookie apontando para uma variação ativa: mantém, sem sortear", async () => {
    const { escolherVariacaoAb } = await import("@/src/lib/regras/teste-ab");
    expect(escolherVariacaoAb(vs, B, 0)).toEqual({ variacao: vs[1], sorteada: false });
  });
  it("sem cookie, ou cookie de webinar que saiu do teste: sorteia", async () => {
    const { escolherVariacaoAb } = await import("@/src/lib/regras/teste-ab");
    expect(escolherVariacaoAb(vs, null, 0.7)).toEqual({ variacao: vs[1], sorteada: true });
    expect(escolherVariacaoAb(vs, C, 0.1)).toEqual({ variacao: vs[0], sorteada: true });
  });
  it("sem variação: null", async () => {
    const { escolherVariacaoAb } = await import("@/src/lib/regras/teste-ab");
    expect(escolherVariacaoAb([], null, 0.5)).toBeNull();
  });
});

describe("montarComparacaoAb", () => {
  const linha = (o: Partial<Record<string, number | string>>) => ({
    ordem: 0,
    webinarId: A,
    nome: "Aula A",
    percentual: 50,
    cadastros: 0,
    acessouSala: 0,
    min15: 0,
    pitch: 0,
    oferta: 0,
    clicouOferta: 0,
    comprou: 0,
    vendas: 0,
    faturamentoCentavos: 0,
    tempoMedioSeg: 0,
    ...o,
  });

  it("letras e cores fixas pela ordem, funil com % sobre cadastros e receita por participante", async () => {
    const { montarComparacaoAb, CORES_VARIACAO } = await import("@/src/lib/regras/teste-ab");
    const c = montarComparacaoAb([
      linha({ ordem: 1, webinarId: B, nome: "Aula B", cadastros: 200, acessouSala: 100, comprou: 10, vendas: 10, faturamentoCentavos: 100000, tempoMedioSeg: 610 }),
      linha({ ordem: 0, cadastros: 100, acessouSala: 50, min15: 40, pitch: 30, oferta: 25, clicouOferta: 10, comprou: 4, vendas: 5, faturamentoCentavos: 50000, tempoMedioSeg: 300 }),
    ]);
    expect(c.variacoes.map((v) => [v.letra, v.cor, v.nome])).toEqual([
      ["A", CORES_VARIACAO[0], "Aula A"],
      ["B", CORES_VARIACAO[1], "Aula B"],
    ]);
    expect(CORES_VARIACAO).toHaveLength(4);
    const etapa = (e: string) => c.funil.find((f) => f.etapa === e)!.valores;
    expect(etapa("cadastros")).toEqual([{ numero: 100, percentual: 100 }, { numero: 200, percentual: 100 }]);
    expect(etapa("acessou_sala")).toEqual([{ numero: 50, percentual: 50 }, { numero: 100, percentual: 50 }]);
    expect(etapa("comprou")).toEqual([{ numero: 4, percentual: 4 }, { numero: 10, percentual: 5 }]);
    expect(c.vendas).toEqual([5, 10]);
    expect(c.faturamentoCentavos).toEqual([50000, 100000]);
    expect(c.receitaPorParticipanteCentavos).toEqual([1000, 1000]);
    expect(c.tempoMedioSeg).toEqual([300, 610]);
    // B converte 5% contra 4% de A
    expect(c.melhor).toBe(1);
  });

  it("sem acesso à sala: receita por participante 0 (nunca divide por zero)", async () => {
    const { montarComparacaoAb } = await import("@/src/lib/regras/teste-ab");
    const c = montarComparacaoAb([linha({ cadastros: 3, faturamentoCentavos: 900 }), linha({ ordem: 1, webinarId: B })]);
    expect(c.receitaPorParticipanteCentavos).toEqual([0, 0]);
  });

  it("sem cadastros, ou empate na maior taxa: sem destaque", async () => {
    const { montarComparacaoAb } = await import("@/src/lib/regras/teste-ab");
    expect(montarComparacaoAb([linha({}), linha({ ordem: 1, webinarId: B })]).melhor).toBeNull();
    expect(montarComparacaoAb([linha({ cadastros: 10 }), linha({ ordem: 1, webinarId: B, cadastros: 5 })]).melhor).toBeNull();
    expect(montarComparacaoAb([linha({ cadastros: 10, comprou: 1 }), linha({ ordem: 1, webinarId: B, cadastros: 20, comprou: 2 })]).melhor).toBeNull();
    // variação sem cadastros não ganha; a outra com venda ganha
    expect(montarComparacaoAb([linha({}), linha({ ordem: 1, webinarId: B, cadastros: 20, comprou: 2 })]).melhor).toBe(1);
  });

  it("entrada vazia ou malformada: listas vazias", async () => {
    const { montarComparacaoAb } = await import("@/src/lib/regras/teste-ab");
    expect(montarComparacaoAb(null).variacoes).toEqual([]);
    expect(montarComparacaoAb(undefined).melhor).toBeNull();
  });
});
