import "server-only";
import { DateTime } from "luxon";
import { dbAdmin } from "../../supabase/admin";
import { lerTudo, type ConstrutorPaginado } from "../../supabase/paginar";
import { periodoDe, percentual, type Periodo } from "../../regras/metricas";
import { ordenarPorFaturamento, receitaPorParticipante } from "../../regras/dashboard";
import {
  agruparOrigem,
  CAMPOS_UTM,
  compararMetricas,
  curvaRetencao,
  emailVisivel,
  escaparIlike,
  foiRespondida,
  linhaCompacta,
  maioresQuedas,
  marcosRetencao,
  metricasChave,
  minutoSegundo,
  minutosMarco,
  passaFiltrosEventos,
  reais,
  resumirMetricas,
  resumoChat,
  segundoDoVideo,
  type CampoUtm,
  type MetricasRpc,
} from "../../regras/analise-mcp";
import { ehUuid, erro, inteiro, PERIODO, SO_LEITURA, texto, UUID, WEBINAR, type Ferramenta } from "../comum";

/** Ferramentas de análise do webinar (só leitura): métricas e funil, retenção, chat dos participantes (pra montar a
 *  barreira de dores/objeções), participantes, vendas e origem do tráfego. Tudo no horário de Brasília e sem as
 *  sessões em modo `teste` — as mesmas regras das telas de métricas e das exportações. */

const FUSO = "America/Sao_Paulo";
const NAO_CARREGOU = "Não deu para carregar os dados. Tente de novo.";
const WEBINAR_NAO_ENCONTRADO = "Webinar não encontrado.";
/** Quantos ids vão em cada `in(...)` (URL do PostgREST tem limite de tamanho). */
const LOTE_IDS = 100;

const PERIODO_MES = {
  de: { type: "string", description: "Data inicial AAAA-MM-DD (horário de Brasília). Sem de/até: mês corrente." },
  ate: PERIODO.ate,
} as const;

/** `de`/`ate` dos argumentos → período (fim exclusivo) com as mesmas regras das telas (`periodoDe`). */
function periodoDosArgs(de: unknown, ate: unknown, padrao: "7d" | "mes"): Periodo | { erro: string } {
  const sp = new URLSearchParams();
  if (typeof de === "string" && de.trim()) sp.set("de", de.trim());
  if (typeof ate === "string" && ate.trim()) sp.set("ate", ate.trim());
  return periodoDe(sp, padrao);
}

/** Período como a pessoa digitaria (AAAA-MM-DD, `ate` inclusivo) pra devolver junto da resposta. */
function periodoLegivel(p: Periodo) {
  return {
    de: DateTime.fromJSDate(p.de, { zone: FUSO }).toFormat("yyyy-MM-dd"),
    ate: DateTime.fromJSDate(p.ate, { zone: FUSO }).minus({ days: 1 }).toFormat("yyyy-MM-dd"),
    fuso: "Brasília",
  };
}

/** Instante UTC → `dd/MM/yyyy HH:mm` no horário de Brasília. */
const dataHora = (iso: string | null | undefined) => (iso ? DateTime.fromISO(iso, { zone: "utc" }).setZone(FUSO).toFormat("dd/MM/yyyy HH:mm") : null);

async function carregarWebinar(id: unknown): Promise<{ id: string; nome: string } | null> {
  if (!ehUuid(id)) return null;
  const { data } = await dbAdmin().from("webinars").select("id, nome").eq("id", id).maybeSingle();
  return (data as { id: string; nome: string } | null) ?? null;
}

/** `lerTudo` com o tipo da linha já do jeito que a ferramenta usa (o tipo que o supabase-js infere pros embeds é lista). */
const lerTodas = <T>(construir: () => unknown) => lerTudo(construir as ConstrutorPaginado<unknown>) as Promise<{ data: T[]; error: unknown }>;

const lotes = <T>(lista: T[]): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += LOTE_IDS) r.push(lista.slice(i, i + LOTE_IDS));
  return r;
};

const sim = (v: unknown) => v === true || v === "true";

async function rpcMetricas(webinarId: string | null, p: Periodo): Promise<{ m: MetricasRpc & { porWebinar?: LinhaRanking[] }; erro: boolean }> {
  const db = dbAdmin();
  const { data, error } = webinarId
    ? await db.rpc("metricas_webinar", { p_webinar: webinarId, p_de: p.de.toISOString(), p_ate: p.ate.toISOString() })
    : await db.rpc("dashboard_geral", { p_de: p.de.toISOString(), p_ate: p.ate.toISOString() });
  return { m: (data ?? {}) as MetricasRpc, erro: !!error };
}

type LinhaRanking = { id: string; nome: string; cadastros: number; acessos: number; vendas: number; faturamentoCentavos: number };

