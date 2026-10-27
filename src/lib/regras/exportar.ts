import { DateTime } from "luxon";

/** Fuso fixo das exportações (mesma regra das telas de métricas): sempre Brasília, mesmo
 *  que o webinar use outro fuso na agenda. */
export const FUSO_EXPORTACAO = "America/Sao_Paulo";

/** Os 17 tipos válidos de `eventos.tipo` (check constraint da tabela) — usado pra validar o `?eventos=a,b` da
 *  exportação "momento" sem inventar um tipo que o banco nunca grava. */
export const TIPOS_EVENTO = [
  "visitou_login",
  "acessou_sala",
  "sem_login",
  "fez_login",
  "link_magico",
  "login_provisorio",
  "clicou_video",
  "mensagem_chat",
  "mensagem_atendente",
  "min_15",
  "min_30",
  "min_45",
  "min_60",
  "pitch",
  "oferta",
  "clicou_oferta",
  "comprou",
] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export function tipoEventoValido(v: string): v is TipoEvento {
  return (TIPOS_EVENTO as readonly string[]).includes(v);
}

/** Lê `?eventos=a,b` (separados por vírgula) da exportação "momento": até 2 tipos, todos válidos. `[]` quando o
 *  parâmetro não veio; `null` quando veio algo inválido (vazio depois de limpar, mais de 2, ou tipo desconhecido —
 *  quem chama devolve 400 nesse caso). */
export function eventosDoParametro(valor: string | null): TipoEvento[] | null {
  if (valor === null) return [];
  const tipos = valor
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tipos.length === 0) return [];
  if (tipos.length > 2) return null;
  if (!tipos.every(tipoEventoValido)) return null;
  return tipos as TipoEvento[];
}

/** Instante UTC (ISO) → `dd/MM/yyyy HH:mm` no fuso de Brasília. */
export function formatarDataHora(iso: string): string {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(FUSO_EXPORTACAO).toFormat("dd/MM/yyyy HH:mm");
}

