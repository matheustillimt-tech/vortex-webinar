import "server-only";
import { DateTime } from "luxon";
import { carregarConversa, listarConversas } from "../../atendimento";
import { estadoSala, agendaDeLinha, type LinhaAgenda } from "../../regras/agenda";
import {
  conversaDaLinha,
  previaUltimaMensagem,
  validarRespostaAtendente,
  type AutorMensagem,
  type Conversa,
  type LinhaConversaSql,
  type StatusAtendimento,
} from "../../regras/atendimento";
import { ehFusoValido, formatarSessao } from "../../regras/fuso";
import { posicaoVideo } from "../../regras/relogio";
import { formatarDuracao } from "../../regras/video";
import { dbAdmin } from "../../supabase/admin";
import { lerTudo } from "../../supabase/paginar";
import type { ChaveAutenticada } from "../auth";
import { ALTERA, APAGA, auditar, CRIA, ehUuid, erro, inteiro, linkPainel, SO_LEITURA, texto, UUID, WEBINAR, type Ferramenta } from "../comum";

/** Sala de atendimento (chat da sala: conversa privada participante ↔ atendente/chatbot/IA, tabela
 *  `mensagens_suporte`) e o painel Ao vivo. As escritas fazem exatamente o que as actions de
 *  `app/(painel)/atendimento/[webinarId]/actions.ts` fazem (mesmos filtros atômicos, mesmas mensagens de erro),
 *  agindo como o atendente dono da chave (`chave.usuarioId`). */

const FUSO_BR = "America/Sao_Paulo";
const JANELA_ONLINE_MS = 60_000;
/** Sessão de teste (link do produtor) nunca entra em métrica nem em "quem está na sala". */
const MODOS_REAIS = ["ao_vivo", "replay"];
/** Teto de linhas da função `conversas_atendimento` numa chamada (o PostgREST corta em 1000). */
const LIMITE_CONVERSAS_SQL = 1000;
const STATUS: StatusAtendimento[] = ["aguardando", "atendendo", "atendido", "dispensado"];

const SEM_DONO = "Esta chave não tem um usuário dono ativo: não dá para agir como atendente.";
const OUTRO_ATENDENTE = "Outro atendente já assumiu esta conversa.";
const NAO_ENCONTRADA = "Conversa não encontrada.";

/** Instante em ISO no horário de Brasília (o que a equipe lê). */
function quando(d: Date | string | null): string | null {
  if (!d) return null;
  return DateTime.fromJSDate(typeof d === "string" ? new Date(d) : d, { zone: FUSO_BR }).toISO({ suppressMilliseconds: true });
}

function linkSeguro(caminho: string): string | null {
  try {
    return linkPainel(caminho);
  } catch {
    return null;
  }
}

/** `de`/`ate` (AAAA-MM-DD, Brasília) → intervalo [desde, ate). Sem nenhum dos dois: `null` (sem filtro). */
function periodo(args: Record<string, unknown>): { desde: Date | null; ate: Date | null } | { erro: string } | null {
  const ler = (v: unknown, fim: boolean): Date | null | "invalida" => {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "invalida";
    const d = DateTime.fromISO(v, { zone: FUSO_BR });
    if (!d.isValid) return "invalida";
    return (fim ? d.plus({ days: 1 }) : d).startOf("day").toJSDate();
  };
  const desde = ler(args.de, false);
  const ate = ler(args.ate, true);
  if (desde === "invalida" || ate === "invalida") return { erro: "Use datas no formato AAAA-MM-DD." };
  if (!desde && !ate) return null;
  if (desde && ate && desde >= ate) return { erro: "A data inicial é depois da final." };
  return { desde, ate };
}

type LinhaWebinar = { id: string; nome: string; slug: string; tipo_agenda: "unica" | "recorrente" | "jit"; sincronizar_video: boolean; status: string };

async function lerWebinar(webinarId: unknown): Promise<LinhaWebinar | { erro: string }> {
  if (!ehUuid(webinarId)) return { erro: "Informe o webinar_id (uuid)." };
  const { data, error } = await dbAdmin()
    .from("webinars")
    .select("id, nome, slug, tipo_agenda, sincronizar_video, status")
    .eq("id", webinarId)
    .maybeSingle();
  if (error) return { erro: "Não deu para carregar o webinar." };
  if (!data) return { erro: "Webinar não encontrado." };
  return data as LinhaWebinar;
}

