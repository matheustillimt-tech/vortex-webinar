import { ehFusoValido, localParaUtc } from "./fuso";
import { montarFunil, percentual } from "./metricas";
import { validarSlug } from "./slug";

// Teste A/B: 2 a 4 webinars num link só (`/t/<slug>`), tráfego dividido por percentual.

export const MAX_NOME_TESTE_AB = 120;
export const MIN_VARIACOES = 2;
export const MAX_VARIACOES = 4;
/** Letra de cada variação pela ordem (0..3); cores fixas nas métricas: A verde, B azul, C amarelo, D rosa. */
export const LETRAS_VARIACAO = ["A", "B", "C", "D"] as const;

export type VariacaoAb = { webinarId: string; percentual: number };

export type EntradaTesteAb = {
  nome?: string | null;
  slug?: string | null;
  /** `YYYY-MM-DDTHH:mm` no `fuso` (formulário) ou Date/ISO com fuso (banco). */
  inicio?: string | Date | null;
  fim?: string | Date | null;
  fuso?: string | null;
  /** Na ordem A, B, C, D. Ausente com `temParticipantes` = mantém as atuais. */
  variacoes?: { webinar_id?: string | null; percentual?: string | number | null }[] | null;
};

export type ContextoTesteAb = {
  /** Slugs já usados por outros testes e por webinars (sem o do próprio teste, na edição). */
  slugsOcupados?: Iterable<string>;
  /** Ids dos webinars ativos (não arquivados). */
  webinarsAtivos?: Iterable<string>;
  /** Edição de teste que já tem sessões gravadas: variações travadas. */
  temParticipantes?: boolean;
  variacoesAtuais?: VariacaoAb[] | null;
};

export type DadosTesteAb = {
  nome: string;
  slug: string;
  inicio: Date;
  fim: Date;
  fuso: string;
  variacoes: VariacaoAb[];
};

const ISO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

function instante(v: string | Date | null | undefined, fuso: string): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = (v ?? "").trim();
  if (ISO_COM_FUSO.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return localParaUtc(s, fuso);
}