/** Segundos (inteiro, >= 0) → `h:mm:ss`, sempre com 2 dígitos em cada parte. */
export function tempoAssistido(segundos: number | null | undefined): string {
  const s = Math.max(0, segundos ?? 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(h)}:${dois(m)}:${dois(seg)}`;
}

/** `<tipo>-<slug>-<AAAA-MM-DD>.xlsx`, data de hoje no fuso de Brasília. */
export function nomeArquivoExportacao(tipo: string, slug: string, agora: Date): string {
  const data = DateTime.fromJSDate(agora, { zone: FUSO_EXPORTACAO }).toFormat("yyyy-MM-dd");
  return `${tipo}-${slug}-${data}.xlsx`;
}

/** Primeiro caractere que faz Excel/Sheets ler a célula como fórmula ao abrir o .xlsx (injeção de fórmula):
 *  `=`, `+`, `-`, `@`, tab e retorno de carro. */
const CARACTERES_FORMULA = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Protege um valor de texto controlado por participante/comprador (nome, mensagem, cidade, e-mail, UTM…) contra
 *  injeção de fórmula: se começar com um caractere que o Excel/Sheets interpretaria como início de fórmula,
 *  prefixa com `'` (apóstrofo) — o programa de planilha então mostra o texto literal em vez de executá-lo.
 *  Nunca aplicar em números/datas/valores que o próprio sistema gera (não vêm de entrada de terceiros). */
export function protegerFormula(valor: string): string {
  if (valor.length > 0 && CARACTERES_FORMULA.has(valor[0])) return `'${valor}`;
  return valor;
}

const MODO_ROTULO: Record<string, string> = { ao_vivo: "Ao vivo", replay: "Replay" };

export type SessaoExport = {
  nome: string;
  email: string | null;
  telefoneE164: string | null;
  entrouEm: string;
  modo: string;
  maxSegundo: number | null;
  pais: string | null;
  cidade: string | null;
  dispositivo: string | null;
  utms: Record<string, string> | null;
  /** Tipos dos eventos que esta sessão já tem (sem repetir — a tabela `eventos` já garante `unique (sessao_id, tipo)`). */
  eventos: string[];
};

export const CABECALHO_PARTICIPANTES = [
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
];

function linhaParticipante(s: SessaoExport): unknown[] {
  const utms = s.utms ?? {};
  return [
    protegerFormula(s.nome),
    protegerFormula(s.email ?? ""),
    s.telefoneE164 ?? "",
    formatarDataHora(s.entrouEm),
    MODO_ROTULO[s.modo] ?? s.modo,
    tempoAssistido(s.maxSegundo),
    s.pais ?? "",
    protegerFormula(s.cidade ?? ""),
    s.dispositivo ?? "",
    protegerFormula(utms.utm_source ?? ""),
    protegerFormula(utms.utm_medium ?? ""),
    protegerFormula(utms.utm_campaign ?? ""),
    protegerFormula(utms.utm_content ?? ""),
    protegerFormula(utms.utm_term ?? ""),
    s.eventos.join(", "),
    s.eventos.includes("comprou") ? "Sim" : "Não",
  ];
}

/** Exportação "participantes": uma linha por sessão (nunca em modo `teste` — quem monta a lista já filtrou). */
export function participantesParaLinhas(lista: SessaoExport[]): unknown[][] {
  return [CABECALHO_PARTICIPANTES, ...lista.map(linhaParticipante)];
}

/** Exportação "momento": mesmas colunas de `participantesParaLinhas`, só de quem tem TODOS os `tiposPedidos`
 *  (até 2, já validados por `eventosDoParametro` antes de chegar aqui). */
export function momentoParaLinhas(lista: SessaoExport[], tiposPedidos: string[]): unknown[][] {
  const filtrados = lista.filter((s) => tiposPedidos.every((t) => s.eventos.includes(t)));
  return [CABECALHO_PARTICIPANTES, ...filtrados.map(linhaParticipante)];
}

export type AutorMensagem = "participante" | "atendente" | "chatbot" | "ia";

export type MensagemExport = {
  participanteNome: string;
  participanteEmail: string | null;
  criadaEm: string;
  autor: AutorMensagem;
  /** Nome de quem atendeu (`usuarios.nome` via `autor_id`) — só preenchido quando `autor === "atendente"`. */
  autorNome: string | null;
  texto: string | null;
  imagemUrl: string | null;
  apagada: boolean;
};

const AUTOR_ROTULO: Record<AutorMensagem, string> = {
  participante: "Participante",
  atendente: "Atendente",
  chatbot: "Chatbot",
  ia: "IA",
};

function rotuloAutor(m: MensagemExport): string {
  if (m.autor === "atendente") return `Atendente ${m.autorNome ?? ""}`.trim();
  return AUTOR_ROTULO[m.autor];
}

export const CABECALHO_CONVERSAS = ["Participante", "E-mail", "Data", "Autor", "Mensagem", "Imagem"];

/** Exportação "conversas": mensagem apagada vira `"[apagada]"` (o texto original
 *  nunca sai daqui). */
export function conversasParaLinhas(lista: MensagemExport[]): unknown[][] {
  const linhas: unknown[][] = [CABECALHO_CONVERSAS];
  for (const m of lista) {
    linhas.push([
      protegerFormula(m.participanteNome),
      protegerFormula(m.participanteEmail ?? ""),
      formatarDataHora(m.criadaEm),
      rotuloAutor(m),
      protegerFormula(m.apagada ? "[apagada]" : m.texto ?? ""),
      m.imagemUrl ?? "",
    ]);
  }
  return linhas;
}

export type VendaExport = {
  criadaEm: string;
  plataforma: string;
  idTransacao: string;
  valorCentavos: number;
  compradorEmail: string | null;
  sessaoId: string | null;
};

export const CABECALHO_VENDAS_EXPORT = ["Data", "Plataforma", "Transação", "Valor", "Comprador", "Casada com sessão"];

/** Coluna (1-based, idêntico ao `numFmt` do ExcelJS) da coluna "Valor" na exportação de vendas — usada pra pedir o
 *  formato de moeda em `gerarXlsx` ("Valor" é número de verdade, não texto já formatado). */
export const COLUNA_VALOR_VENDAS_EXPORT = CABECALHO_VENDAS_EXPORT.indexOf("Valor") + 1;
export const FORMATO_VALOR_VENDAS_EXPORT = "R$ #,##0.00";

/** Centavos (inteiro) → reais em número (1234.56), pra célula numérica com `numFmt` de moeda — nunca texto
 *  pré-formatado (a coluna "Valor" precisa somar/filtrar como número no Excel). */
function centavosParaReais(centavos: number): number {
  return Math.round(centavos) / 100;
}

/** Exportação "vendas": "casada com sessão" = tem `sessao_id` (a venda foi ligada a quem assistiu). */
export function vendasExportParaLinhas(lista: VendaExport[]): unknown[][] {
  const linhas: unknown[][] = [CABECALHO_VENDAS_EXPORT];
  for (const v of lista) {
    linhas.push([
      formatarDataHora(v.criadaEm),
      v.plataforma,
      v.idTransacao,
      centavosParaReais(v.valorCentavos),
      protegerFormula(v.compradorEmail ?? ""),
      v.sessaoId ? "Sim" : "Não",
    ]);
  }
  return linhas;
}