/** Duração do vídeo do webinar em segundos (0 = desconhecida / sem vídeo). */
async function duracaoDoVideo(webinarId: string): Promise<number> {
  const { data } = await dbAdmin().from("webinar_video").select("videos(duracao_seg)").eq("webinar_id", webinarId).maybeSingle();
  return (data as { videos: { duracao_seg: number | null } | null } | null)?.videos?.duracao_seg ?? 0;
}

/** Minuto do vídeo, no formato do painel ("12:34") + segundos. */
const minuto = (seg: number | null) => (seg === null ? null : { segundo: seg, minuto: formatarDuracao(seg) });

/** Sessão (pra as escritas): confere o id, o webinar (quando informado) e traz o nome do participante. */
type SessaoAlvo = { id: string; webinar_id: string; atendente_id: string | null; status_atendimento: StatusAtendimento; nome: string };
async function lerSessao(args: Record<string, unknown>): Promise<SessaoAlvo | { erro: string }> {
  if (!ehUuid(args.sessao_id)) return { erro: "Informe o sessao_id (uuid) da conversa (veja listar_conversas)." };
  if (args.webinar_id !== undefined && !ehUuid(args.webinar_id)) return { erro: "webinar_id inválido." };
  const { data, error } = await dbAdmin()
    .from("sessoes")
    .select("id, webinar_id, atendente_id, status_atendimento, participantes(nome)")
    .eq("id", args.sessao_id)
    .maybeSingle();
  if (error) return { erro: "Não deu para carregar a conversa." };
  const s = data as (Omit<SessaoAlvo, "nome"> & { participantes: { nome: string | null } | null }) | null;
  if (!s || (args.webinar_id !== undefined && s.webinar_id !== args.webinar_id)) return { erro: NAO_ENCONTRADA };
  return { id: s.id, webinar_id: s.webinar_id, atendente_id: s.atendente_id, status_atendimento: s.status_atendimento, nome: s.participantes?.nome ?? "Sem nome" };
}

function conversaResumo(c: Conversa) {
  return {
    sessaoId: c.sessaoId,
    nome: c.nome,
    email: c.email,
    telefone: c.telefoneE164,
    online: c.online,
    status: c.status,
    atendente: c.nomeAtendente,
    naoRespondidas: c.naoLidas,
    ultimaMensagem: c.ultimaMensagem
      ? { autor: c.ultimaMensagem.autor, previa: previaUltimaMensagem(c.ultimaMensagem), em: quando(c.ultimaMensagem.criadaEm) }
      : null,
  };
}

// Leitura ---------------------------------------------------------------------------------------------------------

type LinhaOnline = {
  id: string;
  modo: "ao_vivo" | "replay";
  inicio_sessao: string;
  jit_horario: string | null;
  posicao_replay_seg: number | null;
  dispositivo: string | null;
  cidade: string | null;
  pais: string | null;
  status_atendimento: StatusAtendimento;
  participantes: { nome: string | null } | null;
};

