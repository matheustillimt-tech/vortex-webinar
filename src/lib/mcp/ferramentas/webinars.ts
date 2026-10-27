import "server-only";
import { randomUUID } from "node:crypto";
import { agendaDeLinha, proximasSessoes, type LinhaAgenda } from "@/src/lib/regras/agenda";
import { validarAgenda } from "@/src/lib/regras/agenda-form";
import { modelosPadrao } from "@/src/lib/regras/emails";
import { formatarHora, formatarSessao } from "@/src/lib/regras/fuso";
import { proximosHorariosJit } from "@/src/lib/regras/jit";
import { FUSO_PADRAO_JIT, TIPOS_EMAIL, validarConfigJit, validarEmailJit, validarHorariosJit, type EntradaHorarioJit, type TipoEmail } from "@/src/lib/regras/jit-form";
import {
  agendaConfigurada,
  configDeLinha,
  descreverHorario,
  fusoDoPainelJit,
  horarioDeLinha,
  linhaDeHorario,
  ROTULO_TIPO_EMAIL,
  type LinhaConfigJit,
  type LinhaEmailJit,
  type LinhaHorarioJit,
} from "@/src/lib/regras/jit-painel";
import { linksDaSala } from "@/src/lib/regras/links-sala";
import { escaparIlike } from "@/src/lib/regras/lista-webinars";
import { caminhoMidia, validarImagem } from "@/src/lib/regras/midia";
import { validarAudiencia, validarInicio, validarOferta, validarTelaLogin } from "@/src/lib/regras/passos";
import { gerarSlug, slugUnico, validarSlug } from "@/src/lib/regras/slug";
import type { Idioma } from "@/src/lib/regras/textos-sala";
import { formatarDuracao } from "@/src/lib/regras/video";
import { tokenTeste } from "@/src/lib/sala/sessao";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { ALTERA, APAGA, auditar, camposDeArgs, CRIA, ehUuid, erro, inteiro, linkPainel, linkSala, SO_LEITURA, texto, WEBINAR, type Ferramenta } from "../comum";
import {
  camposAgenda,
  camposAgendaParaEnvio,
  camposAudiencia,
  camposConfigJit,
  camposEmailJit,
  camposInicio,
  camposOferta,
  camposTelaLogin,
  camposVideo,
  COLUNAS_OFERTA,
  COLUNAS_TELA_LOGIN,
  mesclarCampos,
  TEMPOS_OFERTA,
  urlImagem,
  type LinhaAgendaCompleta,
  type LinhaAudiencia,
  type LinhaInicio,
  type LinhaOferta,
  type LinhaTelaLogin,
  type LinhaWebinarVideo,
} from "./webinars-campos";
import { FERRAMENTAS_TARJAS } from "./webinars-tarjas";
import { copiarWebinar } from "../../webinars-duplicar";

/**
 * Ferramentas de configuração do webinar (o passo a passo do painel em `app/(painel)/webinars/**`). Cada `salvar_*`
 * faz o mesmo que a server action do passo (mesmo validador, mesmas colunas, mesma descrição no Histórico), mas é
 * ATUALIZAÇÃO PARCIAL: lê a linha atual, converte pros campos do formulário (`webinars-campos.ts`), sobrepõe só os
 * argumentos recebidos e valida o formulário inteiro. Assim dá pra mudar só o preço da oferta.
 */

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

const NAO_ENCONTRADO = "Webinar não encontrado.";
const PARCIAL =
  " Atualização parcial: mande só os campos que quer mudar; o resto continua como está (veja os valores atuais em ver_webinar). " +
  "Booleanos ligam/desligam; null limpa um campo de texto.";

const txt = (description: string) => ({ type: "string", description });
const bool = (description: string) => ({ type: "boolean", description });
const tempo = (description: string) => ({ type: ["string", "integer"], description: `${description} Formato h:mm:ss ou mm:ss (ex.: "45:30"), ou segundos inteiros.` });
const URL_IMAGEM = "Link https de uma imagem já hospedada (JPG/PNG/WEBP; use preparar_upload_imagem pra subir um arquivo). \"\" ou null tira a imagem.";

function esquema(propriedades: Record<string, unknown>, obrigatorios: string[] = ["webinar_id"]) {
  return { type: "object", properties: propriedades, required: obrigatorios, additionalProperties: false };
}

const linkPasso = (id: string, passo: string) => linkPainel(`/webinars/${id}/${passo}`);
const db = () => dbAdmin();

type Webinar = { id: string; nome: string; slug: string; tipo_agenda: string; idioma: string; status: string };

async function lerWebinar(id: unknown): Promise<Webinar | null> {
  if (!ehUuid(id)) return null;
  const { data } = await db().from("webinars").select("id, nome, slug, tipo_agenda, idioma, status").eq("id", id).maybeSingle();
  return (data as Webinar | null) ?? null;
}

/** Links da sala (os mesmos do passo Pronto), com a sala teste quando dá pra assinar o token. */
function linksDoWebinar(id: string, slug: string, jit: boolean) {
  const sala = linkSala("");
  const links: { rotulo: string; url: string; descricao?: string }[] = linksDaSala(sala, slug, jit);
  try {
    links.push({ rotulo: "Sala teste", url: `${sala}/${slug}?teste=${tokenTeste(id, new Date())}`, descricao: "Controles do vídeo liberados e sem contar métricas. Abre a tela de login em modo teste (preencher nome/telefone manda esses dados nos webhooks; &nome=…&telefone=… no link pula a tela). Os webhooks da oferta (viu e clicou) disparam. Vale por 24 horas." });
  } catch {
    // sem SALA_TOKEN_SECRET: fica sem o link de teste
  }
  return links;
}

const semWebinarId = <T extends Record<string, unknown>>(l: T) => {
  const { webinar_id: _w, ...resto } = l;
  return resto;
};

// ---------------------------------------------------------------------------
// Lista, leitura e ciclo de vida
// ---------------------------------------------------------------------------