function percentualInteiro(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  const s = (v ?? "").trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

function mesmasVariacoes(a: VariacaoAb[], b: VariacaoAb[]): boolean {
  return a.length === b.length && a.every((v, i) => v.webinarId === b[i].webinarId && v.percentual === b[i].percentual);
}

function validarVariacoes(
  entrada: NonNullable<EntradaTesteAb["variacoes"]>,
  ativos: Set<string> | null,
): { erro: string } | { variacoes: VariacaoAb[] } {
  if (entrada.length < MIN_VARIACOES || entrada.length > MAX_VARIACOES) return { erro: "Escolha de 2 a 4 webinars." };
  const variacoes: VariacaoAb[] = [];
  for (const [i, v] of entrada.entries()) {
    const letra = LETRAS_VARIACAO[i];
    const webinarId = (v.webinar_id ?? "").trim();
    if (!webinarId) return { erro: `Escolha o webinar da variação ${letra}.` };
    if (variacoes.some((x) => x.webinarId === webinarId)) return { erro: "Cada variação precisa ser um webinar diferente." };
    if (ativos && !ativos.has(webinarId)) return { erro: `O webinar da variação ${letra} não está ativo.` };
    const percentual = percentualInteiro(v.percentual);
    if (percentual === null || percentual < 1 || percentual > 100) {
      return { erro: `O percentual da variação ${letra} precisa ser um número inteiro de 1 a 100.` };
    }
    variacoes.push({ webinarId, percentual });
  }
  const soma = variacoes.reduce((t, v) => t + v.percentual, 0);
  if (soma < 100) return { erro: `Os percentuais precisam somar 100% (faltam ${100 - soma}%).` };
  if (soma > 100) return { erro: `Os percentuais precisam somar 100% (sobram ${soma - 100}%).` };
  return { variacoes };
}

/** Criação e edição do teste A/B. Unicidade do slug (entre testes e contra webinars) e webinars ativos vêm no
 *  `ctx` (a action consulta o banco). Com `temParticipantes`, as variações não podem mudar: ausentes → mantém as
 *  atuais; iguais às atuais → ok (sem conferir se ainda estão ativas); diferentes → erro. */
export function validarTesteAb(e: EntradaTesteAb, ctx: ContextoTesteAb = {}): { erro: string } | { dados: DadosTesteAb } {
  const nome = (e.nome ?? "").trim();
  if (!nome) return { erro: "Informe o nome do teste." };
  if (nome.length > MAX_NOME_TESTE_AB) return { erro: `Use até ${MAX_NOME_TESTE_AB} caracteres no nome.` };

  const slug = (e.slug ?? "").trim();
  const erroSlug = validarSlug(slug);
  if (erroSlug) return { erro: erroSlug };
  if (new Set(ctx.slugsOcupados ?? []).has(slug)) return { erro: "Este link já está em uso." };

  const fuso = (e.fuso ?? "").trim();
  if (!fuso || !ehFusoValido(fuso)) return { erro: "Escolha um fuso válido." };
  const inicio = instante(e.inicio, fuso);
  const fim = instante(e.fim, fuso);
  if (!inicio || !fim) return { erro: "Informe o início e o fim do teste." };
  if (fim.getTime() < inicio.getTime()) return { erro: "O fim não pode vir antes do início." };

  let variacoes: VariacaoAb[];
  const travado = !!ctx.temParticipantes && !!ctx.variacoesAtuais;
  if (travado && !e.variacoes) {
    variacoes = ctx.variacoesAtuais!;
  } else {
    const r = validarVariacoes(e.variacoes ?? [], travado || !ctx.webinarsAtivos ? null : new Set(ctx.webinarsAtivos));
    if (travado && ("erro" in r || !mesmasVariacoes(r.variacoes, ctx.variacoesAtuais!))) {
      return { erro: "Este teste já tem participantes; as variações não podem mudar." };
    }
    if ("erro" in r) return r;
    variacoes = r.variacoes;
  }

  return { dados: { nome, slug, inicio, fim, fuso, variacoes } };
}

/** Escolhe a variação por faixas acumuladas de percentual: com A 50, B 30, C 20, `aleatorio` em [0, .5) → A,
 *  [.5, .8) → B, [.8, 1) → C. `aleatorio` é o número sorteado em 0..1 (a rota passa `Math.random()` ou um valor de
 *  `crypto`; aqui fica testável); fora da faixa é limitado. Percentual ≤ 0 não entra; se a soma não for 100, as
 *  faixas são proporcionais. Sem variação válida → null. */
export function sortearVariacao<T extends { percentual: number }>(variacoes: readonly T[], aleatorio: number): T | null {
  const validas = variacoes.filter((v) => Number.isFinite(v.percentual) && v.percentual > 0);
  if (validas.length === 0) return null;
  const total = validas.reduce((t, v) => t + v.percentual, 0);
  const x = Number.isFinite(aleatorio) ? Math.min(Math.max(aleatorio, 0), 1) : 0;
  const alvo = x * total;
  let acumulado = 0;
  for (const v of validas) {
    acumulado += v.percentual;
    if (alvo < acumulado) return v;
  }
  return validas[validas.length - 1];
}

/** O link do teste está valendo agora: não arquivado e `inicio ≤ agora ≤ fim` (bordas incluídas). */
export function dentroDoPeriodo(teste: { inicio: Date; fim: Date; arquivado?: boolean }, agora: Date): boolean {
  if (teste.arquivado) return false;
  const t = agora.getTime();
  return t >= teste.inicio.getTime() && t <= teste.fim.getTime();
}

// Entrada `/t/<slug>` ------------------------------------------------------------------------------------------------

/** Validade dos cookies do A/B (escolha e marcação): a pessoa cai sempre na mesma variação por 30 dias. */
export const DIAS_COOKIE_AB = 30;

/** Cookie da escolha, por teste: `{ t, w, exp }` assinado (propósito `ab.`). */
export function nomeCookieAb(testeId: string): string {
  return `vw_ab_${testeId}`;
}

/** Cookie de marcação, por webinar: a criação de sessão desse webinar lê e grava `teste_ab_id`. */
export function nomeCookieAbWebinar(webinarId: string): string {
  return `vw_abw_${webinarId}`;
}

/** Variação da pessoa: a do cookie, se ainda for uma variação ativa do teste; senão, uma sorteada pelo percentual
 *  (`aleatorio` em 0..1, ou uma função chamada só quando precisa sortear). `sorteada` diz se precisa gravar o
 *  cookie de novo. Sem variação → null. */
export function escolherVariacaoAb<T extends { webinarId: string; percentual: number }>(
  variacoes: readonly T[],
  webinarDoCookie: string | null,
  aleatorio: number | (() => number),
): { variacao: T; sorteada: boolean } | null {
  const doCookie = webinarDoCookie ? variacoes.find((v) => v.webinarId === webinarDoCookie) : undefined;
  if (doCookie) return { variacao: doCookie, sorteada: false };
  const sorteada = sortearVariacao(variacoes, typeof aleatorio === "function" ? aleatorio() : aleatorio);
  return sorteada ? { variacao: sorteada, sorteada: true } : null;
}

// Métricas comparadas ------------------------------------------------------------------------------------------------

/** Cor fixa de cada letra nas métricas: A verde, B azul, C amarelo, D rosa. */
export const CORES_VARIACAO = ["#22c55e", "#3b82f6", "#eab308", "#ec4899"] as const;

/** Uma variação como a função SQL `metricas_teste_ab` devolve. */
export type MetricaVariacaoAb = {
  ordem: number;
  webinarId: string;
  nome: string;
  percentual: number;
  cadastros: number;
  acessouSala: number;
  min15: number;
  pitch: number;
  oferta: number;
  clicouOferta: number;
  comprou: number;
  vendas: number;
  faturamentoCentavos: number;
  tempoMedioSeg: number;
};

export type ComparacaoAb = {
  variacoes: { letra: string; cor: string; nome: string; webinarId: string; trafego: number; conversao: number }[];
  /** Etapas do funil (mesmas do webinar); `valores[i]` é a variação `i`, com % sobre os cadastros dela. */
  funil: { etapa: string; rotulo: string; valores: { numero: number; percentual: number }[] }[];
  vendas: number[];
  faturamentoCentavos: number[];
  /** Faturamento ÷ quem acessou a sala (centavos, arredondado); 0 sem acesso. */
  receitaPorParticipanteCentavos: number[];
  tempoMedioSeg: number[];
  /** Índice da variação com a maior taxa comprou/cadastros; null sem cadastros ou com empate na maior taxa. */
  melhor: number | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** Monta a tabela comparativa das métricas do teste (ordem A, B, C, D). */
export function montarComparacaoAb(linhas: readonly MetricaVariacaoAb[] | null | undefined): ComparacaoAb {
  const vs = [...(Array.isArray(linhas) ? linhas : [])].sort((a, b) => num(a.ordem) - num(b.ordem)).slice(0, MAX_VARIACOES);
  const funis = vs.map((v) =>
    montarFunil(num(v.cadastros), {
      acessou_sala: num(v.acessouSala),
      min_15: num(v.min15),
      pitch: num(v.pitch),
      oferta: num(v.oferta),
      clicou_oferta: num(v.clicouOferta),
      comprou: num(v.comprou),
    }),
  );
  const etapas = montarFunil(0, {});
  const conversoes = vs.map((v) => (num(v.cadastros) > 0 ? num(v.comprou) / num(v.cadastros) : 0));

  let melhor: number | null = null;
  if (vs.some((v) => num(v.cadastros) > 0)) {
    const maior = Math.max(...conversoes);
    const comMaior = conversoes.filter((c) => c === maior).length;
    if (maior > 0 && comMaior === 1) melhor = conversoes.indexOf(maior);
  }

  return {
    variacoes: vs.map((v, i) => ({
      letra: LETRAS_VARIACAO[i],
      cor: CORES_VARIACAO[i],
      nome: String(v.nome ?? ""),
      webinarId: String(v.webinarId ?? ""),
      trafego: num(v.percentual),
      conversao: percentual(num(v.comprou), num(v.cadastros)),
    })),
    funil: etapas.map((e, k) => ({
      etapa: e.etapa,
      rotulo: e.rotulo,
      valores: funis.map((f) => ({ numero: f[k].numero, percentual: f[k].percentual })),
    })),
    vendas: vs.map((v) => num(v.vendas)),
    faturamentoCentavos: vs.map((v) => num(v.faturamentoCentavos)),
    receitaPorParticipanteCentavos: vs.map((v) => (num(v.acessouSala) > 0 ? Math.round(num(v.faturamentoCentavos) / num(v.acessouSala)) : 0)),
    tempoMedioSeg: vs.map((v) => num(v.tempoMedioSeg)),
    melhor,
  };
}