const aoVivoAgora: Ferramenta = {
  name: "ao_vivo_agora",
  title: "Quem está na sala agora",
  description:
    "Mostra a sala do webinar AGORA, com a mesma regra do painel Ao vivo (online = sinal de presença nos últimos 60 s; " +
    "sessão de teste não conta): quantos estão ao vivo e no replay (e desktop × celular), a lista de quem está na sala com " +
    "o minuto do vídeo em que cada um está, as conversas da sala de atendimento aguardando resposta e se a transmissão está " +
    "acontecendo agora (sessão, horário, minuto do vídeo no ao vivo sincronizado; no just in time, os horários com gente).",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      limite: { type: "integer", minimum: 1, maximum: 500, description: "Quantas pessoas listar (as com sinal mais recente). Padrão 50. Os totais sempre contam todo mundo." },
    },
    required: ["webinar_id"],
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if ("erro" in w) return erro(w.erro);
    const limite = inteiro(args.limite, 50, 1, 500);
    const db = dbAdmin();
    const agora = new Date();
    const desde = new Date(agora.getTime() - JANELA_ONLINE_MS).toISOString();

    const [agendaR, duracaoSeg, metricasR, onlineR] = await Promise.all([
      db.from("agendas").select("*").eq("webinar_id", w.id).maybeSingle(),
      duracaoDoVideo(w.id),
      db.rpc("metricas_ao_vivo", { p_webinar: w.id }),
      db
        .from("sessoes")
        .select("id, modo, inicio_sessao, jit_horario, posicao_replay_seg, dispositivo, cidade, pais, status_atendimento, participantes(nome)")
        .eq("webinar_id", w.id)
        .in("modo", MODOS_REAIS)
        .gte("ultimo_sinal_em", desde)
        .order("ultimo_sinal_em", { ascending: false })
        .limit(limite),
    ]);
    if (agendaR.error || metricasR.error || onlineR.error) return erro("Não deu para carregar a sala agora.");
    let conversas: Conversa[];
    try {
      conversas = await listarConversas(db, w.id, agora);
    } catch {
      return erro("Não deu para carregar as conversas do atendimento.");
    }

    const m = ((metricasR.data ?? []) as { ao_vivo: number; replay: number; desktop: number; mobile: number }[])[0] ?? { ao_vivo: 0, replay: 0, desktop: 0, mobile: 0 };
    const linhas = (onlineR.data ?? []) as unknown as LinhaOnline[];
    const pessoas = linhas.map((s) => {
      const seg =
        s.modo === "ao_vivo" ? posicaoVideo(new Date(s.inicio_sessao), agora, duracaoSeg).segundo : s.posicao_replay_seg ?? null;
      return {
        sessaoId: s.id,
        nome: s.participantes?.nome ?? "Sem nome",
        modo: s.modo,
        ...minuto(seg),
        dispositivo: s.dispositivo,
        local: [s.cidade, s.pais].filter(Boolean).join(", ") || null,
        statusAtendimento: s.status_atendimento,
      };
    });

    const linhaAgenda = agendaR.data as (LinhaAgenda & { fuso: string }) | null;
    const fuso = linhaAgenda?.fuso && ehFusoValido(linhaAgenda.fuso) ? linhaAgenda.fuso : FUSO_BR;
    let transmissao: Record<string, unknown>;
    if (w.tipo_agenda === "jit") {
      // Just in time: cada inscrito tem o próprio horário; "acontecendo" = alguém assistindo ao vivo agora.
      const porHorario = new Map<string, number>();
      for (const s of linhas) if (s.modo === "ao_vivo" && s.jit_horario) porHorario.set(s.jit_horario, (porHorario.get(s.jit_horario) ?? 0) + 1);
      transmissao = {
        tipo: "jit",
        fuso: FUSO_BR,
        acontecendoAgora: m.ao_vivo > 0,
        horariosComGente: [...porHorario.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([h, pessoasNoHorario]) => ({ inicio: quando(h), horario: formatarSessao(new Date(h), FUSO_BR), pessoas: pessoasNoHorario, ...minuto(posicaoVideo(new Date(h), agora, duracaoSeg).segundo) })),
      };
    } else if (!linhaAgenda) {
      transmissao = { tipo: w.tipo_agenda, acontecendoAgora: false, aviso: "Webinar sem agenda configurada." };
    } else {
      const e = estadoSala(agendaDeLinha(linhaAgenda), agora);
      const pos = e.janela ? posicaoVideo(e.janela.inicio, agora, duracaoSeg) : null;
      transmissao = {
        tipo: w.tipo_agenda,
        estado: e.estado, // espera = próxima sessão; aberta = acontecendo; encerrada = sem sessões futuras
        acontecendoAgora: e.estado === "aberta",
        sessao: e.janela ? { inicio: quando(e.janela.inicio), fim: quando(e.janela.fim), horario: formatarSessao(e.janela.inicio, fuso), fuso } : null,
        videoSincronizado: w.sincronizar_video,
        ...(e.estado === "aberta" && w.sincronizar_video && pos ? { videoTerminou: pos.estado === "fim", ...minuto(pos.segundo) } : {}),
      };
    }

    const aguardando = conversas.filter((c) => c.naoLidas > 0 && c.status !== "atendido" && c.status !== "dispensado");
    return texto({
      webinar: { id: w.id, nome: w.nome, slug: w.slug, status: w.status },
      agora: quando(agora),
      transmissao,
      duracaoVideo: duracaoSeg > 0 ? formatarDuracao(duracaoSeg) : null,
      online: { aoVivo: m.ao_vivo, replay: m.replay, total: m.ao_vivo + m.replay, desktop: m.desktop, celular: m.mobile },
      pessoas,
      ...(m.ao_vivo + m.replay > pessoas.length ? { aviso: `Listando ${pessoas.length} de ${m.ao_vivo + m.replay} (aumente "limite").` } : {}),
      atendimento: {
        aguardandoResposta: aguardando.length,
        conversas: aguardando.slice(0, 20).map(conversaResumo),
        salaDeAtendimento: linkSeguro(`/atendimento/${w.id}`),
      },
    });
  },
};