/** Total de mensagens que os participantes escreveram (sessões fora do modo teste) no período. */
async function contarMensagensParticipantes(webinarId: string, p: Periodo): Promise<number | null> {
  const { count, error } = await dbAdmin()
    .from("mensagens_suporte")
    .select("id, sessoes!inner(modo)", { count: "exact", head: true })
    .eq("webinar_id", webinarId)
    .eq("autor", "participante")
    .neq("sessoes.modo", "teste")
    .gte("created_at", p.de.toISOString())
    .lt("created_at", p.ate.toISOString());
  return error ? null : (count ?? 0);
}

// metricas_webinar ------------------------------------------------------------------------------------------------

const metricasWebinar: Ferramenta = {
  name: "metricas_webinar",
  title: "Métricas do webinar",
  description:
    "Métricas de um webinar no período (igual à tela Métricas): funil do cadastro à compra com % sobre os cadastros e as taxas entre etapas, contagem de todos os eventos (acessou_sala, min_15/30/45/60, pitch, oferta, clicou_oferta, comprou, mensagem_chat…), ao vivo × replay por dia, dispositivos, países, vendas e faturamento (R$), tempo médio assistido, receita por participante (faturamento ÷ quem acessou) e o chat (pessoas que escreveram e total de mensagens). Sem sessões de teste; horário de Brasília.",
  inputSchema: { type: "object", properties: { webinar_id: WEBINAR, ...PERIODO }, required: ["webinar_id"], additionalProperties: false },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const webinar = await carregarWebinar(args.webinar_id);
    if (!webinar) return erro(WEBINAR_NAO_ENCONTRADO);
    const p = periodoDosArgs(args.de, args.ate, "7d");
    if ("erro" in p) return erro(p.erro);

    const [{ m, erro: falhou }, totalMensagens] = await Promise.all([rpcMetricas(webinar.id, p), contarMensagensParticipantes(webinar.id, p)]);
    if (falhou) return erro("Não deu para carregar as métricas. Tente de novo.");
    const r = resumirMetricas(m);
    return texto({
      webinar,
      periodo: periodoLegivel(p),
      ...r,
      chat: { pessoasQueEscreveram: r.eventos.mensagem_chat ?? 0, totalMensagens },
    });
  },
};

// dashboard_geral -------------------------------------------------------------------------------------------------

const dashboardGeral: Ferramenta = {
  name: "dashboard_geral",
  title: "Dashboard geral",
  description:
    "Visão de todos os webinars no período (idêntico ao Dashboard): funil somado, vendas e faturamento (R$), tempo médio, ao vivo × replay, dispositivos, países e o ranking por webinar (cadastros, acessos, vendas, faturamento, receita por participante), do que mais fatura pro que menos. Sem sessões de teste; horário de Brasília.",
  inputSchema: { type: "object", properties: { ...PERIODO_MES }, additionalProperties: false },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const p = periodoDosArgs(args.de, args.ate, "mes");
    if ("erro" in p) return erro(p.erro);
    const { m, erro: falhou } = await rpcMetricas(null, p);
    if (falhou) return erro("Não deu para carregar o dashboard. Tente de novo.");
    const r = resumirMetricas(m);
    const ranking = ordenarPorFaturamento(m.porWebinar ?? []).map((w) => ({
      id: w.id,
      nome: w.nome,
      cadastros: w.cadastros,
      acessaramSala: w.acessos,
      taxaAcesso: percentual(w.acessos, w.cadastros),
      vendas: w.vendas,
      conversaoSobreAcessos: percentual(w.vendas, w.acessos),
      faturamentoReais: reais(w.faturamentoCentavos),
      receitaPorParticipanteReais: reais(receitaPorParticipante(w.faturamentoCentavos, w.acessos)),
    }));
    return texto({ periodo: periodoLegivel(p), ...r, porWebinar: ranking });
  },
};

// analisar_retencao -----------------------------------------------------------------------------------------------

type LinhaSessaoRetencao = { id: string; max_segundo: number | null };