const listarWebinars: Ferramenta = {
  name: "listar_webinars",
  title: "Listar webinars",
  description:
    "Lista os webinars (mais recentes primeiro) com id, nome, título, slug, tipo de agenda (unica, recorrente, jit), status, próxima sessão, link da sala e do painel. " +
    "Padrão: só os ativos. Use o id nas outras ferramentas.",
  inputSchema: esquema(
    {
      status: { type: "string", enum: ["ativo", "arquivado", "todos"], description: "Filtro de status (padrão ativo)." },
      tipo: { type: "string", enum: ["unica", "recorrente", "jit"], description: "Só um tipo de agenda (opcional)." },
      busca: txt("Parte do nome do webinar (opcional)."),
      pagina: { type: "integer", minimum: 1, description: "Página (padrão 1)." },
      por_pagina: { type: "integer", minimum: 1, maximum: 100, description: "Itens por página (padrão 50, máximo 100)." },
    },
    [],
  ),
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const status = args.status === "arquivado" || args.status === "todos" ? args.status : "ativo";
    const porPagina = inteiro(args.por_pagina, 50, 1, 100);
    const pagina = inteiro(args.pagina, 1, 1, 100000);
    let q = db()
      .from("webinars")
      .select("id, nome, titulo, slug, status, tipo_agenda", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
    if (status !== "todos") q = q.eq("status", status);
    if (args.tipo === "unica" || args.tipo === "recorrente" || args.tipo === "jit") q = q.eq("tipo_agenda", args.tipo);
    if (typeof args.busca === "string" && args.busca.trim()) q = q.ilike("nome", `%${escaparIlike(args.busca.trim())}%`);
    const desde = (pagina - 1) * porPagina;
    const { data, count, error } = await q.range(desde, desde + porPagina - 1);
    if (error) return erro("Não deu para listar os webinars.");
    const webinars = (data ?? []) as { id: string; nome: string; titulo: string | null; slug: string; status: string; tipo_agenda: string }[];

    const ids = webinars.map((w) => w.id);
    const { data: agendas } = ids.length
      ? await db().from("agendas").select("webinar_id, fuso, inicio, fim, repeticao, dia_semana, hora_inicio, hora_fim, vigencia_fim").in("webinar_id", ids)
      : { data: [] };
    const agendaPor = new Map(((agendas ?? []) as (LinhaAgenda & { webinar_id: string })[]).map((a) => [a.webinar_id, a]));
    const agora = new Date();
    const proxima = (w: (typeof webinars)[number]) => {
      if (w.tipo_agenda === "jit") return "Just in time: a pessoa escolhe o horário";
      const linha = agendaPor.get(w.id);
      if (!linha) return "Sem sessão marcada";
      const agenda = agendaDeLinha(linha);
      const [p] = proximasSessoes(agenda, agora, 1);
      return p ? `Próxima: ${formatarSessao(p.inicio, agenda.fuso)}` : "Sem sessão marcada";
    };

    const total = count ?? webinars.length;
    return texto({
      total,
      pagina,
      paginas: Math.max(1, Math.ceil(total / porPagina)),
      webinars: webinars.map((w) => ({
        id: w.id,
        nome: w.nome,
        titulo: w.titulo,
        slug: w.slug,
        tipo_agenda: w.tipo_agenda,
        status: w.status,
        proxima_sessao: proxima(w),
        link_sala: linkSala(`/${w.slug}`),
        link_painel: linkPasso(w.id, "inicio"),
      })),
    });
  },
};

const verWebinar: Ferramenta = {
  name: "ver_webinar",
  title: "Ver a configuração completa do webinar",
  description:
    "Toda a configuração do webinar de uma vez, passo a passo: início, agenda (ou just in time: configuração, horários com id e e-mails), tela de login, vídeo (nome, duração), " +
    "oferta, audiência, agente de IA (ligado/nome), quantidades de chat simulado, vendas simuladas e regras, links da sala (principal, link mágico, replay, teste) e o que falta configurar. " +
    "Os campos de cada passo vêm com os MESMOS nomes e formatos aceitos pelas ferramentas salvar_* (tempos em h:mm:ss, datas AAAA-MM-DDTHH:mm no fuso, checkbox \"on\"/\"\"). Leia antes de mudar.",
  inputSchema: esquema({ webinar_id: WEBINAR }),
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    if (!ehUuid(args.webinar_id)) return erro(NAO_ENCONTRADO);
    const id = args.webinar_id;
    const { data: w } = await db()
      .from("webinars")
      .select("id, nome, titulo, slug, idioma, status, tipo_agenda, apresentador_nome, apresentador_avatar_url, acesso_facilitado, login_na_sala, sincronizar_video")
      .eq("id", id)
      .maybeSingle();
    if (!w) return erro(NAO_ENCONTRADO);
    const webinar = w as LinhaInicio & { id: string; status: string; tipo_agenda: string };
    const jit = webinar.tipo_agenda === "jit";
    const conta = (tabela: string) => db().from(tabela).select("id", { count: "exact", head: true }).eq("webinar_id", id);

    const [agendaR, jitCfgR, jitHorR, jitEmailsR, loginR, videoR, ofertaR, audienciaR, agenteR, chatR, vendasR, regrasR] = await Promise.all([
      db().from("agendas").select("fuso, inicio, fim, repeticao, dia_semana, hora_inicio, hora_fim, vigencia_fim, usar_sala_espera, pagina_espera_id").eq("webinar_id", id).maybeSingle(),
      db().from("jit_config").select("fuso, esconder_de, esconder_ate, exibicao, fim, pagina_registro_id, pagina_espera_id").eq("webinar_id", id).maybeSingle(),
      db().from("jit_horarios").select("id, quando, hora, intervalo_min, data, dia_semana").eq("webinar_id", id).order("created_at", { ascending: true }),
      db().from("emails_jit").select("tipo, remetente_nome, assunto, modelo, minutos_antes").eq("webinar_id", id),
      db().from("telas_login").select(COLUNAS_TELA_LOGIN).eq("webinar_id", id).maybeSingle(),
      db().from("webinar_video").select("video_id, autoplay, tela_cheia, orientacao, videos(nome, duracao_seg, status)").eq("webinar_id", id).maybeSingle(),
      db().from("ofertas").select(COLUNAS_OFERTA).eq("webinar_id", id).maybeSingle(),
      db().from("audiencias").select("modo, minimo, maximo, selo_ao_vivo").eq("webinar_id", id).maybeSingle(),
      db().from("agentes_ia").select("ligado, nome").eq("webinar_id", id).maybeSingle(),
      conta("mensagens_simuladas"),
      conta("vendas_simuladas"),
      conta("regras"),
    ]);
    const agora = new Date();

    // Agenda: just in time ou sessão única/repetição.
    const horariosLinhas = (jitHorR.data ?? []) as (LinhaHorarioJit & { id: string })[];
    let agenda: Record<string, unknown>;
    if (jit) {
      const cfgLinha = jitCfgR.data as (LinhaConfigJit & { pagina_registro_id: string | null; pagina_espera_id: string | null }) | null;
      const cfg = configDeLinha(cfgLinha);
      const horarios = horariosLinhas.map(horarioDeLinha);
      const fusoPainel = fusoDoPainelJit(cfg.fuso);
      const padroes = modelosPadrao((webinar.idioma as Idioma) ?? "pt-BR");
      const emails = (jitEmailsR.data ?? []) as LinhaEmailJit[];
      agenda = {
        tipo: "jit",
        config: camposConfigJit(cfgLinha),
        horarios: horariosLinhas.map((l, i) => ({ id: l.id, descricao: descreverHorario(horarios[i], cfg.fuso) })),
        proximos_horarios: proximosHorariosJit(horarios, cfg, agora).slice(0, 5).map((d) => formatarSessao(d, fusoPainel)),
        emails: Object.fromEntries(TIPOS_EMAIL.map((t) => [t, { ...camposEmailJit(emails.find((e) => e.tipo === t), padroes[t]), salvo: emails.some((e) => e.tipo === t) }])),
        pagina_registro_id: cfgLinha?.pagina_registro_id ?? null,
        pagina_espera_id: cfgLinha?.pagina_espera_id ?? null,
      };
    } else {
      const linha = agendaR.data as (LinhaAgendaCompleta & { pagina_espera_id: string | null }) | null;
      const a = linha ? agendaDeLinha(linha) : null;
      agenda = {
        tipo: webinar.tipo_agenda,
        salva: a !== null && (a.inicio !== null || a.horaInicio !== null),
        campos: camposAgenda(linha),
        proximas_sessoes: a ? proximasSessoes(a, agora, 3).map((j) => `${formatarSessao(j.inicio, a.fuso)} até ${formatarHora(j.fim, a.fuso)}`) : [],
        pagina_espera_id: linha?.pagina_espera_id ?? null,
      };
    }

    const login = loginR.data as LinhaTelaLogin | null;
    const video = videoR.data as (LinhaWebinarVideo & { videos: { nome: string; duracao_seg: number | null; status: string } | null }) | null;
    const oferta = ofertaR.data as LinhaOferta | null;
    const agente = agenteR.data as { ligado: boolean; nome: string | null } | null;
    const agendaLinha = agendaR.data as { inicio: string | null; hora_inicio: string | null } | null;

    const pendencias = [
      !agendaConfigurada({ tipoAgenda: webinar.tipo_agenda, inicio: agendaLinha?.inicio ?? null, horaInicio: agendaLinha?.hora_inicio ?? null, horariosJit: horariosLinhas.length }) &&
        (jit ? "Nenhum horário do just in time" : "Nenhuma agenda salva"),
      !video && "Nenhum vídeo escolhido",
      !login && "Tela de login padrão (ainda não personalizada)",
      !(oferta && oferta.ligada) && "Nenhuma oferta ligada",
    ].filter((p): p is string => Boolean(p));

    return texto({
      id,
      nome: webinar.nome,
      status: webinar.status,
      tipo_agenda: webinar.tipo_agenda,
      links: { painel: linkPasso(id, "inicio"), sala: linksDoWebinar(id, webinar.slug, jit) },
      pendencias,
      inicio: { ...camposInicio(webinar), apresentador_avatar_url: webinar.apresentador_avatar_url },
      agenda,
      tela_login: { personalizada: login !== null, ...camposTelaLogin(login), logo_url: login?.logo_url ?? null },
      video: video
        ? {
            ...camposVideo(video),
            nome: video.videos?.nome ?? null,
            status: video.videos?.status ?? null,
            duracao: video.videos?.duracao_seg != null ? formatarDuracao(video.videos.duracao_seg) : null,
            duracao_seg: video.videos?.duracao_seg ?? null,
          }
        : null,
      oferta: { salva: oferta !== null, ...camposOferta(oferta), banner_url: oferta?.banner_url ?? null, banner_mobile_url: oferta?.banner_mobile_url ?? null },
      audiencia: camposAudiencia(audienciaR.data as LinhaAudiencia | null),
      agente_ia: { ligado: agente?.ligado ?? false, nome: agente?.nome ?? null },
      quantidades: { chat_simulado: chatR.count ?? 0, vendas_simuladas: vendasR.count ?? 0, regras: regrasR.count ?? 0 },
    });
  },
};