const listarConversasF: Ferramenta = {
  name: "listar_conversas",
  title: "Listar conversas do atendimento",
  description:
    "Conversas da sala de atendimento (perguntas no chat da sala) de um webinar, mais recentes primeiro (pela última mensagem): nome e " +
    "contato do participante, se está online, status (aguardando/atendendo/atendido/dispensado), atendente, quantas mensagens " +
    "do participante ainda não foram respondidas por um atendente (chatbot e IA não contam como resposta), a última mensagem e " +
    "quem respondeu por último (atendente/chatbot/ia). Use o sessaoId em ver_conversa e responder_participante.",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      status: { type: "string", enum: STATUS, description: "Só conversas neste status." },
      sem_resposta: { type: "boolean", description: "true = só conversas com mensagem do participante ainda não respondida por um atendente." },
      de: { type: "string", description: "Última mensagem a partir desta data AAAA-MM-DD (Brasília). Sem de/até: todas." },
      ate: { type: "string", description: "Última mensagem até esta data AAAA-MM-DD, inclusive (Brasília)." },
      limite: { type: "integer", minimum: 1, maximum: 300, description: "Máximo de conversas devolvidas. Padrão 50." },
    },
    required: ["webinar_id"],
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if ("erro" in w) return erro(w.erro);
    if (args.status !== undefined && !STATUS.includes(args.status as StatusAtendimento)) return erro(`status deve ser um de: ${STATUS.join(", ")}.`);
    const p = periodo(args);
    if (p && "erro" in p) return erro(p.erro);
    const limite = inteiro(args.limite, 50, 1, 300);
    const db = dbAdmin();
    const agora = new Date();

    const { data, error } = await db.rpc("conversas_atendimento", { p_webinar: w.id, p_limite: LIMITE_CONVERSAS_SQL });
    if (error) return erro("Não deu para carregar as conversas.");
    const todas = ((data ?? []) as LinhaConversaSql[]).map((l) => conversaDaLinha(l, agora));
    const filtradas = todas.filter((c) => {
      if (args.status && c.status !== args.status) return false;
      if (args.sem_resposta === true && c.naoLidas === 0) return false;
      const em = c.ultimaMensagem?.criadaEm.getTime() ?? 0;
      if (p?.desde && em < p.desde.getTime()) return false;
      if (p?.ate && em >= p.ate.getTime()) return false;
      return true;
    });
    const pagina = filtradas.slice(0, limite);

    // Quem respondeu por último (atendente/chatbot/IA) em cada conversa da página.
    const ultimaResposta = new Map<string, { autor: AutorMensagem; nome: string | null; em: string | null }>();
    if (pagina.length > 0) {
      const r = await lerTudo(() =>
        db
          .from("mensagens_suporte")
          .select("id, sessao_id, autor, created_at, usuarios(nome)")
          .in("sessao_id", pagina.map((c) => c.sessaoId))
          .neq("autor", "participante")
          .order("created_at", { ascending: false })
          .order("id", { ascending: true }),
      );
      if (r.error) return erro("Não deu para carregar as conversas.");
      for (const m of r.data as unknown as { sessao_id: string; autor: AutorMensagem; created_at: string; usuarios: { nome: string } | null }[]) {
        if (!ultimaResposta.has(m.sessao_id)) {
          ultimaResposta.set(m.sessao_id, { autor: m.autor, nome: m.autor === "atendente" ? m.usuarios?.nome ?? null : null, em: quando(m.created_at) });
        }
      }
    }

    return texto({
      webinar: { id: w.id, nome: w.nome },
      total: filtradas.length,
      ...(filtradas.length > pagina.length ? { aviso: `Mostrando ${pagina.length} de ${filtradas.length} (aumente "limite" ou filtre).` } : {}),
      ...(todas.length >= LIMITE_CONVERSAS_SQL ? { avisoHistorico: `Só as ${LIMITE_CONVERSAS_SQL} conversas mais recentes entram na busca.` } : {}),
      conversas: pagina.map((c) => ({ ...conversaResumo(c), ultimaResposta: ultimaResposta.get(c.sessaoId) ?? null })),
    });
  },
};

