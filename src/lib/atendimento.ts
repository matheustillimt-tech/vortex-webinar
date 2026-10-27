import "server-only";
import { conversaDaLinha, percentualAssistido, type Conversa, type LinhaConversaSql } from "@/src/lib/regras/atendimento";
import type { SupabaseClient } from "@supabase/supabase-js";

const LIMITE_CONVERSAS = 300;

/** Conversas do webinar (sessões com pelo menos uma mensagem do participante), as 300 mais recentes primeiro (pela
 *  última mensagem) — uma chamada só ao banco, que já agrega última mensagem e não lidas. Com `turma`
 *  (`YYYY-MM-DD`, ver `turmaDe`), só as daquela turma (`public.conversas_atendimento_turma`); sem, todas
 *  (`public.conversas_atendimento`). Usa `db` como foi passado (o cliente do membro: as funções são `security
 *  invoker`, então a RLS vale). Erro do banco: lança (quem chama responde 500). */
export async function listarConversas(db: SupabaseClient, webinarId: string, agora: Date = new Date(), turma?: string): Promise<Conversa[]> {
  const { data, error } = turma
    ? await db.rpc("conversas_atendimento_turma", { p_webinar: webinarId, p_turma: turma, p_limite: LIMITE_CONVERSAS })
    : await db.rpc("conversas_atendimento", { p_webinar: webinarId, p_limite: LIMITE_CONVERSAS });
  if (error) throw new Error(`conversas_atendimento: ${error.message}`);
  return ((data ?? []) as LinhaConversaSql[]).map((l) => conversaDaLinha(l, agora));
}

export type Turma = { turma: string; conversas: number };

/** Turmas que tiveram conversa, mais recente primeiro (seletor de histórico da sala de atendimento). Erro: lança. */
export async function listarTurmas(db: SupabaseClient, webinarId: string): Promise<Turma[]> {
  const { data, error } = await db.rpc("turmas_atendimento", { p_webinar: webinarId });
  if (error) throw new Error(`turmas_atendimento: ${error.message}`);
  return (data ?? []) as Turma[];
}

/** % do vídeo que cada pessoa já assistiu (maior posição ÷ duração do vídeo do webinar), por sessão — a barrinha da
 *  lista de conversas. Chamar com o cliente admin depois de conferir o membro (`webinar_video` só admin lê pela
 *  RLS). Nunca lança: é um detalhe da tela, qualquer falha só deixa sem %. */
export async function assistidoPorSessao(db: SupabaseClient, webinarId: string, sessaoIds: string[]): Promise<Record<string, number | null>> {
  const resultado: Record<string, number | null> = {};
  if (sessaoIds.length === 0) return resultado;
  try {
    const [{ data: video }, { data: sessoes }] = await Promise.all([
      db.from("webinar_video").select("videos(duracao_seg)").eq("webinar_id", webinarId).maybeSingle(),
      db.from("sessoes").select("id, max_segundo").eq("webinar_id", webinarId).in("id", sessaoIds),
    ]);
    const duracao = (video as { videos: { duracao_seg: number | null } | null } | null)?.videos?.duracao_seg ?? null;
    for (const s of (sessoes ?? []) as { id: string; max_segundo: number | null }[]) {
      resultado[s.id] = percentualAssistido(s.max_segundo, duracao);
    }
  } catch {
    // sem % desta vez
  }
  return resultado;
}

/** Participantes na sala agora (ao vivo + replay, sinal nos últimos 60 s, teste nunca conta) — o mesmo número do
 *  painel Ao vivo (`public.metricas_ao_vivo`), não só quem mandou mensagem. Chamar com o cliente admin depois de
 *  conferir o membro (como o painel faz). Erro do banco: lança. */
export async function contarParticipantesOnline(db: SupabaseClient, webinarId: string): Promise<number> {
  const { data, error } = await db.rpc("metricas_ao_vivo", { p_webinar: webinarId });
  if (error) throw new Error(`metricas_ao_vivo: ${error.message}`);
  const linha = ((data ?? []) as { ao_vivo: number; replay: number }[])[0];
  return (linha?.ao_vivo ?? 0) + (linha?.replay ?? 0);
}

export type MensagemConversa = {
  id: string;
  autor: "participante" | "atendente" | "chatbot" | "ia";
  autorId: string | null;
  texto: string | null;
  imagemUrl: string | null;
  nomeAutor: string | null;
  editada: boolean;
  apagada: boolean;
  criadaEm: string;
};

type LinhaMensagemDetalhe = {
  id: string;
  autor: "participante" | "atendente" | "chatbot" | "ia";
  autor_id: string | null;
  texto: string | null;
  imagem_url: string | null;
  editada: boolean;
  apagada: boolean;
  created_at: string;
  usuarios: { nome: string } | null;
};

export type SessaoConversa = {
  id: string;
  webinarId: string;
  nome: string;
  email: string | null;
  telefoneE164: string | null;
  inicioSessao: Date;
  atendenteId: string | null;
  status: "aguardando" | "atendendo" | "atendido" | "dispensado";
};

/** A sessão (dados de topo da conversa aberta) + suas mensagens (nome de quem respondeu como atendente é o
 *  `usuarios.nome`, igual a sala; mensagem apagada vem sem texto/imagem). `null` se a sessão não existir. Erro do
 *  banco: lança. */
export async function carregarConversa(db: SupabaseClient, sessaoId: string): Promise<{ sessao: SessaoConversa; mensagens: MensagemConversa[] } | null> {
  const { data: sessaoData, error: erroSessao } = await db
    .from("sessoes")
    .select("id, webinar_id, inicio_sessao, atendente_id, status_atendimento, participantes(nome, email, telefone_e164)")
    .eq("id", sessaoId)
    .maybeSingle();
  if (erroSessao) throw new Error(`carregarConversa (sessão): ${erroSessao.message}`);
  if (!sessaoData) return null;
  const s = sessaoData as unknown as {
    id: string;
    webinar_id: string;
    inicio_sessao: string;
    atendente_id: string | null;
    status_atendimento: SessaoConversa["status"];
    participantes: { nome: string; email: string | null; telefone_e164: string | null } | null;
  };

  const { data: mensagensData, error: erroMensagens } = await db
    .from("mensagens_suporte")
    .select("id, autor, autor_id, texto, imagem_url, editada, apagada, created_at, usuarios(nome)")
    .eq("sessao_id", sessaoId)
    .order("created_at", { ascending: true });
  if (erroMensagens) throw new Error(`carregarConversa (mensagens): ${erroMensagens.message}`);
  const mensagens = ((mensagensData ?? []) as unknown as LinhaMensagemDetalhe[]).map((m) => ({
    id: m.id,
    autor: m.autor,
    autorId: m.autor_id,
    texto: m.apagada ? null : m.texto,
    imagemUrl: m.apagada ? null : m.imagem_url,
    nomeAutor: m.autor === "atendente" ? m.usuarios?.nome ?? null : null,
    editada: m.editada,
    apagada: m.apagada,
    criadaEm: m.created_at,
  }));

  return {
    sessao: {
      id: s.id,
      webinarId: s.webinar_id,
      nome: s.participantes?.nome ?? "Sem nome",
      email: s.participantes?.email ?? null,
      telefoneE164: s.participantes?.telefone_e164 ?? null,
      inicioSessao: new Date(s.inicio_sessao),
      atendenteId: s.atendente_id,
      status: s.status_atendimento,
    },
    mensagens,
  };
}