const analisarRetencao: Ferramenta = {
  name: "analisar_retencao",
  title: "Analisar retenção",
  description:
    "Retenção do vídeo do webinar no período: curva por minuto (quantas pessoas estavam assistindo em cada minuto e o % sobre quem acessou a sala), marcos (quantos/% assistiram até 5, 10, 15, 20, 30, 45, 60… min, até o pitch e até a oferta aparecer), as maiores quedas (minutos em que mais gente saiu) e a duração do vídeo. Base: sessões fora do modo teste que acessaram a sala; 'assistiu até X' usa o ponto mais avançado do vídeo que a sessão viu. Horário de Brasília.",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      ...PERIODO,
      quedas: { type: "integer", minimum: 1, maximum: 20, description: "Quantas maiores quedas devolver (padrão 5)." },
      curva: { type: "boolean", description: "Devolver a curva minuto a minuto (padrão true). false deixa a resposta curta." },
    },
    required: ["webinar_id"],
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const webinar = await carregarWebinar(args.webinar_id);
    if (!webinar) return erro(WEBINAR_NAO_ENCONTRADO);
    const p = periodoDosArgs(args.de, args.ate, "7d");
    if ("erro" in p) return erro(p.erro);
    const db = dbAdmin();

    const [{ m, erro: falhouRpc }, sessoes, { data: oferta }, { data: wv }] = await Promise.all([
      rpcMetricas(webinar.id, p),
      lerTodas<LinhaSessaoRetencao>(() =>
        db
          .from("sessoes")
          .select("id, max_segundo, eventos!inner(tipo)")
          .eq("webinar_id", webinar.id)
          .neq("modo", "teste")
          .eq("eventos.tipo", "acessou_sala")
          .gte("entrou_em", p.de.toISOString())
          .lt("entrou_em", p.ate.toISOString())
          .order("id", { ascending: true }),
      ),
      db.from("ofertas").select("ligada, aparece_seg, pitch_seg").eq("webinar_id", webinar.id).maybeSingle(),
      db.from("webinar_video").select("videos(nome, duracao_seg)").eq("webinar_id", webinar.id).maybeSingle(),
    ]);
    if (falhouRpc || sessoes.error) return erro(NAO_CARREGOU);

    const video = (wv as { videos: { nome: string; duracao_seg: number | null } | null } | null)?.videos ?? null;
    const duracaoSeg = video?.duracao_seg ?? 0;
    const maxSegundos = sessoes.data.map((s) => s.max_segundo ?? 0);
    const base = m.eventos?.acessou_sala ?? maxSegundos.length;

    const marcos = minutosMarco(duracaoSeg).map((min) => ({ rotulo: `${min} min`, segundo: min * 60 }));
    const of = oferta as { ligada: boolean; aparece_seg: number; pitch_seg: number | null } | null;
    if (of?.pitch_seg) marcos.push({ rotulo: `Pitch (${minutoSegundo(of.pitch_seg)})`, segundo: of.pitch_seg });
    if (of?.aparece_seg) marcos.push({ rotulo: `Oferta aparece (${minutoSegundo(of.aparece_seg)})`, segundo: of.aparece_seg });
    marcos.sort((a, b) => a.segundo - b.segundo);

    const curva = curvaRetencao(m.retencao ?? [], base);
    const pico = curva.reduce<{ minuto: number; pessoas: number } | null>((acc, c) => (!acc || c.pessoas > acc.pessoas ? { minuto: c.minuto, pessoas: c.pessoas } : acc), null);

    return texto({
      webinar,
      periodo: periodoLegivel(p),
      video: video ? { nome: video.nome, duracao: minutoSegundo(duracaoSeg), duracaoSeg } : null,
      cadastros: m.cadastros ?? 0,
      acessaramSala: base,
      tempoMedioAssistido: minutoSegundo(m.tempoMedioSeg ?? 0),
      oferta: of ? { ligada: of.ligada, pitch: of.pitch_seg ? minutoSegundo(of.pitch_seg) : null, apareceEm: minutoSegundo(of.aparece_seg) } : null,
      eventos: { min_15: m.eventos?.min_15 ?? 0, min_30: m.eventos?.min_30 ?? 0, min_45: m.eventos?.min_45 ?? 0, min_60: m.eventos?.min_60 ?? 0, pitch: m.eventos?.pitch ?? 0, oferta: m.eventos?.oferta ?? 0 },
      marcos: marcosRetencao(maxSegundos, marcos, base),
      maioresQuedas: maioresQuedas(maxSegundos, duracaoSeg, base, inteiro(args.quedas, 5, 1, 20)),
      pico,
      ...(args.curva === false ? {} : { curva }),
    });
  },
};

// comparar_periodos -----------------------------------------------------------------------------------------------

const compararPeriodos: Ferramenta = {
  name: "comparar_periodos",
  title: "Comparar períodos",
  description:
    "Compara as métricas-chave de dois períodos lado a lado (ex.: semana passada × esta semana) pra ver se uma mudança melhorou: cadastros, acessos, taxa de acesso, 15 min, pitch, oferta, cliques, taxa de clique, chat, vendas, conversão, faturamento (R$), receita por participante e tempo médio. Com webinar_id compara aquele webinar; sem, todos os webinars. Variação % = (B − A) ÷ A.",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: { ...UUID, description: "Id do webinar (opcional; sem ele soma todos os webinars)." },
      de_a: { type: "string", description: "Período A — data inicial AAAA-MM-DD (Brasília)." },
      ate_a: { type: "string", description: "Período A — data final AAAA-MM-DD, inclusive." },
      de_b: { type: "string", description: "Período B — data inicial AAAA-MM-DD (Brasília)." },
      ate_b: { type: "string", description: "Período B — data final AAAA-MM-DD, inclusive." },
    },
    required: ["de_a", "ate_a", "de_b", "ate_b"],
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    let webinar: { id: string; nome: string } | null = null;
    if (args.webinar_id !== undefined && args.webinar_id !== null && args.webinar_id !== "") {
      webinar = await carregarWebinar(args.webinar_id);
      if (!webinar) return erro(WEBINAR_NAO_ENCONTRADO);
    }
    if (!args.de_a || !args.ate_a || !args.de_b || !args.ate_b) return erro("Informe as duas datas de cada período.");
    const pa = periodoDosArgs(args.de_a, args.ate_a, "7d");
    if ("erro" in pa) return erro(`Período A: ${pa.erro}`);
    const pb = periodoDosArgs(args.de_b, args.ate_b, "7d");
    if ("erro" in pb) return erro(`Período B: ${pb.erro}`);

    const [a, b] = await Promise.all([rpcMetricas(webinar?.id ?? null, pa), rpcMetricas(webinar?.id ?? null, pb)]);
    if (a.erro || b.erro) return erro("Não deu para carregar as métricas. Tente de novo.");
    return texto({
      webinar: webinar ?? "todos",
      periodoA: periodoLegivel(pa),
      periodoB: periodoLegivel(pb),
      comparacao: compararMetricas(metricasChave(a.m), metricasChave(b.m)),
    });
  },
};