const verConversa: Ferramenta = {
  name: "ver_conversa",
  title: "Ver conversa do atendimento",
  description:
    "Todas as mensagens de uma conversa da sala de atendimento (uma sessão), em ordem: autor (participante/atendente/chatbot/ia " +
    "e o nome do atendente ou do agente de IA), texto, imagem, editada/apagada (apagada vem sem conteúdo), horário e o minuto do " +
    "vídeo em que foi escrita (só no ao vivo, pelo relógio da sala; no replay o minuto não fica guardado). Traz também o " +
    "participante, o modo (ao_vivo/replay/teste), se está online, o status e o atendente.",
  inputSchema: {
    type: "object",
    properties: {
      sessao_id: { ...UUID, description: "Id da sessão/conversa (sessaoId de listar_conversas ou ao_vivo_agora)." },
      webinar_id: { ...WEBINAR, description: "Opcional: confere que a conversa é deste webinar." },
    },
    required: ["sessao_id"],
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(chave, args) {
    if (!ehUuid(args.sessao_id)) return erro("Informe o sessao_id (uuid) da conversa (veja listar_conversas).");
    if (args.webinar_id !== undefined && !ehUuid(args.webinar_id)) return erro("webinar_id inválido.");
    const db = dbAdmin();
    let r: Awaited<ReturnType<typeof carregarConversa>>;
    try {
      r = await carregarConversa(db, args.sessao_id);
    } catch {
      return erro("Não deu para carregar a conversa.");
    }
    if (!r || (args.webinar_id !== undefined && r.sessao.webinarId !== args.webinar_id)) return erro(NAO_ENCONTRADA);

    const temIa = r.mensagens.some((m) => m.autor === "ia");
    const [extraR, duracaoSeg, agenteR, atendenteR] = await Promise.all([
      db.from("sessoes").select("modo, ultimo_sinal_em, posicao_replay_seg").eq("id", r.sessao.id).maybeSingle(),
      duracaoDoVideo(r.sessao.webinarId),
      temIa ? db.from("agentes_ia").select("nome").eq("webinar_id", r.sessao.webinarId).maybeSingle() : Promise.resolve({ data: null }),
      r.sessao.atendenteId ? db.from("usuarios").select("nome").eq("id", r.sessao.atendenteId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const extra = (extraR.data ?? null) as { modo: "ao_vivo" | "replay" | "teste"; ultimo_sinal_em: string | null; posicao_replay_seg: number | null } | null;
    const nomeIa = (agenteR.data as { nome: string | null } | null)?.nome ?? null;
    const agora = new Date();
    const ultimoSinal = extra?.ultimo_sinal_em ? new Date(extra.ultimo_sinal_em) : null;

    return texto({
      sessaoId: r.sessao.id,
      webinarId: r.sessao.webinarId,
      participante: { nome: r.sessao.nome, email: r.sessao.email, telefone: r.sessao.telefoneE164 },
      modo: extra?.modo ?? null,
      online: !!ultimoSinal && agora.getTime() - ultimoSinal.getTime() <= JANELA_ONLINE_MS,
      videoIniciadoEm: quando(r.sessao.inicioSessao),
      status: r.sessao.status,
      atendente: (atendenteR.data as { nome: string } | null)?.nome ?? null,
      souOAtendente: !!r.sessao.atendenteId && r.sessao.atendenteId === chave.usuarioId,
      mensagens: r.mensagens.map((m) => {
        const seg = extra?.modo === "ao_vivo" ? posicaoVideo(r!.sessao.inicioSessao, new Date(m.criadaEm), duracaoSeg).segundo : null;
        return {
          id: m.id,
          autor: m.autor,
          nome: m.autor === "atendente" ? m.nomeAutor : m.autor === "ia" ? nomeIa : null,
          minha: m.autor === "atendente" && !!chave.usuarioId && m.autorId === chave.usuarioId,
          texto: m.texto,
          imagemUrl: m.imagemUrl,
          editada: m.editada,
          apagada: m.apagada,
          em: quando(m.criadaEm),
          videoNoMinuto: seg === null ? null : formatarDuracao(seg),
        };
      }),
      salaDeAtendimento: linkSeguro(`/atendimento/${r.sessao.webinarId}`),
    });
  },
};

// Escrita ---------------------------------------------------------------------------------------------------------

/** Guarda das escritas: o atendente é quem criou a chave. */
function dono(chave: ChaveAutenticada): string | null {
  return chave.usuarioId;
}

const responderParticipante: Ferramenta = {
  name: "responder_participante",
  title: "Responder participante",
  description:
    "Manda uma mensagem na conversa privada da sala de atendimento, como atendente (na sala sai com o nome do agente de IA do webinar, ex.: “Equipe Sua Empresa”, marcando a pessoa; no painel aparece quem criou a chave), " +
    "idêntico ao painel: assume a conversa se ninguém está atendendo (status vira atendendo) e recusa se outro atendente está " +
    "atendendo. Texto de 1 a 1000 caracteres. ATENÇÃO: a mensagem chega na hora para uma pessoa REAL na sala — antes de chamar, " +
    "mostre o texto exato ao usuário e só envie depois que ele confirmar.",
  inputSchema: {
    type: "object",
    properties: {
      sessao_id: { ...UUID, description: "Id da sessão/conversa (sessaoId de listar_conversas)." },
      webinar_id: { ...WEBINAR, description: "Opcional: confere que a conversa é deste webinar." },
      texto: { type: "string", minLength: 1, maxLength: 1000, description: "Texto da resposta (confirmado com o usuário)." },
    },
    required: ["sessao_id", "texto"],
    additionalProperties: false,
  },
  annotations: { ...CRIA, openWorldHint: true },
  escrita: true,
  async executar(chave, args) {
    const eu = dono(chave);
    if (!eu) return erro(SEM_DONO);
    const textoBruto = typeof args.texto === "string" ? args.texto : "";
    const erroValidacao = validarRespostaAtendente(textoBruto, false);
    if (erroValidacao) return erro(erroValidacao);

    const sessao = await lerSessao(args);
    if ("erro" in sessao) return erro(sessao.erro);
    if (sessao.atendente_id && sessao.atendente_id !== eu && sessao.status_atendimento === "atendendo") {
      return erro("Outro atendente está atendendo esta conversa.");
    }

    const db = dbAdmin();
    const { data: assumida, error: erroAssumir } = await db
      .from("sessoes")
      .update({ atendente_id: eu, status_atendimento: "atendendo" })
      .eq("id", sessao.id)
      .eq("webinar_id", sessao.webinar_id)
      .or(`atendente_id.eq.${eu},atendente_id.is.null,status_atendimento.in.(aguardando,dispensado)`)
      .select("id")
      .maybeSingle();
    if (erroAssumir) return erro("Não deu para enviar a mensagem.");
    if (!assumida) return erro("Outro atendente está atendendo esta conversa.");

    const trim = textoBruto.trim();
    const { data: nova, error: erroInsercao } = await db
      .from("mensagens_suporte")
      .insert({ sessao_id: sessao.id, webinar_id: sessao.webinar_id, autor: "atendente", autor_id: eu, texto: trim, imagem_url: null })
      .select("id, created_at")
      .maybeSingle();
    if (erroInsercao) return erro("Não deu para enviar a mensagem.");

    await auditar(chave, {
      webinarId: sessao.webinar_id,
      acao: "criou",
      descricao: `Respondeu ${sessao.nome} na sala de atendimento`,
      depois: { sessao_id: sessao.id, texto: trim },
    });
    const linha = nova as { id: string; created_at: string } | null;
    return texto({ enviada: true, mensagemId: linha?.id ?? null, em: quando(linha?.created_at ?? null), sessaoId: sessao.id, participante: sessao.nome, status: "atendendo" });
  },
};

type AcaoStatus = "assumir" | "encerrar" | "dispensar";

const mudarStatus: Ferramenta = {
  name: "mudar_status_atendimento",
  title: "Assumir, encerrar ou dispensar conversa",
  description:
    "Muda o status de uma conversa da sala de atendimento, idêntico aos botões do painel, agindo como o dono da chave: " +
    "assumir (vira atendendo com você; só se ninguém atende ou está aguardando/dispensada), encerrar (vira atendido; só quem " +
    "está atendendo pode) ou dispensar (tira da fila, sem atendente; só se ninguém assumiu). Não manda nada pro participante.",
  inputSchema: {
    type: "object",
    properties: {
      sessao_id: { ...UUID, description: "Id da sessão/conversa (sessaoId de listar_conversas)." },
      webinar_id: { ...WEBINAR, description: "Opcional: confere que a conversa é deste webinar." },
      acao: { type: "string", enum: ["assumir", "encerrar", "dispensar"], description: "assumir | encerrar | dispensar." },
    },
    required: ["sessao_id", "acao"],
    additionalProperties: false,
  },
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const eu = dono(chave);
    if (!eu) return erro(SEM_DONO);
    const acao = args.acao as AcaoStatus;
    if (!["assumir", "encerrar", "dispensar"].includes(acao)) return erro("acao deve ser assumir, encerrar ou dispensar.");
    const sessao = await lerSessao(args);
    if ("erro" in sessao) return erro(sessao.erro);

    const db = dbAdmin();
    const base = (valores: Record<string, unknown>) => db.from("sessoes").update(valores).eq("id", sessao.id).eq("webinar_id", sessao.webinar_id);
    const fila = "atendente_id.is.null,status_atendimento.in.(aguardando,dispensado)";
    let r: { data: unknown; error: unknown };
    let falha: string;
    let semLinha: string;
    let novoStatus: StatusAtendimento;
    if (acao === "assumir") {
      r = await base({ atendente_id: eu, status_atendimento: "atendendo" }).or(fila).select("id").maybeSingle();
      [falha, semLinha, novoStatus] = ["Não deu para assumir a conversa.", OUTRO_ATENDENTE, "atendendo"];
    } else if (acao === "dispensar") {
      r = await base({ atendente_id: null, status_atendimento: "dispensado" }).or(fila).select("id").maybeSingle();
      [falha, semLinha, novoStatus] = ["Não deu para dispensar a conversa.", OUTRO_ATENDENTE, "dispensado"];
    } else {
      r = await base({ status_atendimento: "atendido" }).eq("atendente_id", eu).select("id").maybeSingle();
      [falha, semLinha, novoStatus] = ["Não deu para encerrar o atendimento.", "Você não está atendendo esta conversa.", "atendido"];
    }
    if (r.error) return erro(falha);
    if (!r.data) return erro(semLinha);

    const verbo = { assumir: "Assumiu", encerrar: "Encerrou", dispensar: "Dispensou" }[acao];
    await auditar(chave, {
      webinarId: sessao.webinar_id,
      acao: "editou",
      descricao: `${verbo} o atendimento de ${sessao.nome}`,
      antes: { status_atendimento: sessao.status_atendimento },
      depois: { status_atendimento: novoStatus },
    });
    return texto({ ok: true, sessaoId: sessao.id, participante: sessao.nome, status: novoStatus });
  },
};

type LinhaMensagemAlvo = { id: string; webinar_id: string; autor: AutorMensagem; autor_id: string | null; texto: string | null; imagem_url: string | null; apagada: boolean };

/** Mensagem do próprio atendente (o painel só mostra Editar/Apagar nas suas). */
async function lerMinhaMensagem(id: unknown, eu: string, verbo: "editar" | "apagar"): Promise<LinhaMensagemAlvo | { erro: string }> {
  if (!ehUuid(id)) return { erro: "Informe o mensagem_id (uuid) — veja ver_conversa." };
  const { data, error } = await dbAdmin()
    .from("mensagens_suporte")
    .select("id, webinar_id, autor, autor_id, texto, imagem_url, apagada")
    .eq("id", id)
    .maybeSingle();
  if (error) return { erro: `Não deu para ${verbo} a mensagem.` };
  const m = data as LinhaMensagemAlvo | null;
  if (!m) return { erro: "Mensagem não encontrada." };
  if (m.autor !== "atendente" || m.autor_id !== eu) return { erro: `Você só pode ${verbo} as próprias mensagens.` };
  if (m.apagada) return { erro: "Esta mensagem já foi apagada." };
  return m;
}

const editarMensagem: Ferramenta = {
  name: "editar_mensagem_atendimento",
  title: "Editar mensagem do atendimento",
  description:
    "Edita o texto de uma mensagem que VOCÊ (dono da chave) mandou como atendente — idêntico ao painel: nunca mensagem de outro " +
    "atendente, do participante, do chatbot ou da IA; mensagem com imagem ou já apagada não se edita. Texto de 1 a 1000 " +
    "caracteres; a mensagem fica marcada como editada. O participante vê a mudança: confirme o novo texto com o usuário antes.",
  inputSchema: {
    type: "object",
    properties: {
      mensagem_id: { ...UUID, description: "Id da mensagem (de ver_conversa, com minha = true)." },
      texto: { type: "string", minLength: 1, maxLength: 1000, description: "Novo texto." },
    },
    required: ["mensagem_id", "texto"],
    additionalProperties: false,
  },
  annotations: { ...ALTERA, openWorldHint: true },
  escrita: true,
  async executar(chave, args) {
    const eu = dono(chave);
    if (!eu) return erro(SEM_DONO);
    const trim = (typeof args.texto === "string" ? args.texto : "").trim();
    if (trim.length < 1) return erro("Escreva uma mensagem.");
    if (trim.length > 1000) return erro("A mensagem passa de 1000 caracteres.");
    const m = await lerMinhaMensagem(args.mensagem_id, eu, "editar");
    if ("erro" in m) return erro(m.erro);
    if (m.imagem_url) return erro("Mensagem com imagem não pode ser editada (só apagada).");

    const { data, error } = await dbAdmin()
      .from("mensagens_suporte")
      .update({ texto: trim, editada: true })
      .eq("id", m.id)
      .eq("autor", "atendente")
      .eq("autor_id", eu)
      .select("id")
      .maybeSingle();
    if (error) return erro("Não deu para editar a mensagem.");
    if (!data) return erro("Você só pode editar as próprias mensagens.");
    await auditar(chave, { webinarId: m.webinar_id, acao: "editou", descricao: "Editou uma mensagem na sala de atendimento", antes: { texto: m.texto }, depois: { texto: trim } });
    return texto({ ok: true, mensagemId: m.id, texto: trim, editada: true });
  },
};

const apagarMensagem: Ferramenta = {
  name: "apagar_mensagem_atendimento",
  title: "Apagar mensagem do atendimento",
  description:
    "Apaga uma mensagem que VOCÊ (dono da chave) mandou como atendente — idêntico ao painel: o participante passa a ver " +
    "\"Mensagem apagada\" (o conteúdo continua guardado no banco para auditoria). Nunca apaga mensagem de outro atendente, do " +
    "participante, do chatbot ou da IA. Confirme com o usuário antes.",
  inputSchema: {
    type: "object",
    properties: { mensagem_id: { ...UUID, description: "Id da mensagem (de ver_conversa, com minha = true)." } },
    required: ["mensagem_id"],
    additionalProperties: false,
  },
  annotations: { ...APAGA, openWorldHint: true },
  escrita: true,
  async executar(chave, args) {
    const eu = dono(chave);
    if (!eu) return erro(SEM_DONO);
    const m = await lerMinhaMensagem(args.mensagem_id, eu, "apagar");
    if ("erro" in m) return erro(m.erro);

    const { data, error } = await dbAdmin()
      .from("mensagens_suporte")
      .update({ apagada: true })
      .eq("id", m.id)
      .eq("autor", "atendente")
      .eq("autor_id", eu)
      .select("id")
      .maybeSingle();
    if (error) return erro("Não deu para apagar a mensagem.");
    if (!data) return erro("Você só pode apagar as próprias mensagens.");
    await auditar(chave, { webinarId: m.webinar_id, acao: "excluiu", descricao: "Apagou uma mensagem na sala de atendimento", antes: { texto: m.texto } });
    return texto({ ok: true, mensagemId: m.id, apagada: true });
  },
};

export const FERRAMENTAS_ATENDIMENTO: Ferramenta[] = [
  aoVivoAgora,
  listarConversasF,
  verConversa,
  responderParticipante,
  mudarStatus,
  editarMensagem,
  apagarMensagem,
];
