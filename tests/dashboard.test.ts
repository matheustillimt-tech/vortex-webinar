import { describe, expect, it } from "vitest";
import {
  ordenarPorFaturamento,
  proximasSessoesGerais,
  receitaPorParticipante,
  type LinhaWebinarDashboard,
  type WebinarComAgenda,
} from "@/src/lib/regras/dashboard";
import type { Agenda } from "@/src/lib/regras/agenda";

const AGORA = new Date("2026-10-21T12:00:00.000Z"); // quarta-feira, meio-dia em Brasília

function agendaUnica(inicioIso: string, fimIso: string): Agenda {
  return {
    fuso: "America/Sao_Paulo",
    inicio: new Date(inicioIso),
    fim: new Date(fimIso),
    repeticao: "nenhuma",
    diaSemana: null,
    horaInicio: null,
    horaFim: null,
    vigenciaFim: null,
  };
}

function agendaDiaria(horaInicio: string, horaFim: string): Agenda {
  return {
    fuso: "America/Sao_Paulo",
    inicio: null,
    fim: null,
    repeticao: "diaria",
    diaSemana: null,
    horaInicio: horaInicio,
    horaFim: horaFim,
    vigenciaFim: null,
  };
}

describe("proximasSessoesGerais", () => {
  it("junta as próximas sessões de vários webinars, em ordem de início", () => {
    const webinars: WebinarComAgenda[] = [
      { id: "w1", nome: "Webinar 1", slug: "w1", agenda: agendaUnica("2026-10-25T18:00:00.000Z", "2026-10-25T20:00:00.000Z") },
      { id: "w2", nome: "Webinar 2", slug: "w2", agenda: agendaUnica("2026-10-23T18:00:00.000Z", "2026-10-23T20:00:00.000Z") },
    ];

    const r = proximasSessoesGerais(webinars, AGORA, 10);

    expect(r).toHaveLength(2);
    expect(r[0].webinarId).toBe("w2"); // mais cedo primeiro
    expect(r[1].webinarId).toBe("w1");
  });

  it("corta no total de n, mesmo com vários webinars recorrentes", () => {
    const webinars: WebinarComAgenda[] = [
      { id: "w1", nome: "Webinar 1", slug: "w1", agenda: agendaDiaria("20:00", "21:00") },
      { id: "w2", nome: "Webinar 2", slug: "w2", agenda: agendaDiaria("20:00", "21:00") },
    ];

    const r = proximasSessoesGerais(webinars, AGORA, 3);

    expect(r).toHaveLength(3);
    // Ordenado por início: cada data tem 2 sessões (uma de cada webinar).
    expect(r[0].janela.inicio.getTime()).toBeLessThanOrEqual(r[1].janela.inicio.getTime());
    expect(r[1].janela.inicio.getTime()).toBeLessThanOrEqual(r[2].janela.inicio.getTime());
  });

  it("sem webinars ativos com agenda: lista vazia", () => {
    expect(proximasSessoesGerais([], AGORA, 10)).toEqual([]);
  });
});

describe("ordenarPorFaturamento", () => {
  const LINHAS: LinhaWebinarDashboard[] = [
    { id: "a", nome: "A", cadastros: 10, acessos: 8, vendas: 1, faturamentoCentavos: 5000 },
    { id: "b", nome: "B", cadastros: 20, acessos: 15, vendas: 3, faturamentoCentavos: 29400 },
    { id: "c", nome: "C", cadastros: 5, acessos: 2, vendas: 0, faturamentoCentavos: 0 },
  ];

  it("ordena do maior faturamento pro menor", () => {
    const r = ordenarPorFaturamento(LINHAS);
    expect(r.map((w) => w.id)).toEqual(["b", "a", "c"]);
  });

  it("não altera a lista original", () => {
    const original = [...LINHAS];
    ordenarPorFaturamento(LINHAS);
    expect(LINHAS).toEqual(original);
  });
});

describe("receitaPorParticipante", () => {
  it("divide o faturamento pelos acessos", () => {
    expect(receitaPorParticipante(29400, 2)).toBe(14700);
  });

  it("arredonda o resultado", () => {
    expect(receitaPorParticipante(100, 3)).toBe(33);
  });

  it("sem acessos, devolve 0 (nunca divide por zero)", () => {
    expect(receitaPorParticipante(5000, 0)).toBe(0);
  });
});