// ler_chat --------------------------------------------------------------------------------------------------------

type LinhaMensagem = {
  id: string;
  created_at: string;
  autor: "participante" | "atendente" | "chatbot" | "ia";
  texto: string | null;
  imagem_url: string | null;
  apagada: boolean;
  sessao_id: string;
  sessoes: { modo: string; inicio_sessao: string | null; participantes: { nome: string } | null } | null;
};

const AUTORES = ["participante", "atendente", "chatbot", "ia", "todos"] as const;

const lerChat: Ferramenta = {
  name: "ler_chat",
  title: "Ler o chat",
  description:
    "Mensagens que os participantes escreveram no chat da sala — material pra montar a barreira de dores/objeções. Cada mensagem traz texto, nome, minuto do vídeo em que foi escrita, se a pessoa clicou na oferta/comprou e se foi respondida. Filtros: período, autor (padrão participante), busca por texto, só ao vivo. Paginado (até 500 por página). formato 'compacto' devolve só linhas 'mm:ss | texto' pra caber muitas mensagens. Sempre vem um resumo: total de mensagens, pessoas distintas e mensagens por faixa de 5 min do vídeo. Mensagens apagadas e sessões de teste ficam de fora.",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      ...PERIODO,
      autor: { type: "string", enum: [...AUTORES], description: "Quem escreveu: participante (padrão), atendente, chatbot, ia ou todos." },
      busca: { type: "string", description: "Só mensagens que contêm este texto (sem diferenciar maiúsculas)." },
      so_ao_vivo: { type: "boolean", description: "Só sessões ao vivo (padrão false)." },
      formato: { type: "string", enum: ["completo", "compacto"], description: "completo (padrão) ou compacto ('mm:ss | texto')." },
      limite: { type: "integer", minimum: 1, maximum: 500, description: "Mensagens por página (padrão 200, máx. 500)." },
      pagina: { type: "integer", minimum: 1, description: "Página (padrão 1)." },
    },
    required: ["webinar_id"],
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const webinar = await carregarWebinar(args.webinar_id);
    if (!webinar) return erro(WEBINAR_NAO_ENCONTRADO);
    const p = periodoDosArgs(args.de, args.ate, "7d");
    if ("erro" in p) return erro(p.erro);
    const autor = args.autor === undefined ? "participante" : args.autor;
    if (!AUTORES.includes(autor as (typeof AUTORES)[number])) return erro("Autor inválido.");
    const busca = typeof args.busca === "string" ? args.busca.trim().slice(0, 200) : "";
    const limite = inteiro(args.limite, 200, 1, 500);
    const pagina = inteiro(args.pagina, 1, 1, 100000);
    const db = dbAdmin();

    const { data: msgs, error } = await lerTodas<LinhaMensagem>(() => {
      let q = db
        .from("mensagens_suporte")
        .select("id, created_at, autor, texto, imagem_url, apagada, sessao_id, sessoes!inner(modo, inicio_sessao, participantes(nome))")
        .eq("webinar_id", webinar.id)
        .eq("apagada", false)
        .neq("sessoes.modo", "teste")
        .gte("created_at", p.de.toISOString())
        .lt("created_at", p.ate.toISOString());
      if (autor !== "todos") q = q.eq("autor", autor as string);
      if (sim(args.so_ao_vivo)) q = q.eq("sessoes.modo", "ao_vivo");
      if (busca) q = q.ilike("texto", `%${escaparIlike(busca)}%`);
      return q.order("created_at", { ascending: true }).order("id", { ascending: true });
    });
    if (error) return erro(NAO_CARREGOU);

    const todas = msgs.map((m) => ({ ...m, segundoVideo: segundoDoVideo(m.created_at, m.sessoes?.inicio_sessao) }));
    const resumo = resumoChat(todas.map((m) => ({ sessaoId: m.sessao_id, segundoVideo: m.segundoVideo })));
    const paginaMsgs = todas.slice((pagina - 1) * limite, pagina * limite);
    const paginacao = { pagina, limite, total: todas.length, temMais: pagina * limite < todas.length };

    if (args.formato === "compacto") {
      return texto({ webinar, periodo: periodoLegivel(p), resumo, paginacao, mensagens: paginaMsgs.map((m) => linhaCompacta(m.segundoVideo, m.texto, !!m.imagem_url)) });
    }

    // Clique/compra e respostas só das sessões desta página, em lotes (URL do PostgREST tem limite).
    const ids = [...new Set(paginaMsgs.map((m) => m.sessao_id))];
    const eventosPorSessao = new Map<string, Set<string>>();
    const respostas = new Map<string, number[]>();
    for (const lote of lotes(ids)) {
      const [ev, resp] = await Promise.all([
        db.from("eventos").select("sessao_id, tipo").in("sessao_id", lote).in("tipo", ["clicou_oferta", "comprou"]),
        db.from("mensagens_suporte").select("sessao_id, created_at").in("sessao_id", lote).neq("autor", "participante").eq("apagada", false),
      ]);
      if (ev.error || resp.error) return erro(NAO_CARREGOU);
      for (const e of (ev.data ?? []) as { sessao_id: string; tipo: string }[]) {
        if (!eventosPorSessao.has(e.sessao_id)) eventosPorSessao.set(e.sessao_id, new Set());
        eventosPorSessao.get(e.sessao_id)!.add(e.tipo);
      }
      for (const r of (resp.data ?? []) as { sessao_id: string; created_at: string }[]) {
        if (!respostas.has(r.sessao_id)) respostas.set(r.sessao_id, []);
        respostas.get(r.sessao_id)!.push(new Date(r.created_at).getTime());
      }
    }

    return texto({
      webinar,
      periodo: periodoLegivel(p),
      resumo,
      paginacao,
      mensagens: paginaMsgs.map((m) => {
        const ev = eventosPorSessao.get(m.sessao_id) ?? new Set<string>();
        return {
          id: m.id,
          sessaoId: m.sessao_id,
          nome: m.sessoes?.participantes?.nome ?? "",
          autor: m.autor,
          texto: m.texto,
          ...(m.imagem_url ? { imagemUrl: m.imagem_url } : {}),
          minutoVideo: m.segundoVideo === null ? null : minutoSegundo(m.segundoVideo),
          enviadaEm: dataHora(m.created_at),
          modo: m.sessoes?.modo ?? null,
          clicouOferta: ev.has("clicou_oferta"),
          comprou: ev.has("comprou"),
          ...(m.autor === "participante" ? { respondida: foiRespondida(m.sessao_id, m.created_at, respostas) } : {}),
        };
      }),
    });
  },
};