const criarWebinar: Ferramenta = {
  name: "criar_webinar",
  title: "Criar webinar",
  description: "Cria um webinar novo (ativo, sessão única, agenda vazia) com o nome dado; o endereço (slug) sai do nome. Depois configure com os salvar_*.",
  inputSchema: esquema({ nome: txt("Nome do webinar (até 150 caracteres; precisa de pelo menos 3 letras ou números).") }, ["nome"]),
  annotations: CRIA,
  escrita: true,
  async executar(chave, args) {
    const nome = String(args.nome ?? "").trim();
    if (!nome) return erro("Dê um nome ao webinar.");
    if (nome.length > 150) return erro("Use até 150 caracteres.");
    const base = gerarSlug(nome);
    if (validarSlug(base)) return erro("Use um nome com pelo menos 3 letras ou números.");

    const parecidosCom = async (prefixo: string) => {
      const { data } = await db().from("webinars").select("slug").like("slug", `${prefixo}%`);
      return ((data ?? []) as { slug: string }[]).map((p) => p.slug);
    };
    let slug = slugUnico(base, await parecidosCom(base));
    let { data, error } = await db().from("webinars").insert({ nome, slug }).select("id").single();
    if ((error as { code?: string } | null)?.code === "23505") {
      slug = slugUnico(base, await parecidosCom(base.slice(0, 50)));
      ({ data, error } = await db().from("webinars").insert({ nome, slug }).select("id").single());
    }
    if (error || !data) return erro("Não deu para criar o webinar.");
    const id = (data as { id: string }).id;
    const { error: erroAgenda } = await db().from("agendas").insert({ webinar_id: id });
    if (erroAgenda) return erro(`O webinar foi criado (id ${id}), mas não deu para criar a agenda. Salve a agenda com salvar_agenda.`);
    await auditar(chave, { webinarId: id, acao: "criou", descricao: `Criou o webinar "${nome}"` });
    return texto({ ok: true, id, nome, slug, link_sala: linkSala(`/${slug}`), link_painel: linkPasso(id, "inicio") });
  },
};

const duplicarWebinar: Ferramenta = {
  name: "duplicar_webinar",
  title: "Duplicar webinar",
  description:
    "Cria uma cópia ativa do webinar com \"(cópia)\" no nome e endereço novo, copiando toda a configuração (agenda, login, vídeo, oferta, audiência, agente de IA, chat e vendas simulados, regras, " +
    "integrações e o just in time). Não copia participantes, sessões, métricas nem vendas reais.",
  inputSchema: esquema({ webinar_id: WEBINAR }),
  annotations: CRIA,
  escrita: true,
  async executar(chave, args) {
    if (!ehUuid(args.webinar_id)) return erro(NAO_ENCONTRADO);
    const r = await copiarWebinar(db(), args.webinar_id);
    if ("erro" in r) return erro(r.erro);
    await auditar(chave, { webinarId: r.id, acao: "criou", descricao: `Duplicou o webinar "${r.nomeOriginal}"` });
    return texto({ ok: true, id: r.id, nome: r.nome, slug: r.slug, link_sala: linkSala(`/${r.slug}`), link_painel: linkPasso(r.id, "inicio") });
  },
};

function mudarStatus(nome: string, title: string, description: string, status: "ativo" | "arquivado", descricaoAuditoria: string, falha: string): Ferramenta {
  return {
    name: nome,
    title,
    description,
    inputSchema: esquema({ webinar_id: WEBINAR }),
    annotations: ALTERA,
    escrita: true,
    async executar(chave, args) {
      const w = await lerWebinar(args.webinar_id);
      if (!w) return erro(NAO_ENCONTRADO);
      const { error } = await db().from("webinars").update({ status }).eq("id", w.id);
      if (error) return erro(falha);
      await auditar(chave, { webinarId: w.id, acao: "editou", descricao: descricaoAuditoria });
      return texto({ ok: true, id: w.id, nome: w.nome, status });
    },
  };
}

const arquivarWebinar = mudarStatus(
  "arquivar_webinar",
  "Arquivar webinar",
  "Arquiva o webinar (sai da lista de ativos; nada é apagado e dá pra desarquivar). Webinar nunca é excluído pelo MCP.",
  "arquivado",
  "Arquivou o webinar",
  "Não deu para arquivar o webinar.",
);
const desarquivarWebinar = mudarStatus(
  "desarquivar_webinar",
  "Desarquivar webinar",
  "Reativa um webinar arquivado (volta pra lista de ativos).",
  "ativo",
  "Reativou o webinar",
  "Não deu para reativar o webinar.",
);

// ---------------------------------------------------------------------------
// Passo Início
// ---------------------------------------------------------------------------

