import { DateTime } from "luxon";

export type AutorMensagem = "participante" | "atendente" | "chatbot" | "ia";
export type StatusAtendimento = "aguardando" | "atendendo" | "atendido" | "dispensado";

const SESSENTA_SEGUNDOS_MS = 60_000;

/** Online = recebeu um sinal de presença (`sinal`) nos últimos 60 s. */
export function estaOnline(ultimoSinal: Date | null, agora: Date): boolean {
  if (!ultimoSinal) return false;
  return agora.getTime() - ultimoSinal.getTime() <= SESSENTA_SEGUNDOS_MS;
}

/** Em qual coluna do painel de atendimento a conversa aparece: `humano` = alguém da equipe pegou o atendimento
 *  (`atendendo`, com atendente) e a IA fica calada; `ia` = o resto (a IA responde sozinha). */
export function coluna(conversa: { atendenteId: string | null; status: StatusAtendimento }): "ia" | "humano" {
  return conversa.atendenteId && conversa.status === "atendendo" ? "humano" : "ia";
}

/** Mensagem do atendente: texto (trim) de 1 a 1000 caracteres, ou uma imagem — pelo menos um dos dois. */
export function validarRespostaAtendente(texto: string, temImagem: boolean): string | null {
  const trim = texto.trim();
  if (trim.length < 1 && !temImagem) return "Escreva uma mensagem ou envie uma imagem.";
  if (trim.length > 1000) return "A mensagem passa de 1000 caracteres.";
  return null;
}

/** Série do dia em blocos de `minutos` min, de `inicioDia` até `agora` (padrão: agora mesmo) — conta quantas
 *  `entradas` caem em cada bucket. Entradas fora de [inicioDia, agora) não contam. */
export function bucketsAcessos(entradas: Date[], inicioDia: Date, minutos: number, agora: Date = new Date()): { inicio: Date; total: number }[] {
  const passoMs = minutos * 60_000;
  const buckets: { inicio: Date; total: number }[] = [];
  for (let t = inicioDia.getTime(); t < agora.getTime(); t += passoMs) {
    buckets.push({ inicio: new Date(t), total: 0 });
  }
  for (const entrada of entradas) {
    const ms = entrada.getTime();
    if (ms < inicioDia.getTime() || ms >= agora.getTime()) continue;
    const indice = Math.floor((ms - inicioDia.getTime()) / passoMs);
    if (indice >= 0 && indice < buckets.length) buckets[indice].total += 1;
  }
  return buckets;
}

/** Uma linha de `public.conversas_atendimento(...)` (supabase/migrations/20261020200000_realtime_atendimento.sql),
 *  como o PostgREST devolve (datas em texto ISO). */
export type LinhaConversaSql = {
  sessao_id: string;
  participante_nome: string | null;
  participante_email: string | null;
  participante_telefone: string | null;
  inicio_sessao: string;
  ultimo_sinal_em: string | null;
  status_atendimento: StatusAtendimento;
  atendente_id: string | null;
  atendente_nome: string | null;
  ultima_texto: string | null;
  ultima_imagem: boolean;
  ultima_autor: AutorMensagem;
  ultima_em: string;
  ultima_apagada: boolean;
  nao_lidas: number;
};

export type UltimaMensagem = { texto: string | null; temImagem: boolean; apagada: boolean; autor: AutorMensagem; criadaEm: Date };

export type Conversa = {
  sessaoId: string;
  nome: string;
  email: string | null;
  telefoneE164: string | null;
  inicioSessao: Date;
  online: boolean;
  status: StatusAtendimento;
  atendenteId: string | null;
  nomeAtendente: string | null;
  ultimaMensagem: UltimaMensagem | null;
  naoLidas: number;
};

/** Linha da função SQL → conversa do painel (pura). A agregação (última mensagem, não lidas, ordem, limite) já
 *  vem pronta do banco; aqui só converte datas, calcula o online e garante que mensagem apagada nunca leva
 *  conteúdo, mesmo que a linha traga. */
export function conversaDaLinha(l: LinhaConversaSql, agora: Date): Conversa {
  const ultimoSinal = l.ultimo_sinal_em ? new Date(l.ultimo_sinal_em) : null;
  return {
    sessaoId: l.sessao_id,
    nome: l.participante_nome ?? "Sem nome",
    email: l.participante_email,
    telefoneE164: l.participante_telefone,
    inicioSessao: new Date(l.inicio_sessao),
    online: estaOnline(ultimoSinal, agora),
    status: l.status_atendimento,
    atendenteId: l.atendente_id,
    nomeAtendente: l.atendente_nome,
    ultimaMensagem: {
      texto: l.ultima_apagada ? null : l.ultima_texto,
      temImagem: !l.ultima_apagada && l.ultima_imagem,
      apagada: l.ultima_apagada,
      autor: l.ultima_autor,
      criadaEm: new Date(l.ultima_em),
    },
    naoLidas: l.nao_lidas,
  };
}

/** Texto da prévia na lista de conversas. */
export function previaUltimaMensagem(u: Pick<UltimaMensagem, "texto" | "temImagem" | "apagada"> | null): string {
  if (!u) return "Sem mensagens";
  if (u.apagada) return "Mensagem apagada";
  if (u.texto) return u.texto;
  return u.temImagem ? "Imagem" : "";
}

/** Turma do atendimento = dia em Brasília de quando a pessoa entrou, com a virada às 06:00 (quem entra na turma
 *  das 19h depois da meia-noite continua na turma daquele dia). `YYYY-MM-DD`. Espelho de
 *  `public.turma_atendimento` (supabase/migrations/20261027090000_atendimento_turmas.sql). */
export function turmaDe(instante: Date): string {
  return DateTime.fromJSDate(instante, { zone: "America/Sao_Paulo" }).minus({ hours: 6 }).toISODate() ?? "";
}

/** `YYYY-MM-DD` válido (parâmetro de turma vindo da URL). */
export function turmaValida(turma: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(turma) && DateTime.fromISO(turma).isValid;
}

/** Dia anterior de uma turma (`YYYY-MM-DD`): a opção "Ontem" do filtro de data. */
export function diaAnterior(turma: string): string {
  return DateTime.fromISO(turma).minus({ days: 1 }).toISODate() ?? "";
}

/** Quanto do vídeo a pessoa já assistiu, em % inteiro (0–100), pela maior posição alcançada (`max_segundo`).
 *  Sem duração do vídeo: `null`. */
export function percentualAssistido(maxSegundo: number | null, duracaoSeg: number | null): number | null {
  if (!duracaoSeg || duracaoSeg <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(((maxSegundo ?? 0) / duracaoSeg) * 100)));
}

function semAcento(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Busca de contato na sala de atendimento: pelo nome (sem acento e sem maiúscula/minúscula) ou por um pedaço do
 *  telefone (3+ dígitos, ignora espaço, parêntese e traço). Termo vazio: devolve tudo. */
export function filtrarConversas<T extends { nome: string; telefoneE164: string | null; email?: string | null }>(conversas: T[], termo: string): T[] {
  const t = semAcento(termo.trim());
  if (!t) return conversas;
  const digitos = t.replace(/\D/g, "");
  return conversas.filter(
    (c) =>
      semAcento(c.nome).includes(t) ||
      (!!c.email && semAcento(c.email).includes(t)) ||
      (digitos.length >= 3 && (c.telefoneE164 ?? "").replace(/\D/g, "").includes(digitos)),
  );
}