// listar_participantes --------------------------------------------------------------------------------------------

type LinhaSessao = {
  id: string;
  entrou_em: string;
  modo: string;
  max_segundo: number | null;
  dispositivo: string | null;
  pais: string | null;
  cidade: string | null;
  utms: Record<string, string> | null;
  participantes: { nome: string; email: string | null } | null;
  eventos: { tipo: string }[] | null;
};

const listarParticipantes: Ferramenta = {
  name: "listar_participantes",
  title: "Listar participantes",
  description:
    "Sessões (participantes) do webinar que entraram no período: nome, e-mail (mascarado, menos de quem comprou), modo (ao vivo/replay), dispositivo, país/cidade, UTMs, quanto assistiu e os eventos (acessou, clicou na oferta, comprou…). Filtros: comprou, clicou_oferta, nao_comprou, acessou_sala, assistiu_min (assistiu pelo menos N minutos), utm_source, modo. Paginado (até 500). Sem sessões de teste; horário de Brasília. Use ver_participante com o sessao_id pra ver a jornada completa.",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      ...PERIODO,
      comprou: { type: "boolean", description: "Só quem comprou." },
      clicou_oferta: { type: "boolean", description: "Só quem clicou na oferta." },
      nao_comprou: { type: "boolean", description: "Só quem não comprou." },
      acessou_sala: { type: "boolean", description: "Só quem acessou a sala." },
      assistiu_min: { type: "integer", minimum: 0, description: "Só quem assistiu pelo menos N minutos do vídeo." },
      utm_source: { type: "string", description: "Só esta utm_source (exata)." },
      modo: { type: "string", enum: ["ao_vivo", "replay"], description: "Só ao vivo ou só replay." },
      limite: { type: "integer", minimum: 1, maximum: 500, description: "Por página (padrão 100, máx. 500)." },
      pagina: { type: "integer", minimum: 1, description: "Página (padrão 1)." },
    },
    required: ["webinar_id"],
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const webinar = await carregarWebinar(args.webinar_id);
    if (!webinar) return erro(WEBINAR_NAO_ENCONTRADO);
    const p = periodoDosArgs(args.de, args.ate, "7d");
    if ("erro" in p) return erro(p.erro);
    if (args.modo !== undefined && args.modo !== "ao_vivo" && args.modo !== "replay") return erro("Modo inválido.");
    const limite = inteiro(args.limite, 100, 1, 500);
    const pagina = inteiro(args.pagina, 1, 1, 100000);
    const assistiuMin = args.assistiu_min === undefined ? 0 : inteiro(args.assistiu_min, 0, 0, 100000);
    const utmSource = typeof args.utm_source === "string" ? args.utm_source.trim() : "";
    const db = dbAdmin();

    const { data, error } = await lerTodas<LinhaSessao>(() => {
      let q = db
        .from("sessoes")
        .select("id, entrou_em, modo, max_segundo, dispositivo, pais, cidade, utms, participantes(nome, email), eventos(tipo)")
        .eq("webinar_id", webinar.id)
        .neq("modo", "teste")
        .gte("entrou_em", p.de.toISOString())
        .lt("entrou_em", p.ate.toISOString());
      if (args.modo) q = q.eq("modo", args.modo as string);
      if (assistiuMin > 0) q = q.gte("max_segundo", assistiuMin * 60);
      if (utmSource) q = q.eq("utms->>utm_source", utmSource);
      return q.order("entrou_em", { ascending: false }).order("id", { ascending: true });
    });
    if (error) return erro(NAO_CARREGOU);

    const filtros = { comprou: sim(args.comprou), clicouOferta: sim(args.clicou_oferta), naoComprou: sim(args.nao_comprou), acessouSala: sim(args.acessou_sala) };
    const filtradas = data
      .map((s) => ({ ...s, tipos: (s.eventos ?? []).map((e) => e.tipo) }))
      .filter((s) => passaFiltrosEventos(s.tipos, filtros));
    const paginaSessoes = filtradas.slice((pagina - 1) * limite, pagina * limite);

    return texto({
      webinar,
      periodo: periodoLegivel(p),
      total: filtradas.length,
      paginacao: { pagina, limite, temMais: pagina * limite < filtradas.length },
      participantes: paginaSessoes.map((s) => {
        const comprou = s.tipos.includes("comprou");
        return {
          sessaoId: s.id,
          nome: s.participantes?.nome ?? "",
          email: emailVisivel(s.participantes?.email, comprou),
          entrouEm: dataHora(s.entrou_em),
          modo: s.modo,
          dispositivo: s.dispositivo,
          local: [s.cidade, s.pais].filter(Boolean).join(", ") || null,
          utms: s.utms ?? {},
          assistiuAte: minutoSegundo(s.max_segundo ?? 0),
          acessou: s.tipos.includes("acessou_sala"),
          clicouOferta: s.tipos.includes("clicou_oferta"),
          comprou,
          eventos: s.tipos,
        };
      }),
    });
  },
};