const salvarInicio: Ferramenta = {
  name: "salvar_inicio",
  title: "Salvar o Início do webinar",
  description: "Passo Início: nome, título da sala, endereço (slug), idioma, apresentador (nome e avatar) e opções de acesso." + PARCIAL,
  inputSchema: esquema({
    webinar_id: WEBINAR,
    nome: txt("Nome interno (até 150)."),
    titulo: txt("Título mostrado na sala (até 150; vazio usa o nome)."),
    slug: txt("Endereço da sala (letras minúsculas, números e hífen). Mudar quebra os links já divulgados."),
    idioma: { type: "string", enum: ["pt-BR", "es", "en"], description: "Idioma da sala, do login e dos e-mails." },
    apresentador_nome: txt("Nome do apresentador (até 100)."),
    apresentador_avatar_url: txt(`Avatar do apresentador. ${URL_IMAGEM}`),
    acesso_facilitado: bool("Acesso facilitado (entra sem preencher tudo)."),
    login_na_sala: bool("Login dentro da sala (só vale com acesso_facilitado)."),
    sincronizar_video: bool("Sincronizar o vídeo entre quem está assistindo."),
  }),
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    if (!ehUuid(args.webinar_id)) return erro(NAO_ENCONTRADO);
    const id = args.webinar_id;
    const { data } = await db()
      .from("webinars")
      .select("nome, titulo, slug, idioma, apresentador_nome, apresentador_avatar_url, acesso_facilitado, login_na_sala, sincronizar_video")
      .eq("id", id)
      .maybeSingle();
    const atual = data as LinhaInicio | null;
    if (!atual) return erro(NAO_ENCONTRADO);

    const m = mesclarCampos(camposInicio(atual), args, { ignorar: ["webinar_id", "apresentador_avatar_url"] });
    if ("erro" in m) return erro(m.erro);
    const r = validarInicio(m.campos);
    if ("erro" in r) return erro(r.erro);
    const d = r.dados;
    const avatar = urlImagem(args.apresentador_avatar_url, atual.apresentador_avatar_url);
    if ("erro" in avatar) return erro(avatar.erro);

    if (d.slug !== atual.slug) {
      const { data: outro } = await db().from("webinars").select("id").eq("slug", d.slug).neq("id", id).maybeSingle();
      if (outro) return erro("Esse endereço já está em uso.");
    }

    const depois = {
      nome: d.nome,
      titulo: d.titulo,
      slug: d.slug,
      idioma: d.idioma,
      apresentador_nome: d.apresentadorNome,
      apresentador_avatar_url: avatar.url,
      acesso_facilitado: d.acessoFacilitado,
      login_na_sala: d.loginNaSala,
      sincronizar_video: d.sincronizarVideo,
    };
    const { error } = await db().from("webinars").update(depois).eq("id", id);
    if (error) {
      if ((error as { code?: string }).code === "23505") return erro("Esse endereço já está em uso.");
      return erro("Não deu para salvar o início.");
    }
    await auditar(chave, { webinarId: id, acao: "editou", descricao: "Editou o Início", antes: atual, depois });
    return texto({ ok: true, mensagem: "Início salvo.", salvo: depois, link_sala: linkSala(`/${d.slug}`), link_painel: linkPasso(id, "inicio") });
  },
};

// ---------------------------------------------------------------------------
// Passo Agenda
// ---------------------------------------------------------------------------

const mudarTipoAgenda: Ferramenta = {
  name: "mudar_tipo_agenda",
  title: "Mudar o tipo de agenda",
  description:
    "Seletor do topo da Agenda: \"jit\" (just in time: a pessoa escolhe o horário; configure com salvar_jit_config, adicionar_horario_jit e salvar_email_jit) ou \"sessao\" " +
    "(sessão única ou repetição, configurada com salvar_agenda; volta pra repetição que estava salva).",
  inputSchema: esquema({ webinar_id: WEBINAR, tipo: { type: "string", enum: ["jit", "sessao"], description: "jit ou sessao (única/repetição)." } }, ["webinar_id", "tipo"]),
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if (!w) return erro(NAO_ENCONTRADO);
    if (args.tipo !== "jit" && args.tipo !== "sessao") return erro("Escolha o tipo: jit ou sessao.");
    let tipo: "jit" | "unica" | "recorrente" = "jit";
    if (args.tipo === "sessao") {
      const { data: agenda } = await db().from("agendas").select("repeticao").eq("webinar_id", w.id).maybeSingle();
      tipo = ((agenda as { repeticao?: string } | null)?.repeticao ?? "nenhuma") === "nenhuma" ? "unica" : "recorrente";
    }
    if (w.tipo_agenda !== tipo) {
      const { error } = await db().from("webinars").update({ tipo_agenda: tipo }).eq("id", w.id);
      if (error) return erro("Não deu para mudar o tipo da agenda.");
      await auditar(chave, {
        webinarId: w.id,
        acao: "editou",
        descricao: tipo === "jit" ? "Mudou a agenda para just in time" : "Mudou a agenda para sessão única ou repetição",
        antes: { tipo_agenda: w.tipo_agenda },
        depois: { tipo_agenda: tipo },
      });
    }
    return texto({ ok: true, tipo_agenda: tipo, link_painel: linkPasso(w.id, tipo === "jit" ? "agenda/jit" : "agenda") });
  },
};

const salvarAgenda: Ferramenta = {
  name: "salvar_agenda",
  title: "Salvar a agenda (sessão única ou repetição)",
  description:
    "Passo Agenda de um webinar de sessão única ou com repetição (não serve pra just in time: use mudar_tipo_agenda antes). " +
    "Sessão única: repeticao \"nenhuma\" + inicio e fim. Repetição: repeticao \"diaria\", \"dias_uteis\" (segunda a sexta) ou \"semanal\" (+ dia_semana) + hora_inicio e hora_fim, com comeca_em e vigencia_fim opcionais. " +
    "Datas são AAAA-MM-DDTHH:mm no fuso escolhido (não UTC). Atualiza o tipo do webinar (unica/recorrente)." +
    PARCIAL,
  inputSchema: esquema({
    webinar_id: WEBINAR,
    fuso: txt("Fuso IANA (ex.: America/Sao_Paulo, o padrão)."),
    repeticao: { type: "string", enum: ["nenhuma", "diaria", "dias_uteis", "semanal"], description: "nenhuma = sessão única; dias_uteis = segunda a sexta." },
    inicio: txt("Sessão única: início, AAAA-MM-DDTHH:mm no fuso."),
    fim: txt("Sessão única: fim, AAAA-MM-DDTHH:mm no fuso (depois do início)."),
    dia_semana: { type: ["string", "integer"], description: "Semanal: 0 = domingo … 6 = sábado." },
    hora_inicio: txt("Repetição: hora de início HH:mm."),
    hora_fim: txt("Repetição: hora de fim HH:mm (antes do início = fecha no dia seguinte)."),
    comeca_em: txt("Repetição (opcional): AAAA-MM-DD, nenhuma sessão antes dessa data. null tira."),
    vigencia_fim: txt("Repetição (opcional): repetir até AAAA-MM-DDTHH:mm no fuso. null tira."),
    usar_sala_espera: bool("Sala de espera antes do início (desligada numa repetição = fluxo contínuo)."),
  }),
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if (!w) return erro(NAO_ENCONTRADO);
    if (w.tipo_agenda === "jit") return erro("Este webinar está em just in time. Para usar sessão única ou repetição, chame mudar_tipo_agenda com tipo \"sessao\" antes.");

    const { data: atual } = await db()
      .from("agendas")
      .select("fuso, repeticao, inicio, fim, dia_semana, hora_inicio, hora_fim, usar_sala_espera, vigencia_fim")
      .eq("webinar_id", w.id)
      .maybeSingle();
    const m = mesclarCampos(camposAgenda(atual as LinhaAgendaCompleta | null), args, { ignorar: ["webinar_id"] });
    if ("erro" in m) return erro(m.erro);
    const r = validarAgenda(camposAgendaParaEnvio(m.campos));
    if ("erro" in r) return erro(r.erro);
    const d = r.dados;

    const depois = {
      webinar_id: w.id,
      fuso: d.fuso,
      repeticao: d.repeticao,
      inicio: d.inicio?.toISOString() ?? null,
      fim: d.fim?.toISOString() ?? null,
      dia_semana: d.diaSemana,
      hora_inicio: d.horaInicio,
      hora_fim: d.horaFim,
      usar_sala_espera: d.usarSalaEspera,
      vigencia_fim: d.vigenciaFim?.toISOString() ?? null,
    };
    const { error } = await db().from("agendas").upsert(depois, { onConflict: "webinar_id" });
    if (error) return erro("Não deu para salvar a agenda.");
    const { error: erroTipo } = await db().from("webinars").update({ tipo_agenda: d.repeticao === "nenhuma" ? "unica" : "recorrente" }).eq("id", w.id);
    if (erroTipo) return erro("A agenda foi salva, mas não deu para atualizar o tipo do webinar.");
    await auditar(chave, { webinarId: w.id, acao: "editou", descricao: "Editou a agenda", antes: atual as Record<string, unknown> | null, depois });

    const agenda = { fuso: d.fuso, inicio: d.inicio, fim: d.fim, repeticao: d.repeticao, diaSemana: d.diaSemana, horaInicio: d.horaInicio, horaFim: d.horaFim, vigenciaFim: d.vigenciaFim };
    return texto({
      ok: true,
      mensagem: "Agenda salva.",
      salvo: semWebinarId(depois),
      proximas_sessoes: proximasSessoes(agenda, new Date(), 3).map((j) => `${formatarSessao(j.inicio, d.fuso)} até ${formatarHora(j.fim, d.fuso)}`),
      link_painel: linkPasso(w.id, "agenda"),
    });
  },
};

