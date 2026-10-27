import { describe, expect, it } from "vitest";
import { formatarReais, formatarTempoMedio, mascararEmail, montarFunil, percentual, periodoDe } from "@/src/lib/regras/metricas";

// Quarta-feira, meio-dia em Brasília.
const AGORA = new Date("2026-10-21T15:00:00.000Z");

describe("periodoDe", () => {
  it("sem de/ate e padrão 7d: últimos 7 dias terminando hoje, no fuso de Brasília", () => {
    const r = periodoDe(new URLSearchParams(), "7d", AGORA);
    expect("erro" in r).toBe(false);
    const { de, ate } = r as { de: Date; ate: Date };
    expect(de.toISOString()).toBe("2026-10-15T03:00:00.000Z"); // 15/10 00:00 BRT
    expect(ate.toISOString()).toBe("2026-10-22T03:00:00.000Z"); // 22/10 00:00 BRT (exclusivo)
  });

  it("sem de/ate e padrão mes: mês corrente", () => {
    const r = periodoDe(new URLSearchParams(), "mes", AGORA);
    const { de, ate } = r as { de: Date; ate: Date };
    expect(de.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(ate.toISOString()).toBe("2026-10-22T03:00:00.000Z");
  });

  it("com de/ate digitados, usa o período pedido", () => {
    const r = periodoDe(new URLSearchParams({ de: "2026-01-01", ate: "2026-01-10" }), "7d", AGORA);
    const { de, ate } = r as { de: Date; ate: Date };
    expect(de.toISOString()).toBe("2026-01-01T03:00:00.000Z");
    expect(ate.toISOString()).toBe("2026-01-11T03:00:00.000Z");
  });

  it("erro quando só uma data vem preenchida", () => {
    expect(periodoDe(new URLSearchParams({ de: "2026-01-01" }), "7d", AGORA)).toEqual({ erro: "Informe as duas datas do período." });
  });

  it("erro quando ate vem antes de de", () => {
    expect(periodoDe(new URLSearchParams({ de: "2026-01-10", ate: "2026-01-01" }), "7d", AGORA)).toEqual({
      erro: "A data final não pode vir antes da inicial.",
    });
  });

  it("erro quando o período passa de 1 ano", () => {
    expect(periodoDe(new URLSearchParams({ de: "2020-01-01", ate: "2026-01-01" }), "7d", AGORA)).toEqual({
      erro: "Escolha um período de até 1 ano.",
    });
  });

  it("erro quando a data é inválida", () => {
    expect(periodoDe(new URLSearchParams({ de: "banana", ate: "2026-01-01" }), "7d", AGORA)).toEqual({ erro: "Data inválida." });
  });
});

describe("montarFunil", () => {
  it("monta as 7 etapas com número e percentual sobre cadastros", () => {
    const funil = montarFunil(100, { acessou_sala: 80, min_15: 50, pitch: 40, oferta: 30, clicou_oferta: 10, comprou: 5 });
    expect(funil).toEqual([
      { etapa: "cadastros", rotulo: "Cadastros", numero: 100, percentual: 100 },
      { etapa: "acessou_sala", rotulo: "Acessou a sala", numero: 80, percentual: 80 },
      { etapa: "min_15", rotulo: "Assistiu 15 min", numero: 50, percentual: 50 },
      { etapa: "pitch", rotulo: "Chegou no pitch", numero: 40, percentual: 40 },
      { etapa: "oferta", rotulo: "Viu a oferta", numero: 30, percentual: 30 },
      { etapa: "clicou_oferta", rotulo: "Clicou na oferta", numero: 10, percentual: 10 },
      { etapa: "comprou", rotulo: "Comprou", numero: 5, percentual: 5 },
    ]);
  });

  it("etapa sem evento vira 0", () => {
    const funil = montarFunil(10, {});
    expect(funil.find((e) => e.etapa === "comprou")).toEqual({ etapa: "comprou", rotulo: "Comprou", numero: 0, percentual: 0 });
  });

  it("sem cadastros, percentual é 0 (nunca divide por zero)", () => {
    const funil = montarFunil(0, { acessou_sala: 0 });
    expect(funil.every((e) => e.percentual === 0)).toBe(true);
  });
});

describe("percentual", () => {
  it("calcula e arredonda em 1 casa decimal", () => {
    expect(percentual(1, 3)).toBe(33.3);
    expect(percentual(2, 4)).toBe(50);
  });

  it("devolve 0 quando o total é 0", () => {
    expect(percentual(5, 0)).toBe(0);
  });
});

describe("formatarReais", () => {
  it("formata centavos em reais", () => {
    expect(formatarReais(123456)).toBe("R$ 1.234,56");
    expect(formatarReais(0)).toBe("R$ 0,00");
  });
});

describe("formatarTempoMedio", () => {
  it("menos de 1h: m:ss", () => {
    expect(formatarTempoMedio(65)).toBe("1:05");
    expect(formatarTempoMedio(0)).toBe("0:00");
    expect(formatarTempoMedio(599)).toBe("9:59");
  });

  it("1h ou mais: h:mm:ss", () => {
    expect(formatarTempoMedio(3725)).toBe("1:02:05");
    expect(formatarTempoMedio(3600)).toBe("1:00:00");
  });

  it("arredonda e nunca fica negativo", () => {
    expect(formatarTempoMedio(65.6)).toBe("1:06");
    expect(formatarTempoMedio(-5)).toBe("0:00");
  });
});

describe("mascararEmail", () => {
  it("mantém as 2 primeiras letras e o domínio inteiro", () => {
    expect(mascararEmail("ana.silva@exemplo.com")).toBe("an***@exemplo.com");
  });

  it("sem @, devolve como veio", () => {
    expect(mascararEmail("semarroba")).toBe("semarroba");
  });
});