// ver_participante ------------------------------------------------------------------------------------------------

const verParticipante: Ferramenta = {
  name: "ver_participante",
  title: "Ver participante",
  description:
    "Jornada completa de uma sessão (participante): dados da sessão (nome, e-mail — mascarado se não comprou —, modo, dispositivo, local, UTMs, até onde assistiu), eventos em ordem com o minuto do vídeo, todas as mensagens do chat (dele e das respostas) e as vendas casadas com a sessão. Horário de Brasília.",
  inputSchema: { type: "object", properties: { sessao_id: { ...UUID, description: "Id da sessão (veja listar_participantes ou ler_chat)." } }, required: ["sessao_id"], additionalProperties: false },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    if (!ehUuid(args.sessao_id)) return erro("Sessão não encontrada.");
    const db = dbAdmin();
    const { data: s } = await db
      .from("sessoes")
      .select("id, webinar_id, entrou_em, inicio_sessao, modo, max_segundo, dispositivo, navegador, pais, cidade, utms, status_atendimento, participantes(nome, email), webinars!sessoes_webinar_id_fkey(nome)")
      .eq("id", args.sessao_id)
      .maybeSingle();
    if (!s) return erro("Sessão não encontrada.");
    const sessao = s as unknown as {
      id: string;
      webinar_id: string;
      entrou_em: string;
      inicio_sessao: string;
      modo: string;
      max_segundo: number | null;
      dispositivo: string | null;
      navegador: string | null;
      pais: string | null;
      cidade: string | null;
      utms: Record<string, string> | null;
      status_atendimento: string;
      participantes: { nome: string; email: string | null } | null;
      webinars: { nome: string } | null;
    };

    const [ev, msgs, vendas] = await Promise.all([
      db.from("eventos").select("tipo, segundo_video, criado_em").eq("sessao_id", sessao.id).order("criado_em", { ascending: true }),
      db.from("mensagens_suporte").select("autor, texto, imagem_url, apagada, created_at, usuarios(nome)").eq("sessao_id", sessao.id).order("created_at", { ascending: true }).limit(1000),
      db.from("vendas").select("plataforma, id_transacao, valor_centavos, src, created_at").eq("sessao_id", sessao.id).order("created_at", { ascending: true }),
    ]);
    if (ev.error || msgs.error || vendas.error) return erro(NAO_CARREGOU);

    const eventos = (ev.data ?? []) as { tipo: string; segundo_video: number | null; criado_em: string }[];
    const comprou = eventos.some((e) => e.tipo === "comprou");
    return texto({
      sessaoId: sessao.id,
      webinar: { id: sessao.webinar_id, nome: sessao.webinars?.nome ?? null },
      nome: sessao.participantes?.nome ?? "",
      email: emailVisivel(sessao.participantes?.email, comprou),
      entrouEm: dataHora(sessao.entrou_em),
      inicioDaSessao: dataHora(sessao.inicio_sessao),
      modo: sessao.modo,
      dispositivo: sessao.dispositivo,
      navegador: sessao.navegador,
      local: [sessao.cidade, sessao.pais].filter(Boolean).join(", ") || null,
      utms: sessao.utms ?? {},
      assistiuAte: minutoSegundo(sessao.max_segundo ?? 0),
      atendimento: sessao.status_atendimento,
      eventos: eventos.map((e) => {
        const seg = e.segundo_video ?? segundoDoVideo(e.criado_em, sessao.inicio_sessao);
        return { tipo: e.tipo, minutoVideo: seg === null ? null : minutoSegundo(seg), em: dataHora(e.criado_em) };
      }),
      mensagens: ((msgs.data ?? []) as unknown as { autor: string; texto: string | null; imagem_url: string | null; apagada: boolean; created_at: string; usuarios: { nome: string } | null }[]).map((m) => {
        const seg = segundoDoVideo(m.created_at, sessao.inicio_sessao);
        return {
          autor: m.autor === "atendente" && m.usuarios?.nome ? `atendente ${m.usuarios.nome}` : m.autor,
          texto: m.apagada ? "[apagada]" : m.texto,
          ...(m.imagem_url && !m.apagada ? { imagemUrl: m.imagem_url } : {}),
          minutoVideo: seg === null ? null : minutoSegundo(seg),
          em: dataHora(m.created_at),
        };
      }),
      vendas: ((vendas.data ?? []) as { plataforma: string; id_transacao: string; valor_centavos: number; src: string | null; created_at: string }[]).map((v) => ({
        plataforma: v.plataforma,
        transacao: v.id_transacao,
        valorReais: reais(v.valor_centavos),
        src: v.src,
        em: dataHora(v.created_at),
      })),
    });
  },
};