// ---------------------------------------------------------------------------
// Just in time
// ---------------------------------------------------------------------------

const avisoNaoJit = (w: Webinar) =>
  w.tipo_agenda === "jit" ? undefined : "O webinar não está em just in time: isto só vale depois de mudar_tipo_agenda com tipo \"jit\".";

const salvarJitConfig: Ferramenta = {
  name: "salvar_jit_config",
  title: "Salvar a configuração do just in time",
  description:
    "Configuração do just in time: fuso (IANA da lista do painel ou \"participante\" = fuso de quem acessa), esconder horários de madrugada (esconder_de/esconder_ate, horas 0-23, os dois ou nenhum), " +
    "exibição dos horários e data final opcional (AAAA-MM-DDTHH:mm no fuso; \"participante\" → Brasília)." +
    PARCIAL,
  inputSchema: esquema({
    webinar_id: WEBINAR,
    fuso: txt("Fuso IANA (ex.: America/Sao_Paulo) ou \"participante\"."),
    esconder_de: { type: ["string", "integer"], description: "Esconder horários a partir desta hora (0-23). null tira." },
    esconder_ate: { type: ["string", "integer"], description: "Esconder horários até esta hora (0-23). null tira." },
    exibicao: {
      type: "string",
      enum: ["todos", "proximo", "entrar_direto", "proximos_2", "proximos_3", "proximos_4"],
      description: "todos (até 10), proximo, entrar_direto (não escolhe, entra no mais próximo), proximos_2/3/4.",
    },
    fim: txt("Data final opcional AAAA-MM-DDTHH:mm. null tira."),
  }),
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if (!w) return erro(NAO_ENCONTRADO);
    const { data: antes } = await db().from("jit_config").select("fuso, esconder_de, esconder_ate, exibicao, fim").eq("webinar_id", w.id).maybeSingle();
    const m = mesclarCampos(camposConfigJit(antes as LinhaConfigJit | null), args, { ignorar: ["webinar_id"] });
    if ("erro" in m) return erro(m.erro);
    const r = validarConfigJit(m.campos);
    if ("erro" in r) return erro(r.erro);
    const d = r.dados;
    const depois = { webinar_id: w.id, fuso: d.fuso, esconder_de: d.esconderDe, esconder_ate: d.esconderAte, exibicao: d.exibicao, fim: d.fim?.toISOString() ?? null };
    const { error } = await db().from("jit_config").upsert(depois, { onConflict: "webinar_id" });
    if (error) return erro("Não deu para salvar a configuração.");
    await auditar(chave, { webinarId: w.id, acao: "editou", descricao: "Editou a configuração do just in time", antes: antes as Record<string, unknown> | null, depois });
    return texto({ ok: true, mensagem: "Configuração do just in time salva.", salvo: semWebinarId(depois), aviso: avisoNaoJit(w), link_painel: linkPasso(w.id, "agenda/jit") });
  },
};

async function fusoDoJit(webinarId: string): Promise<string> {
  const { data } = await db().from("jit_config").select("fuso").eq("webinar_id", webinarId).maybeSingle();
  return (data as { fuso?: string } | null)?.fuso ?? FUSO_PADRAO_JIT;
}

const adicionarHorarioJit: Ferramenta = {
  name: "adicionar_horario_jit",
  title: "Adicionar horário do just in time",
  description:
    "Adiciona um horário que a pessoa pode escolher (máx. 50, sem repetir). quando: todo_dia (+ hora), a_cada (+ intervalo_min 15/30/45/60), " +
    "data (+ data AAAA-MM-DDTHH:mm no fuso do just in time) ou dia_semana (+ dia_semana 0-6 e hora).",
  inputSchema: esquema(
    {
      webinar_id: WEBINAR,
      quando: { type: "string", enum: ["todo_dia", "a_cada", "data", "dia_semana"], description: "Tipo do horário." },
      hora: txt("HH:mm (todo_dia e dia_semana)."),
      intervalo_min: { type: ["string", "integer"], description: "a_cada: 15, 30, 45 ou 60." },
      data: txt("data: AAAA-MM-DDTHH:mm no fuso do just in time (\"participante\" → Brasília)."),
      dia_semana: { type: ["string", "integer"], description: "dia_semana: 0 = domingo … 6 = sábado." },
    },
    ["webinar_id", "quando"],
  ),
  annotations: CRIA,
  escrita: true,
  async executar(chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if (!w) return erro(NAO_ENCONTRADO);
    const campos = camposDeArgs(args, ["webinar_id"]);
    const fuso = await fusoDoJit(w.id);
    const { data: existentes, error: erroLer } = await db().from("jit_horarios").select("quando, hora, intervalo_min, data, dia_semana").eq("webinar_id", w.id);
    if (erroLer) return erro("Não deu para ler os horários.");
    const r = validarHorariosJit([...((existentes ?? []) as EntradaHorarioJit[]), campos as EntradaHorarioJit], fuso);
    if ("erro" in r) return erro(r.erro);
    const novo = r.dados[r.dados.length - 1];
    const depois = { webinar_id: w.id, ...linhaDeHorario(novo) };
    const { data, error } = await db().from("jit_horarios").insert(depois).select("id").single();
    if (error) return erro("Não deu para adicionar o horário.");
    await auditar(chave, { webinarId: w.id, acao: "criou", descricao: "Adicionou um horário do just in time", depois });
    return texto({ ok: true, id: (data as { id: string } | null)?.id ?? null, descricao: descreverHorario(novo, fuso), aviso: avisoNaoJit(w) });
  },
};

