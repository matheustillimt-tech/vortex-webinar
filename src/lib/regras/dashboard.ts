import { proximasSessoes, type Agenda, type Janela } from "./agenda";

export type WebinarComAgenda = { id: string; nome: string; slug: string; agenda: Agenda };
export type ProximaSessaoGeral = { webinarId: string; nome: string; slug: string; janela: Janela };

/** Próximas sessões de TODOS os webinars ativos, juntas numa lista só, em ordem de início (cartão "Próximas
 *  sessões" do dashboard geral). Pede `n` sessões de cada webinar (o bastante pra nunca faltar
 *  sessão na lista final já intercalada e ordenada) e corta nas `n` primeiras do total. */
export function proximasSessoesGerais(webinars: WebinarComAgenda[], agora: Date, n: number): ProximaSessaoGeral[] {
  const todas = webinars.flatMap((w) =>
    proximasSessoes(w.agenda, agora, n).map((janela) => ({ webinarId: w.id, nome: w.nome, slug: w.slug, janela })),
  );
  todas.sort((a, b) => a.janela.inicio.getTime() - b.janela.inicio.getTime());
  return todas.slice(0, n);
}

export type LinhaWebinarDashboard = {
  id: string;
  nome: string;
  cadastros: number;
  acessos: number;
  vendas: number;
  faturamentoCentavos: number;
};

/** `dashboard_geral` devolve `porWebinar` ordenado por nome; a tabela da tela quer ver quem fatura mais primeiro. */
export function ordenarPorFaturamento(linhas: LinhaWebinarDashboard[]): LinhaWebinarDashboard[] {
  return [...linhas].sort((a, b) => b.faturamentoCentavos - a.faturamentoCentavos);
}

/** Receita por participante = faturamento ÷ sessões que acessaram a sala; 0 sem acessos
 *  (nunca divide por zero). Resultado em centavos, arredondado. */
export function receitaPorParticipante(faturamentoCentavos: number, acessos: number): number {
  if (!acessos) return 0;
  return Math.round(faturamentoCentavos / acessos);
}