// listar_vendas ---------------------------------------------------------------------------------------------------

type LinhaVenda = {
  id: string;
  created_at: string;
  webinar_id: string;
  sessao_id: string | null;
  plataforma: string;
  id_transacao: string;
  valor_centavos: number;
  comprador_email: string | null;
  src: string | null;
  utms: Record<string, string> | null;
  webinars: { nome: string } | null;
};

const listarVendas: Ferramenta = {
  name: "listar_vendas",
  title: "Listar vendas",
  description:
    "Vendas reais (confirmadas pelo checkout) no período: data, webinar, valor (R$), plataforma, transação, comprador, src e UTMs, e se a venda foi casada com uma sessão (sessaoId, pra abrir em ver_participante). Com webinar_id só daquele webinar; sem, de todos. Traz o total de vendas e o faturamento do filtro inteiro. Paginado (até 500). Horário de Brasília.",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: { ...UUID, description: "Id do webinar (opcional; sem ele lista de todos)." },
      ...PERIODO,
      plataforma: { type: "string", description: "Só desta plataforma (vortexpay, kiwify, hotmart, eduzz, hubla, themembers)." },
      limite: { type: "integer", minimum: 1, maximum: 500, description: "Por página (padrão 100, máx. 500)." },
      pagina: { type: "integer", minimum: 1, description: "Página (padrão 1)." },
    },
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    let webinar: { id: string; nome: string } | null = null;
    if (args.webinar_id !== undefined && args.webinar_id !== null && args.webinar_id !== "") {
      webinar = await carregarWebinar(args.webinar_id);
      if (!webinar) return erro(WEBINAR_NAO_ENCONTRADO);
    }
    const p = periodoDosArgs(args.de, args.ate, "7d");
    if ("erro" in p) return erro(p.erro);
    const limite = inteiro(args.limite, 100, 1, 500);
    const pagina = inteiro(args.pagina, 1, 1, 100000);
    const plataforma = typeof args.plataforma === "string" ? args.plataforma.trim() : "";
    const db = dbAdmin();

    const { data, error } = await lerTodas<LinhaVenda>(() => {
      let q = db
        .from("vendas")
        .select("id, created_at, webinar_id, sessao_id, plataforma, id_transacao, valor_centavos, comprador_email, src, utms, webinars(nome)")
        .gte("created_at", p.de.toISOString())
        .lt("created_at", p.ate.toISOString());
      if (webinar) q = q.eq("webinar_id", webinar.id);
      if (plataforma) q = q.eq("plataforma", plataforma);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    });
    if (error) return erro(NAO_CARREGOU);

    const faturamento = data.reduce((s, v) => s + (v.valor_centavos || 0), 0);
    const porPlataforma: Record<string, { vendas: number; faturamentoReais: number }> = {};
    for (const v of data) {
      const g = (porPlataforma[v.plataforma] ??= { vendas: 0, faturamentoReais: 0 });
      g.vendas++;
      g.faturamentoReais = Math.round((g.faturamentoReais + reais(v.valor_centavos)) * 100) / 100;
    }
    return texto({
      webinar: webinar ?? "todos",
      periodo: periodoLegivel(p),
      total: data.length,
      faturamentoReais: reais(faturamento),
      ticketMedioReais: data.length ? reais(Math.round(faturamento / data.length)) : 0,
      casadasComSessao: data.filter((v) => v.sessao_id).length,
      porPlataforma,
      paginacao: { pagina, limite, temMais: pagina * limite < data.length },
      vendas: data.slice((pagina - 1) * limite, pagina * limite).map((v) => ({
        em: dataHora(v.created_at),
        webinar: v.webinars?.nome ?? v.webinar_id,
        valorReais: reais(v.valor_centavos),
        plataforma: v.plataforma,
        transacao: v.id_transacao,
        comprador: v.comprador_email,
        src: v.src,
        utms: v.utms ?? {},
        sessaoId: v.sessao_id,
      })),
    });
  },
};