const excluirHorarioJit: Ferramenta = {
  name: "excluir_horario_jit",
  title: "Excluir horário do just in time",
  description: "Exclui um horário do just in time (id em ver_webinar → agenda.horarios). O just in time precisa ficar com pelo menos um horário.",
  inputSchema: esquema({ webinar_id: WEBINAR, horario_id: { type: "string", format: "uuid", description: "Id do horário." } }, ["webinar_id", "horario_id"]),
  annotations: APAGA,
  escrita: true,
  async executar(chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if (!w) return erro(NAO_ENCONTRADO);
    if (!ehUuid(args.horario_id)) return erro("Horário não encontrado.");
    const { data: existentes, error: erroLer } = await db().from("jit_horarios").select("id, quando, hora, intervalo_min, data, dia_semana").eq("webinar_id", w.id);
    if (erroLer) return erro("Não deu para ler os horários.");
    const lista = (existentes ?? []) as { id: string }[];
    const antes = lista.find((h) => h.id === args.horario_id);
    if (!antes) return erro("Horário não encontrado.");
    if (lista.length <= 1) return erro("O just in time precisa de pelo menos um horário. Adicione outro antes de excluir este.");
    const { error } = await db().from("jit_horarios").delete().eq("id", antes.id).eq("webinar_id", w.id);
    if (error) return erro("Não deu para excluir o horário.");
    await auditar(chave, { webinarId: w.id, acao: "excluiu", descricao: "Excluiu um horário do just in time", antes });
    return texto({ ok: true, mensagem: "Horário excluído." });
  },
};

const salvarEmailJit: Ferramenta = {
  name: "salvar_email_jit",
  title: "Salvar e-mail do just in time",
  description:
    "Modelo de um dos 3 e-mails do just in time: inscricao (na hora da inscrição), lembrete (minutos_antes do horário, 5-1440, padrão 60) ou comecando (no horário). " +
    "Texto puro com as variáveis {{nome}}, {{webinar}}, {{data}}, {{hora}}, {{link}} e {{minutos}}. Sem modelo salvo, parte do padrão do idioma." +
    PARCIAL,
  inputSchema: esquema(
    {
      webinar_id: WEBINAR,
      tipo: { type: "string", enum: [...TIPOS_EMAIL], description: "Qual e-mail." },
      remetente_nome: txt("Nome do remetente (até 80, sem < > \" nem quebra de linha)."),
      assunto: txt("Assunto (até 150)."),
      texto: txt("Texto do e-mail (até 5000)."),
      minutos_antes: { type: ["string", "integer"], description: "Só no lembrete: minutos antes do horário (5-1440)." },
    },
    ["webinar_id", "tipo"],
  ),
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if (!w) return erro(NAO_ENCONTRADO);
    if (!(TIPOS_EMAIL as readonly unknown[]).includes(args.tipo)) return erro("Tipo de e-mail inválido.");
    const tipo = args.tipo as TipoEmail;
    const { data: antes } = await db().from("emails_jit").select("tipo, remetente_nome, assunto, modelo, minutos_antes").eq("webinar_id", w.id).eq("tipo", tipo).maybeSingle();
    const padrao = modelosPadrao((w.idioma as Idioma) ?? "pt-BR")[tipo];
    const m = mesclarCampos(camposEmailJit((antes as LinhaEmailJit | null) ?? undefined, padrao), args, { ignorar: ["webinar_id", "tipo"] });
    if ("erro" in m) return erro(m.erro);
    const r = validarEmailJit({ ...m.campos, tipo });
    if ("erro" in r) return erro(r.erro);
    const d = r.dados;
    const depois = { webinar_id: w.id, tipo: d.tipo, remetente_nome: d.remetenteNome, assunto: d.assunto, modelo: { texto: d.texto }, minutos_antes: d.minutosAntes };
    const { error } = await db().from("emails_jit").upsert(depois, { onConflict: "webinar_id,tipo" });
    if (error) return erro("Não deu para salvar o e-mail.");
    await auditar(chave, {
      webinarId: w.id,
      acao: "editou",
      descricao: `Editou o e-mail "${ROTULO_TIPO_EMAIL[d.tipo]}" do just in time`,
      antes: antes as Record<string, unknown> | null,
      depois,
    });
    return texto({ ok: true, mensagem: `E-mail "${ROTULO_TIPO_EMAIL[d.tipo]}" salvo.`, salvo: semWebinarId(depois), aviso: avisoNaoJit(w) });
  },
};

// ---------------------------------------------------------------------------
// Tela de login
// ---------------------------------------------------------------------------

const COR = (o: string) => txt(`${o} em hexadecimal (#rgb ou #rrggbb).`);

const salvarTelaLogin: Ferramenta = {
  name: "salvar_tela_login",
  title: "Salvar a tela de login",
  description:
    "Passo Tela de login: logo, barra de progresso, título (HTML), botão, campos pedidos (e-mail e/ou WhatsApp; pelo menos um obrigatório), país padrão e textos dos campos. " +
    "Sem tela salva, parte do padrão do painel." +
    PARCIAL,
  inputSchema: esquema({
    webinar_id: WEBINAR,
    logo_url: txt(`Logo. ${URL_IMAGEM}`),
    logo_alinhamento: { type: "string", enum: ["esquerda", "centro", "direita"], description: "Alinhamento do logo." },
    logo_largura_total: bool("Logo ocupa a largura toda."),
    barra_ligada: bool("Mostra a barra de progresso."),
    barra_valor: { type: ["string", "integer"], description: "Percentual da barra (0-99)." },
    barra_cor: COR("Cor da barra"),
    barra_cor_texto: COR("Cor do texto da barra"),
    titulo_html: txt("Título acima do formulário, em HTML simples (até 2000)."),
    botao_texto: txt("Texto do botão (até 40)."),
    botao_cor: COR("Cor do botão"),
    botao_cor_texto: COR("Cor do texto do botão"),
    pede_email: bool("Pede e-mail."),
    email_obrigatorio: bool("E-mail obrigatório (liga o pede_email)."),
    pede_telefone: bool("Pede WhatsApp."),
    telefone_obrigatorio: bool("WhatsApp obrigatório (liga o pede_telefone)."),
    pais_padrao: txt("País padrão do WhatsApp, 2 letras (BR)."),
    placeholder_nome: txt("Texto do campo nome (até 60)."),
    placeholder_email: txt("Texto do campo e-mail (até 60)."),
    placeholder_telefone: txt("Texto do campo WhatsApp (até 60)."),
  }),
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if (!w) return erro(NAO_ENCONTRADO);
    const { data } = await db().from("telas_login").select(COLUNAS_TELA_LOGIN).eq("webinar_id", w.id).maybeSingle();
    const atual = data as LinhaTelaLogin | null;
    const m = mesclarCampos(camposTelaLogin(atual), args, { ignorar: ["webinar_id", "logo_url"] });
    if ("erro" in m) return erro(m.erro);
    const r = validarTelaLogin(m.campos);
    if ("erro" in r) return erro(r.erro);
    const d = r.dados;
    const logo = urlImagem(args.logo_url, atual?.logo_url ?? null);
    if ("erro" in logo) return erro(logo.erro);

    const depois = {
      webinar_id: w.id,
      logo_url: logo.url,
      logo_alinhamento: d.logoAlinhamento,
      logo_largura_total: d.logoLarguraTotal,
      barra_ligada: d.barraLigada,
      barra_valor: d.barraValor,
      barra_cor: d.barraCor,
      barra_cor_texto: d.barraCorTexto,
      titulo_html: d.tituloHtml,
      botao_texto: d.botaoTexto,
      botao_cor: d.botaoCor,
      botao_cor_texto: d.botaoCorTexto,
      pede_email: d.pedeEmail,
      email_obrigatorio: d.emailObrigatorio,
      pede_telefone: d.pedeTelefone,
      telefone_obrigatorio: d.telefoneObrigatorio,
      pais_padrao: d.paisPadrao,
      // Colunas NOT NULL: campo limpo volta pro padrão da tabela (igual à action do painel).
      placeholder_nome: d.placeholderNome ?? "Como podemos te chamar",
      placeholder_email: d.placeholderEmail ?? "Seu melhor e-mail",
      placeholder_telefone: d.placeholderTelefone ?? "Seu WhatsApp",
    };
    const { error } = await db().from("telas_login").upsert(depois, { onConflict: "webinar_id" });
    if (error) return erro("Não deu para salvar a tela de login.");
    await auditar(chave, { webinarId: w.id, acao: "editou", descricao: "Editou a tela de login", antes: atual, depois });
    return texto({ ok: true, mensagem: "Tela de login salva.", salvo: semWebinarId(depois), link_painel: linkPasso(w.id, "login") });
  },
};

