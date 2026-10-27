import { mascararEmail, montarFunil, percentual, type EtapaFunil } from "./metricas";
import { receitaPorParticipante } from "./dashboard";

/** Regras puras das ferramentas de análise do MCP (`src/lib/mcp/ferramentas/analise.ts`): retenção, funil com taxas
 *  entre etapas, chat por minuto do vídeo, origem do tráfego e comparação de períodos. Sem banco: recebem as linhas
 *  já lidas e devolvem o resumo pronto. */

/** O que as funções `metricas_webinar`/`dashboard_geral` devolvem (mesmo formato das telas de métricas). */
export type MetricasRpc = {
  cadastros?: number;
  eventos?: Record<string, number>;
  porDia?: { dia: string; aoVivo: number; replay: number }[];
  dispositivos?: { desktop: number; mobile: number };
  paises?: { pais: string; total: number }[];
  retencao?: { minuto: number; visualizacoes: number }[];
  vendas?: { total: number; faturamentoCentavos: number };
  tempoMedioSeg?: number;
};

/** Segundos → `mm:ss` (minutos sem teto: `75:12` numa aula de 1h15). Negativo vira 0. */
export function minutoSegundo(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Centavos → reais em número (1234.56), pra quem lê a resposta poder somar/comparar. */
export const reais = (centavos: number) => Math.round(centavos || 0) / 100;

/** Em que segundo do vídeo a pessoa estava num instante: `instante − inicio_sessao`, nunca negativo. */
export function segundoDoVideo(instante: string, inicioSessao: string | null | undefined): number | null {
  if (!inicioSessao) return null;
  const d = (new Date(instante).getTime() - new Date(inicioSessao).getTime()) / 1000;
  return Number.isFinite(d) ? Math.max(0, Math.floor(d)) : null;
}

export type TaxaEtapa = { de: string; para: string; percentual: number };

/** Taxa de passagem entre etapas vizinhas do funil (ex.: dos que acessaram, quantos % chegaram no pitch). */
export function taxasEntreEtapas(funil: EtapaFunil[]): TaxaEtapa[] {
  const taxas: TaxaEtapa[] = [];
  for (let i = 1; i < funil.length; i++) {
    taxas.push({ de: funil[i - 1].rotulo, para: funil[i].rotulo, percentual: percentual(funil[i].numero, funil[i - 1].numero) });
  }
  return taxas;
}

/** Resumo das métricas de um período a partir da resposta da RPC — o mesmo cálculo das telas (funil sobre os
 *  cadastros, receita por participante = faturamento ÷ quem acessou a sala). */
export function resumirMetricas(m: MetricasRpc) {
  const cadastros = m.cadastros ?? 0;
  const eventos = m.eventos ?? {};
  const funil = montarFunil(cadastros, eventos);
  const acessos = eventos.acessou_sala ?? 0;
  const faturamentoCentavos = m.vendas?.faturamentoCentavos ?? 0;
  const porDia = m.porDia ?? [];
  return {
    cadastros,
    acessaramSala: acessos,
    funil: funil.map(({ etapa, rotulo, numero, percentual: p }) => ({ etapa, rotulo, numero, percentualSobreCadastros: p })),
    taxasEntreEtapas: taxasEntreEtapas(funil),
    eventos,
    vendas: { total: m.vendas?.total ?? 0, faturamentoReais: reais(faturamentoCentavos) },
    receitaPorParticipanteReais: reais(receitaPorParticipante(faturamentoCentavos, acessos)),
    tempoMedioAssistido: minutoSegundo(m.tempoMedioSeg ?? 0),
    tempoMedioSeg: m.tempoMedioSeg ?? 0,
    aoVivoReplay: {
      aoVivo: porDia.reduce((s, d) => s + (d.aoVivo ?? 0), 0),
      replay: porDia.reduce((s, d) => s + (d.replay ?? 0), 0),
      porDia,
    },
    dispositivos: m.dispositivos ?? { desktop: 0, mobile: 0 },
    paises: m.paises ?? [],
  };
}

/** Métricas-chave de um período, pra comparar dois lado a lado. */
export function metricasChave(m: MetricasRpc): Record<string, number> {
  const r = resumirMetricas(m);
  const e = r.eventos;
  return {
    cadastros: r.cadastros,
    acessaram_sala: r.acessaramSala,
    taxa_acesso: percentual(r.acessaramSala, r.cadastros),
    assistiram_15_min: e.min_15 ?? 0,
    chegaram_no_pitch: e.pitch ?? 0,
    viram_a_oferta: e.oferta ?? 0,
    clicaram_na_oferta: e.clicou_oferta ?? 0,
    taxa_clique_sobre_acessos: percentual(e.clicou_oferta ?? 0, r.acessaramSala),
    escreveram_no_chat: e.mensagem_chat ?? 0,
    vendas: r.vendas.total,
    conversao_sobre_acessos: percentual(r.vendas.total, r.acessaramSala),
    faturamento_reais: r.vendas.faturamentoReais,
    receita_por_participante_reais: r.receitaPorParticipanteReais,
    tempo_medio_seg: r.tempoMedioSeg,
  };
}

export type Comparacao = { metrica: string; a: number; b: number; diferenca: number; variacaoPercentual: number | null };

/** Período A × período B, métrica a métrica: diferença (B − A) e variação % sobre A (`null` quando A é 0). */
export function compararMetricas(a: Record<string, number>, b: Record<string, number>): Comparacao[] {
  return Object.keys(a).map((metrica) => {
    const va = a[metrica] ?? 0;
    const vb = b[metrica] ?? 0;
    const diferenca = Math.round((vb - va) * 100) / 100;
    return { metrica, a: va, b: vb, diferenca, variacaoPercentual: va ? Math.round(((vb - va) / va) * 1000) / 10 : null };
  });
}

// Retenção -------------------------------------------------------------------------------------------------------

export type PontoCurva = { minuto: number; pessoas: number; percentual: number };

/** Curva por minuto (tabela `retencao`, já somada por minuto): preenche os minutos sem linha com 0, do minuto 1 ao
 *  último, e põe o % sobre `base` (quem acessou a sala). */
export function curvaRetencao(linhas: { minuto: number; visualizacoes: number }[], base: number): PontoCurva[] {
  const porMinuto = new Map<number, number>();
  for (const l of linhas) if (l.minuto >= 1) porMinuto.set(l.minuto, (porMinuto.get(l.minuto) ?? 0) + Number(l.visualizacoes || 0));
  const ultimo = Math.max(0, ...porMinuto.keys());
  const curva: PontoCurva[] = [];
  for (let m = 1; m <= ultimo; m++) {
    const pessoas = porMinuto.get(m) ?? 0;
    curva.push({ minuto: m, pessoas, percentual: percentual(pessoas, base) });
  }
  return curva;
}

/** Minutos-marco: 5, 10, 15, 20, 30, 45, 60 e depois de 15 em 15 até a duração do vídeo (sem duração: até 60). */
export function minutosMarco(duracaoSeg: number): number[] {
  const fim = duracaoSeg > 0 ? Math.ceil(duracaoSeg / 60) : 60;
  const marcos = [5, 10, 15, 20, 30, 45, 60].filter((m) => m <= Math.max(fim, 5));
  for (let m = 75; m <= fim; m += 15) marcos.push(m);
  return marcos;
}

export type Marco = { rotulo: string; segundo: number; pessoas: number; percentual: number };

/** Quantos assistiram até cada marco: sessões (que acessaram a sala) com `max_segundo >= segundo do marco`. */
export function marcosRetencao(maxSegundos: number[], marcos: { rotulo: string; segundo: number }[], base: number): Marco[] {
  return marcos.map(({ rotulo, segundo }) => {
    const pessoas = maxSegundos.filter((s) => s >= segundo).length;
    return { rotulo, segundo, pessoas, percentual: percentual(pessoas, base) };
  });
}

export type Queda = { minuto: number; momento: string; sairam: number; percentual: number; aindaAssistindo: number };

/** Onde mais gente saiu: agrupa cada sessão no minuto do `max_segundo` (último ponto que viu) e devolve os `n`
 *  minutos com mais saídas. Quem chegou ao último minuto do vídeo (assistiu até o fim) não conta como saída;
 *  quem nunca passou do minuto 0 também não (não chegou a assistir). `aindaAssistindo` = quantos passaram dali. */
export function maioresQuedas(maxSegundos: number[], duracaoSeg: number, base: number, n = 5): Queda[] {
  const ultimoMinuto = duracaoSeg > 0 ? Math.floor(duracaoSeg / 60) : Infinity;
  const saidas = new Map<number, number>();
  for (const s of maxSegundos) {
    const m = Math.floor(s / 60);
    if (m < 1 || m >= ultimoMinuto) continue;
    saidas.set(m, (saidas.get(m) ?? 0) + 1);
  }
  return [...saidas.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, n)
    .map(([minuto, sairam]) => ({
      minuto,
      momento: minutoSegundo(minuto * 60),
      sairam,
      percentual: percentual(sairam, base),
      aindaAssistindo: maxSegundos.filter((s) => s >= (minuto + 1) * 60).length,
    }));
}

// Chat -----------------------------------------------------------------------------------------------------------

/** Faixa de 5 min do vídeo: 0–299 s → "00-05", 300–599 s → "05-10"… */
export function faixaCincoMinutos(segundo: number): string {
  const ini = Math.floor(Math.max(0, segundo) / 300) * 5;
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(ini)}-${dois(ini + 5)}`;
}

/** Resumo do chat: total de mensagens, pessoas distintas e mensagens por faixa de 5 min do vídeo (em ordem). */
export function resumoChat(mensagens: { sessaoId: string; segundoVideo: number | null }[]) {
  const faixas = new Map<string, number>();
  for (const m of mensagens) {
    if (m.segundoVideo === null) continue;
    const f = faixaCincoMinutos(m.segundoVideo);
    faixas.set(f, (faixas.get(f) ?? 0) + 1);
  }
  return {
    totalMensagens: mensagens.length,
    pessoasDistintas: new Set(mensagens.map((m) => m.sessaoId)).size,
    porFaixaDe5Min: [...faixas.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([faixa, mensagens]) => ({ faixa, mensagens })),
  };
}

/** Uma mensagem do participante foi respondida se a mesma sessão tem mensagem de atendente/chatbot/IA depois dela. */
export function foiRespondida(sessaoId: string, criadaEm: string, respostas: Map<string, number[]>): boolean {
  const t = new Date(criadaEm).getTime();
  return (respostas.get(sessaoId) ?? []).some((r) => r > t);
}

/** Linha do formato compacto do `ler_chat`: `mm:ss | texto` (imagem sem texto vira `[imagem]`). */
export function linhaCompacta(segundoVideo: number | null, texto: string | null, temImagem: boolean): string {
  const t = (texto ?? "").replace(/\s+/g, " ").trim() || (temImagem ? "[imagem]" : "");
  return `${segundoVideo === null ? "--:--" : minutoSegundo(segundoVideo)} | ${t}`;
}

/** Escapa `%`, `_` e `\` pra busca com `ilike` (o texto digitado é literal, não padrão). */
export function escaparIlike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Participantes --------------------------------------------------------------------------------------------------

/** E-mail como o painel mostra em lista: mascarado (`an***@dominio`), menos de quem comprou (aí vai inteiro). */
export function emailVisivel(email: string | null | undefined, comprou: boolean): string | null {
  if (!email) return null;
  return comprou ? email : mascararEmail(email);
}

export type FiltrosParticipantes = {
  comprou?: boolean;
  clicouOferta?: boolean;
  naoComprou?: boolean;
  acessouSala?: boolean;
};

/** Aplica os filtros por evento (`comprou`, `clicou_oferta`, `nao_comprou`, `acessou_sala`) numa lista de tipos. */
export function passaFiltrosEventos(eventos: string[], f: FiltrosParticipantes): boolean {
  if (f.comprou && !eventos.includes("comprou")) return false;
  if (f.naoComprou && eventos.includes("comprou")) return false;
  if (f.clicouOferta && !eventos.includes("clicou_oferta")) return false;
  if (f.acessouSala && !eventos.includes("acessou_sala")) return false;
  return true;
}

// Origem do tráfego ----------------------------------------------------------------------------------------------

export const CAMPOS_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type CampoUtm = (typeof CAMPOS_UTM)[number];
export const SEM_UTM = "(sem utm)";

export type LinhaOrigem = {
  origem: string;
  cadastros: number;
  acessaramSala: number;
  clicaramOferta: number;
  vendas: number;
  faturamentoReais: number;
  taxaAcesso: number;
  taxaClique: number;
  conversao: number;
};

const valorUtm = (utms: Record<string, unknown> | null | undefined, campo: CampoUtm): string => {
  const v = utms?.[campo];
  return typeof v === "string" && v.trim() ? v.trim() : SEM_UTM;
};

/** Agrupa cadastros/acessos/cliques (sessões do período) e vendas pelo valor da UTM pedida. A venda vale pra UTM da
 *  sessão casada com ela (`sessao_id`); sem sessão conhecida, pras UTMs que vieram na própria venda. Taxas: acesso
 *  e clique sobre os cadastros; conversão = vendas ÷ acessos. Ordenado por faturamento, depois cadastros. */
export function agruparOrigem(
  sessoes: { id: string; utms: Record<string, unknown> | null; eventos: string[] }[],
  vendas: { sessaoId: string | null; valorCentavos: number; utms: Record<string, unknown> | null }[],
  campo: CampoUtm,
): LinhaOrigem[] {
  type Acc = { cadastros: number; acessos: number; cliques: number; vendas: number; centavos: number };
  const grupos = new Map<string, Acc>();
  const pegar = (k: string) => {
    let g = grupos.get(k);
    if (!g) grupos.set(k, (g = { cadastros: 0, acessos: 0, cliques: 0, vendas: 0, centavos: 0 }));
    return g;
  };
  const origemDaSessao = new Map<string, string>();
  for (const s of sessoes) {
    const k = valorUtm(s.utms, campo);
    origemDaSessao.set(s.id, k);
    const g = pegar(k);
    g.cadastros++;
    if (s.eventos.includes("acessou_sala")) g.acessos++;
    if (s.eventos.includes("clicou_oferta")) g.cliques++;
  }
  for (const v of vendas) {
    const g = pegar((v.sessaoId && origemDaSessao.get(v.sessaoId)) || valorUtm(v.utms, campo));
    g.vendas++;
    g.centavos += v.valorCentavos || 0;
  }
  return [...grupos.entries()]
    .map(([origem, g]) => ({
      origem,
      cadastros: g.cadastros,
      acessaramSala: g.acessos,
      clicaramOferta: g.cliques,
      vendas: g.vendas,
      faturamentoReais: reais(g.centavos),
      taxaAcesso: percentual(g.acessos, g.cadastros),
      taxaClique: percentual(g.cliques, g.cadastros),
      conversao: percentual(g.vendas, g.acessos),
    }))
    .sort((a, b) => b.faturamentoReais - a.faturamentoReais || b.cadastros - a.cadastros || a.origem.localeCompare(b.origem));
}