// origem_trafego --------------------------------------------------------------------------------------------------

const origemTrafego: Ferramenta = {
  name: "origem_trafego",
  title: "Origem do tráfego",
  description:
    "Cadastros, acessos à sala, cliques na oferta, vendas e faturamento (R$) agrupados por uma UTM (utm_source, utm_medium, utm_campaign, utm_content ou utm_term; padrão utm_source), com taxa de acesso, taxa de clique e conversão (vendas ÷ acessos) — pra ver qual origem converte. Sessões que entraram no período (sem teste) e vendas do período; a venda conta pra UTM da sessão casada com ela, ou pras UTMs da própria venda. Com webinar_id só daquele webinar; sem, todos.",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: { ...UUID, description: "Id do webinar (opcional; sem ele soma todos)." },
      ...PERIODO,
      agrupar_por: { type: "string", enum: [...CAMPOS_UTM], description: "UTM pra agrupar (padrão utm_source)." },
    },
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    let webinar: { id: string; nome: string } | null = null;
    if (args.webinar_id !== undefined && args.webinar_id !== null && args.webinar_id !== "") {
      webinar = await carregarWebinar(args.webinar_id);
      if (!webinar) return erro(WEBINAR_NAO_ENCONTRADO);
    }
    const p = periodoDosArgs(args.de, args.ate, "7d");
    if ("erro" in p) return erro(p.erro);
    const campo = (args.agrupar_por ?? "utm_source") as CampoUtm;
    if (!CAMPOS_UTM.includes(campo)) return erro("Escolha utm_source, utm_medium, utm_campaign, utm_content ou utm_term.");
    const db = dbAdmin();

    const [sessoes, vendas] = await Promise.all([
      lerTodas<{ id: string; utms: Record<string, unknown> | null; eventos: { tipo: string }[] | null }>(() => {
        let q = db.from("sessoes").select("id, utms, eventos(tipo)").neq("modo", "teste").gte("entrou_em", p.de.toISOString()).lt("entrou_em", p.ate.toISOString());
        if (webinar) q = q.eq("webinar_id", webinar.id);
        return q.order("id", { ascending: true });
      }),
      lerTodas<{ id: string; sessao_id: string | null; valor_centavos: number; utms: Record<string, unknown> | null }>(() => {
        let q = db.from("vendas").select("id, sessao_id, valor_centavos, utms").gte("created_at", p.de.toISOString()).lt("created_at", p.ate.toISOString());
        if (webinar) q = q.eq("webinar_id", webinar.id);
        return q.order("id", { ascending: true });
      }),
    ]);
    if (sessoes.error || vendas.error) return erro(NAO_CARREGOU);

    const linhas = agruparOrigem(
      sessoes.data.map((s) => ({ id: s.id, utms: s.utms, eventos: (s.eventos ?? []).map((e) => e.tipo) })),
      vendas.data.map((v) => ({ sessaoId: v.sessao_id, valorCentavos: v.valor_centavos, utms: v.utms })),
      campo,
    );
    return texto({ webinar: webinar ?? "todos", periodo: periodoLegivel(p), agrupadoPor: campo, origens: linhas });
  },
};

export const FERRAMENTAS_ANALISE: Ferramenta[] = [
  metricasWebinar,
  dashboardGeral,
  analisarRetencao,
  compararPeriodos,
  lerChat,
  listarParticipantes,
  verParticipante,
  listarVendas,
  origemTrafego,
];