// ---------------------------------------------------------------------------
// Vídeo
// ---------------------------------------------------------------------------

const listarVideos: Ferramenta = {
  name: "listar_videos",
  title: "Listar vídeos da biblioteca",
  description: "Vídeos da biblioteca (mais recentes primeiro) com id, nome, status (enviando, processando, pronto, erro), duração e origem (bunny ou externo). Só vídeo pronto pode ir pro webinar (definir_video).",
  inputSchema: esquema(
    {
      status: { type: "string", enum: ["pronto", "enviando", "processando", "erro", "todos"], description: "Filtro de status (padrão todos)." },
      busca: txt("Parte do nome (opcional)."),
    },
    [],
  ),
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    let q = db().from("videos").select("id, nome, status, duracao_seg, origem, progresso").order("created_at", { ascending: false }).limit(200);
    if (typeof args.status === "string" && ["pronto", "enviando", "processando", "erro"].includes(args.status)) q = q.eq("status", args.status);
    if (typeof args.busca === "string" && args.busca.trim()) q = q.ilike("nome", `%${escaparIlike(args.busca.trim())}%`);
    const { data, error } = await q;
    if (error) return erro("Não deu para listar os vídeos.");
    const videos = (data ?? []) as { id: string; nome: string; status: string; duracao_seg: number | null; origem: string; progresso: number }[];
    return texto({
      videos: videos.map((v) => ({
        id: v.id,
        nome: v.nome,
        status: v.status,
        duracao: v.duracao_seg !== null ? formatarDuracao(v.duracao_seg) : null,
        duracao_seg: v.duracao_seg,
        origem: v.origem,
        ...(v.status === "enviando" || v.status === "processando" ? { progresso: v.progresso } : {}),
      })),
    });
  },
};

const definirVideo: Ferramenta = {
  name: "definir_video",
  title: "Definir o vídeo do webinar",
  description: "Passo Vídeo: escolhe o vídeo da biblioteca (precisa estar pronto; veja listar_videos), autoplay, tela cheia e formato (horizontal/vertical)." + PARCIAL,
  inputSchema: esquema({
    webinar_id: WEBINAR,
    video_id: { type: "string", format: "uuid", description: "Id do vídeo pronto (listar_videos). Obrigatório se o webinar ainda não tem vídeo." },
    autoplay: bool("Começa sozinho (padrão ligado)."),
    tela_cheia: bool("Abre em tela cheia."),
    orientacao: { type: "string", enum: ["horizontal", "vertical"], description: "Formato do vídeo." },
  }),
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if (!w) return erro(NAO_ENCONTRADO);
    const { data: atual } = await db().from("webinar_video").select("video_id, autoplay, tela_cheia, orientacao").eq("webinar_id", w.id).maybeSingle();
    const m = mesclarCampos(camposVideo(atual as LinhaWebinarVideo | null), args, { ignorar: ["webinar_id"] });
    if ("erro" in m) return erro(m.erro);
    const c = m.campos;
    const videoId = c.video_id.trim();
    const autoplay = c.autoplay === "on";
    const telaCheia = c.tela_cheia === "on";
    const orientacao = c.orientacao || "horizontal";
    if (orientacao !== "horizontal" && orientacao !== "vertical") return erro("Escolha o formato do vídeo.");
    if (!ehUuid(videoId)) return erro("Escolha um vídeo pronto.");
    const { data: video } = await db().from("videos").select("nome, status, duracao_seg").eq("id", videoId).maybeSingle();
    const v = video as { nome: string; status: string; duracao_seg: number | null } | null;
    if (!v || v.status !== "pronto") return erro("Escolha um vídeo pronto.");

    const depois = { webinar_id: w.id, video_id: videoId, autoplay, tela_cheia: telaCheia, orientacao };
    const { error } = await db().from("webinar_video").upsert(depois, { onConflict: "webinar_id" });
    if (error) return erro("Não deu para salvar o vídeo.");
    await auditar(chave, { webinarId: w.id, acao: "editou", descricao: "Editou o vídeo do webinar", antes: atual as Record<string, unknown> | null, depois });
    return texto({
      ok: true,
      mensagem: "Vídeo salvo.",
      salvo: { ...semWebinarId(depois), nome: v.nome, duracao: v.duracao_seg !== null ? formatarDuracao(v.duracao_seg) : null },
      link_painel: linkPasso(w.id, "video"),
    });
  },
};

// ---------------------------------------------------------------------------
// Oferta
// ---------------------------------------------------------------------------

