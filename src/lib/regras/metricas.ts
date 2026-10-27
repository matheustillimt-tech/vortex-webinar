import { DateTime } from "luxon";

/** Fuso fixo das telas de métricas: tudo aqui é sempre Brasília, mesmo que o webinar use
 *  outro fuso para a agenda. */
const FUSO_METRICAS = "America/Sao_Paulo";
const MAX_DIAS = 366;
const ERRO_PERIODO = "Escolha um período de até 1 ano.";

export type Periodo = { de: Date; ate: Date };
export type ResultadoPeriodo = Periodo | { erro: string };

type LimitesExplicitos = { de: DateTime; ateExclusivo: DateTime } | { erro: string };

/** `de`/`ate` (`YYYY-MM-DD`, texto livre) → início do dia `de` e início do dia seguinte a `ate` (exclusivo),
 *  os dois no fuso de Brasília; exige as duas datas e valida (data inválida, final antes da inicial). Base de
 *  `periodoDe` e `periodoOpcionalDe` — mesma regra de bordas pros dois lugares que filtram por data no painel. */
function limitesExplicitos(deStr: string | null, ateStr: string | null): LimitesExplicitos {
  if (!deStr || !ateStr) return { erro: "Informe as duas datas do período." };
  const de = DateTime.fromISO(deStr, { zone: FUSO_METRICAS }).startOf("day");
  const ate = DateTime.fromISO(ateStr, { zone: FUSO_METRICAS }).startOf("day");
  if (!de.isValid || !ate.isValid) return { erro: "Data inválida." };
  if (ate < de) return { erro: "A data final não pode vir antes da inicial." };
  return { de, ateExclusivo: ate.plus({ days: 1 }) };
}

/** Lê `de`/`ate` (`YYYY-MM-DD`) dos parâmetros da URL; sem os dois, usa o padrão: últimos 7 dias (`"7d"`) ou o mês
 *  corrente (`"mes"`), sempre no fuso de Brasília. `ate` devolvido é exclusivo (começo do dia seguinte ao digitado),
 *  pronto para passar como limite superior `< ate` nas funções SQL. */
export function periodoDe(sp: URLSearchParams, padrao: "7d" | "mes", agora: Date = new Date()): ResultadoPeriodo {
  const deStr = sp.get("de");
  const ateStr = sp.get("ate");
  const agoraZ = DateTime.fromJSDate(agora, { zone: FUSO_METRICAS });

  let de: DateTime;
  let ateExclusivo: DateTime;

  if (deStr || ateStr) {
    const r = limitesExplicitos(deStr, ateStr);
    if ("erro" in r) return r;
    de = r.de;
    ateExclusivo = r.ateExclusivo;
  } else if (padrao === "mes") {
    de = agoraZ.startOf("month");
    ateExclusivo = agoraZ.startOf("day").plus({ days: 1 });
  } else {
    de = agoraZ.startOf("day").minus({ days: 6 });
    ateExclusivo = agoraZ.startOf("day").plus({ days: 1 });
  }

  if (ateExclusivo.diff(de, "days").days > MAX_DIAS) return { erro: ERRO_PERIODO };
  return { de: de.toJSDate(), ate: ateExclusivo.toJSDate() };
}

export type PeriodoOpcional = { de?: Date; ate?: Date };
export type ResultadoPeriodoOpcional = PeriodoOpcional | { erro: string };

/** Como `periodoDe`, mas pro histórico: sem `de` nem `ate` não tem filtro de data nenhum (não cai num período
 *  padrão) — só com pelo menos uma das duas datas digitadas é que vale a mesma regra de bordas (as duas
 *  obrigatórias, fuso de Brasília, `ate` exclusivo, até 1 ano). */
export function periodoOpcionalDe(deStr: string, ateStr: string): ResultadoPeriodoOpcional {
  if (!deStr && !ateStr) return {};
  const r = limitesExplicitos(deStr || null, ateStr || null);
  if ("erro" in r) return r;
  if (r.ateExclusivo.diff(r.de, "days").days > MAX_DIAS) return { erro: ERRO_PERIODO };
  return { de: r.de.toJSDate(), ate: r.ateExclusivo.toJSDate() };
}

/** Uma etapa do funil do webinar. */
export type EtapaFunil = { etapa: string; rotulo: string; numero: number; percentual: number };

const ETAPAS_FUNIL: { etapa: string; rotulo: string }[] = [
  { etapa: "cadastros", rotulo: "Cadastros" },
  { etapa: "acessou_sala", rotulo: "Acessou a sala" },
  { etapa: "min_15", rotulo: "Assistiu 15 min" },
  { etapa: "pitch", rotulo: "Chegou no pitch" },
  { etapa: "oferta", rotulo: "Viu a oferta" },
  { etapa: "clicou_oferta", rotulo: "Clicou na oferta" },
  { etapa: "comprou", rotulo: "Comprou" },
];

/** Monta o funil do webinar: `cadastros` é o total de sessões e as demais etapas vêm da contagem de eventos; cada
 *  etapa leva o número absoluto e o percentual sobre a primeira etapa (cadastros). */
export function montarFunil(cadastros: number, eventos: Record<string, number>): EtapaFunil[] {
  return ETAPAS_FUNIL.map(({ etapa, rotulo }) => {
    const numero = etapa === "cadastros" ? cadastros : (eventos[etapa] ?? 0);
    return { etapa, rotulo, numero, percentual: percentual(numero, cadastros) };
  });
}

/** `a` sobre `b` em percentual (0 a 100, 1 casa decimal); 0 quando `b` é 0 (nunca divide por zero). */
export function percentual(a: number, b: number): number {
  if (!b) return 0;
  return Math.round((a / b) * 1000) / 10;
}

const FORMATADOR_REAIS = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos (inteiro) → "R$ 1.234,56". */
export function formatarReais(centavos: number): string {
  return FORMATADOR_REAIS.format(centavos / 100);
}

/** `ana.silva@exemplo.com` → `an***@exemplo.com` (mantém as 2 primeiras letras do usuário e o domínio inteiro,
 *  troca o resto por `***`); usado nas telas que mostram listas sem expor o e-mail completo de quem não comprou,
 *  e no log de checkout (Configurações) — única implementação de máscara de e-mail do painel. */
export function mascararEmail(email: string): string {
  const [usuario, dominio] = email.split("@");
  if (!dominio) return email;
  const visivel = usuario.slice(0, 2);
  return `${visivel}***@${dominio}`;
}

/** Segundos (>= 0) → `m:ss` (menos de 1h) ou `h:mm:ss` (1h ou mais); usado no "Tempo médio assistido" das telas
 *  de métricas/dashboard em vez de minutos arredondados. */
export function formatarTempoMedio(segundos: number): string {
  const s = Math.max(0, Math.round(segundos || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(seg)}` : `${m}:${dois(seg)}`;
}