const salvarOferta: Ferramenta = {
  name: "salvar_oferta",
  title: "Salvar a oferta",
  description:
    "Passo Oferta: liga/desliga, nome, título, preços (texto livre, ex.: \"R$ 997\"), botão, link https do checkout, banners, momentos (aparece, some, pitch, contagem regressiva) e sorteio. " +
    "Tempos são no vídeo, em h:mm:ss/mm:ss ou segundos, e não podem passar da duração do vídeo. Ligada exige nome, título e link." +
    PARCIAL,
  inputSchema: esquema({
    webinar_id: WEBINAR,
    ligada: bool("Oferta ligada."),
    nome: txt("Nome do produto."),
    titulo: txt("Título da oferta."),
    preco_original: txt("Preço \"de\" (texto, opcional)."),
    preco_oferta: txt("Preço \"por\" (texto, opcional)."),
    botao_texto: txt("Texto do botão (vazio = \"Quero aproveitar\")."),
    botao_cor: COR("Cor do botão"),
    link: txt("Link https do checkout."),
    repassar_utms: bool("Repassa as UTMs da sala pro link."),
    banner_url: txt(`Banner (desktop). ${URL_IMAGEM}`),
    banner_mobile_url: txt(`Banner no celular. ${URL_IMAGEM}`),
    aparece: tempo("Momento em que a oferta aparece (depois do início)."),
    some: tempo("Momento em que some (vazio/0 = não some)."),
    pitch: tempo("Momento do pitch (opcional; null tira)."),
    contagem: tempo("Duração da contagem regressiva (0 = sem contagem)."),
    contagem_layout: { type: "string", enum: ["classico", "rotulos", "urgente"], description: "Layout da contagem." },
    sorteio_ligado: bool("Sorteio ligado."),
    sorteio_momento: tempo("Momento do sorteio (obrigatório com sorteio ligado)."),
    sorteio_numero: txt("Número sorteado (1 a 6 dígitos)."),
  }),
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if (!w) return erro(NAO_ENCONTRADO);
    const [{ data: videoRow }, { data: atualData }] = await Promise.all([
      db().from("webinar_video").select("videos(duracao_seg)").eq("webinar_id", w.id).maybeSingle(),
      db().from("ofertas").select(COLUNAS_OFERTA).eq("webinar_id", w.id).maybeSingle(),
    ]);
    const duracaoVideoSeg = (videoRow as { videos?: { duracao_seg: number | null } | null } | null)?.videos?.duracao_seg ?? null;
    const atual = atualData as LinhaOferta | null;

    const m = mesclarCampos(camposOferta(atual), args, { ignorar: ["webinar_id", "banner_url", "banner_mobile_url"], tempos: TEMPOS_OFERTA });
    if ("erro" in m) return erro(m.erro);
    const r = validarOferta(m.campos, duracaoVideoSeg);
    if ("erro" in r) return erro(r.erro);
    const d = r.dados;
    const banner = urlImagem(args.banner_url, atual?.banner_url ?? null);
    if ("erro" in banner) return erro(banner.erro);
    const bannerMobile = urlImagem(args.banner_mobile_url, atual?.banner_mobile_url ?? null);
    if ("erro" in bannerMobile) return erro(bannerMobile.erro);

    const depois = {
      webinar_id: w.id,
      ligada: d.ligada,
      nome: d.nome ?? "",
      titulo: d.titulo ?? "",
      preco_original: d.precoOriginal,
      preco_oferta: d.precoOferta,
      botao_texto: d.botaoTexto ?? "Quero aproveitar",
      botao_cor: d.botaoCor,
      banner_url: banner.url,
      banner_mobile_url: bannerMobile.url,
      link: d.link,
      repassar_utms: d.repassarUtms,
      aparece_seg: d.apareceSeg,
      some_seg: d.someSeg,
      pitch_seg: d.pitchSeg,
      contagem_seg: d.contagemSeg,
      contagem_layout: d.contagemLayout,
      sorteio_ligado: d.sorteioLigado,
      sorteio_seg: d.sorteioSeg,
      sorteio_numero: d.sorteioNumero,
    };
    const { error } = await db().from("ofertas").upsert(depois, { onConflict: "webinar_id" });
    if (error) return erro("Não deu para salvar a oferta.");
    await auditar(chave, { webinarId: w.id, acao: "editou", descricao: "Editou a oferta", antes: atual, depois });
    return texto({ ok: true, mensagem: "Oferta salva.", salvo: camposOferta(depois), banner_url: depois.banner_url, banner_mobile_url: depois.banner_mobile_url, link_painel: linkPasso(w.id, "oferta") });
  },
};

// ---------------------------------------------------------------------------
// Audiência
// ---------------------------------------------------------------------------

const salvarAudiencia: Ferramenta = {
  name: "salvar_audiencia",
  title: "Salvar a audiência",
  description:
    "Passo Audiência: contador de pessoas na sala. modo oculto (sem contador), fixo (maximo) ou dinamico (minimo → maximo ao longo do vídeo; até 100000); selo \"ao vivo\"." + PARCIAL,
  inputSchema: esquema({
    webinar_id: WEBINAR,
    modo: { type: "string", enum: ["oculto", "fixo", "dinamico"], description: "Modo do contador." },
    minimo: { type: ["string", "integer"], description: "Dinâmico: mínimo de pessoas." },
    maximo: { type: ["string", "integer"], description: "Fixo: número de pessoas. Dinâmico: máximo." },
    selo_ao_vivo: bool("Mostra o selo \"ao vivo\"."),
  }),
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if (!w) return erro(NAO_ENCONTRADO);
    const { data: atual } = await db().from("audiencias").select("modo, minimo, maximo, selo_ao_vivo").eq("webinar_id", w.id).maybeSingle();
    const m = mesclarCampos(camposAudiencia(atual as LinhaAudiencia | null), args, { ignorar: ["webinar_id"] });
    if ("erro" in m) return erro(m.erro);
    const r = validarAudiencia(m.campos);
    if ("erro" in r) return erro(r.erro);
    const d = r.dados;
    const depois = { webinar_id: w.id, modo: d.modo, minimo: d.minimo, maximo: d.maximo, selo_ao_vivo: d.seloAoVivo };
    const { error } = await db().from("audiencias").upsert(depois, { onConflict: "webinar_id" });
    if (error) return erro("Não deu para salvar a audiência.");
    await auditar(chave, { webinarId: w.id, acao: "editou", descricao: "Editou a audiência", antes: atual as Record<string, unknown> | null, depois });
    return texto({ ok: true, mensagem: "Audiência salva.", salvo: semWebinarId(depois), link_painel: linkPasso(w.id, "video") });
  },
};

// ---------------------------------------------------------------------------
// Upload de imagem
// ---------------------------------------------------------------------------

const prepararUploadImagem: Ferramenta = {
  name: "preparar_upload_imagem",
  title: "Preparar upload de imagem",
  description:
    "Gera uma URL assinada pra subir UMA imagem (JPG, PNG ou WEBP, até 3 MB) no mesmo lugar que o painel guarda logos, avatares e banners. " +
    "Suba o arquivo com PUT na upload_url (exemplo_curl), depois passe a url_publica em logo_url, apresentador_avatar_url, banner_url ou banner_mobile_url. A URL de upload vale 2 horas.",
  inputSchema: esquema(
    { webinar_id: WEBINAR, tipo: { type: "string", enum: ["image/jpeg", "image/png", "image/webp"], description: "Tipo do arquivo." } },
    ["webinar_id", "tipo"],
  ),
  annotations: CRIA,
  escrita: true,
  async executar(_chave, args) {
    const w = await lerWebinar(args.webinar_id);
    if (!w) return erro(NAO_ENCONTRADO);
    const tipo = String(args.tipo ?? "");
    const problema = validarImagem(tipo, 1);
    if (problema) return erro(problema);
    const caminho = caminhoMidia(w.id, tipo, randomUUID());
    const storage = db().storage.from("midias");
    const { data, error } = await storage.createSignedUploadUrl(caminho);
    if (error || !data) return erro("Não deu para preparar o envio da imagem.");
    const { data: publica } = storage.getPublicUrl(caminho);
    const extensao = caminho.split(".").pop();
    return texto({
      upload_url: data.signedUrl,
      metodo: "PUT",
      content_type: tipo,
      url_publica: publica.publicUrl,
      exemplo_curl: `curl -X PUT -H "Content-Type: ${tipo}" --data-binary @imagem.${extensao} "${data.signedUrl}"`,
      limite: "3 MB",
    });
  },
};

export const FERRAMENTAS_WEBINARS: Ferramenta[] = [
  listarWebinars,
  verWebinar,
  criarWebinar,
  duplicarWebinar,
  arquivarWebinar,
  desarquivarWebinar,
  salvarInicio,
  mudarTipoAgenda,
  salvarAgenda,
  salvarJitConfig,
  adicionarHorarioJit,
  excluirHorarioJit,
  salvarEmailJit,
  salvarTelaLogin,
  listarVideos,
  definirVideo,
  ...FERRAMENTAS_TARJAS,
  salvarOferta,
  salvarAudiencia,
  prepararUploadImagem,
];

