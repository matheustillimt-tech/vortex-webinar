import "server-only";
import { cache } from "react";
import { dbAdmin } from "../supabase/admin";
import { lerTudo } from "../supabase/paginar";
import { cacheCurto } from "../cache-curto";
import { bunnyConfig } from "../env";
import { urlsBunny } from "../bunny/cliente";
import { agendaDeLinha, type Agenda, type LinhaAgenda } from "../regras/agenda";
import { formatoDoVideo, sanitizarTitulo } from "../regras/sala";
import type { Idioma } from "../regras/textos-sala";
import type { ConfigJit, HorarioJit } from "../regras/jit";
import type { CorTarja, PosicaoTarja } from "../regras/tarjas";
import { configDeLinha, horarioDeLinha, type LinhaConfigJit, type LinhaHorarioJit } from "../regras/jit-painel";

export type SalaWebinar = {
  id: string;
  status: "ativo" | "arquivado";
  tipoAgenda: "unica" | "recorrente" | "jit";
  acessoFacilitado: boolean;
  loginNaSala: boolean;
  sincronizarVideo: boolean;
  limiteSimultaneo: number | null;
  idioma: Idioma;
  /** Nome do webinar (o título das páginas do editor usa ele quando não há `titulo`). */
  nome: string | null;
  titulo: string | null;
  apresentadorNome: string | null;
  apresentadorAvatarUrl: string | null;
  tituloNotificacaoCompra: string | null;
  pixelMeta: string | null;
  pixelTiktok: string | null;
  gtm: string | null;
  scriptPersonalizado: string | null;
  compartilharTitulo: string | null;
  compartilharDescricao: string | null;
  compartilharImagemUrl: string | null;
};

export type SalaTelaLogin = {
  logoUrl: string | null;
  logoAlinhamento: "esquerda" | "centro" | "direita";
  logoLarguraTotal: boolean;
  barraLigada: boolean;
  barraValor: number;
  barraCor: string;
  barraCorTexto: string;
  tituloHtml: string | null;
  botaoTexto: string;
  botaoCor: string;
  botaoCorTexto: string;
  pedeEmail: boolean;
  emailObrigatorio: boolean;
  pedeTelefone: boolean;
  telefoneObrigatorio: boolean;
  paisPadrao: string;
  placeholderNome: string;
  placeholderEmail: string;
  placeholderTelefone: string;
};

const TELA_LOGIN_PADRAO: SalaTelaLogin = {
  logoUrl: null,
  logoAlinhamento: "centro",
  logoLarguraTotal: true,
  barraLigada: true,
  barraValor: 92,
  barraCor: "#0a8452",
  barraCorTexto: "#ffffff",
  tituloHtml: null,
  botaoTexto: "Assistir transmissão",
  botaoCor: "#007509",
  botaoCorTexto: "#ffffff",
  pedeEmail: true,
  emailObrigatorio: true,
  pedeTelefone: false,
  telefoneObrigatorio: false,
  paisPadrao: "BR",
  placeholderNome: "Como podemos te chamar",
  placeholderEmail: "Seu melhor e-mail",
  placeholderTelefone: "Seu WhatsApp",
};

export type SalaVideo = {
  url: string;
  formato: "hls" | "mp4";
  duracaoSeg: number;
  autoplay: boolean;
  telaCheia: boolean;
  orientacao: "horizontal" | "vertical";
  /** Fundo do player enquanto a pessoa não tocou pra ouvir: a prévia animada do começo da aula (vídeo do Bunny) ou a
   *  miniatura (externo). No iPhone em modo de pouca energia o autoplay mudo é bloqueado e, sem ela, a pessoa via uma
   *  tela preta em vez da aula "rodando" — imagem animada toca mesmo assim. */
  capa: string | null;
} | null;

export type SalaOferta = {
  ligada: boolean;
  titulo: string;
  precoOriginal: string | null;
  precoOferta: string | null;
  botaoTexto: string;
  botaoCor: string;
  bannerUrl: string | null;
  bannerMobileUrl: string | null;
  link: string | null;
  repassarUtms: boolean;
  apareceSeg: number;
  someSeg: number;
  pitchSeg: number | null;
  contagemSeg: number;
  contagemLayout: "classico" | "rotulos" | "urgente";
  sorteioLigado: boolean;
  sorteioSeg: number | null;
  sorteioNumero: string | null;
} | null;

export type SalaAudiencia = {
  modo: "oculto" | "fixo" | "dinamico";
  minimo: number | null;
  maximo: number | null;
  seloAoVivo: boolean;
} | null;

/** Tarja de aviso ligada (só os campos que a sala usa). */
export type SalaTarja = { texto: string; apareceSeg: number; duracaoSeg: number; posicao: PosicaoTarja; cor: CorTarja };

/** Horários e configuração do just in time (só quando `tipoAgenda = "jit"`; nada sensível). */
export type SalaJit = { horarios: HorarioJit[]; config: ConfigJit };

export type Sala = {
  webinar: SalaWebinar;
  agenda: Agenda | null;
  jit: SalaJit | null;
  telaLogin: SalaTelaLogin;
  video: SalaVideo;
  oferta: SalaOferta;
  audiencia: SalaAudiencia;
  /** Tarjas de aviso ligadas, em ordem de `apareceSeg`. */
  tarjas: SalaTarja[];
};

// Linhas como vêm do Postgres (snake_case) ------------------------------------------------------------------------

type LinhaWebinar = {
  id: string;
  status: "ativo" | "arquivado";
  tipo_agenda: "unica" | "recorrente" | "jit";
  acesso_facilitado: boolean;
  login_na_sala: boolean;
  sincronizar_video: boolean;
  limite_simultaneo: number | null;
  idioma: Idioma;
  nome?: string | null;
  titulo: string | null;
  apresentador_nome: string | null;
  apresentador_avatar_url: string | null;
  titulo_notificacao_compra: string | null;
  pixel_meta: string | null;
  pixel_tiktok: string | null;
  gtm: string | null;
  script_personalizado: string | null;
  compartilhar_titulo: string | null;
  compartilhar_descricao: string | null;
  compartilhar_imagem_url: string | null;
};

function webinarDeLinha(l: LinhaWebinar): SalaWebinar {
  return {
    id: l.id,
    status: l.status,
    tipoAgenda: l.tipo_agenda ?? "unica",
    acessoFacilitado: l.acesso_facilitado,
    loginNaSala: l.login_na_sala,
    sincronizarVideo: l.sincronizar_video,
    limiteSimultaneo: l.limite_simultaneo,
    idioma: l.idioma,
    nome: l.nome ?? null,
    titulo: l.titulo,
    apresentadorNome: l.apresentador_nome,
    apresentadorAvatarUrl: l.apresentador_avatar_url,
    tituloNotificacaoCompra: l.titulo_notificacao_compra,
    pixelMeta: l.pixel_meta,
    pixelTiktok: l.pixel_tiktok,
    gtm: l.gtm,
    scriptPersonalizado: l.script_personalizado,
    compartilharTitulo: l.compartilhar_titulo,
    compartilharDescricao: l.compartilhar_descricao,
    compartilharImagemUrl: l.compartilhar_imagem_url,
  };
}

type LinhaTelaLogin = {
  logo_url: string | null;
  logo_alinhamento: "esquerda" | "centro" | "direita";
  logo_largura_total: boolean;
  barra_ligada: boolean;
  barra_valor: number;
  barra_cor: string;
  barra_cor_texto: string;
  titulo_html: string | null;
  botao_texto: string;
  botao_cor: string;
  botao_cor_texto: string;
  pede_email: boolean;
  email_obrigatorio: boolean;
  pede_telefone: boolean;
  telefone_obrigatorio: boolean;
  pais_padrao: string;
  placeholder_nome: string;
  placeholder_email: string;
  placeholder_telefone: string;
};

function telaLoginDeLinha(l: LinhaTelaLogin | null): SalaTelaLogin {
  if (!l) return TELA_LOGIN_PADRAO;
  return {
    logoUrl: l.logo_url,
    logoAlinhamento: l.logo_alinhamento,
    logoLarguraTotal: l.logo_largura_total,
    barraLigada: l.barra_ligada,
    barraValor: l.barra_valor,
    barraCor: l.barra_cor,
    barraCorTexto: l.barra_cor_texto,
    tituloHtml: l.titulo_html ? sanitizarTitulo(l.titulo_html) : null,
    botaoTexto: l.botao_texto,
    botaoCor: l.botao_cor,
    botaoCorTexto: l.botao_cor_texto,
    pedeEmail: l.pede_email,
    emailObrigatorio: l.email_obrigatorio,
    pedeTelefone: l.pede_telefone,
    telefoneObrigatorio: l.telefone_obrigatorio,
    paisPadrao: l.pais_padrao,
    placeholderNome: l.placeholder_nome,
    placeholderEmail: l.placeholder_email,
    placeholderTelefone: l.placeholder_telefone,
  };
}

type LinhaWebinarVideo = { video_id: string; autoplay: boolean; tela_cheia: boolean; orientacao: "horizontal" | "vertical" };
type LinhaVideo = { origem: "bunny" | "externo"; bunny_guid: string | null; hls_url: string | null; duracao_seg: number | null; thumb_url?: string | null };

function videoDaSala(webinarId: string, wv: LinhaWebinarVideo | null, v: LinhaVideo | null): SalaVideo {
  if (!wv || !v) return null;

  let url: string;
  let formato: "hls" | "mp4";
  if (v.origem === "bunny") {
    const cfg = bunnyConfig();
    if (!cfg) {
      console.error("sala/dados: vídeo do Bunny sem BUNNY_STREAM_* configurado — sala fica sem vídeo.");
      return null;
    }
    if (!v.bunny_guid) {
      console.error("sala/dados: vídeo do Bunny sem bunny_guid — sala fica sem vídeo.");
      return null;
    }
    url = urlsBunny(cfg, v.bunny_guid, null).hls;
    formato = "hls";
  } else {
    if (!v.hls_url) return null;
    url = v.hls_url;
    formato = formatoDoVideo(url);
  }

  return {
    url,
    formato,
    duracaoSeg: v.duracao_seg ?? 0,
    autoplay: wv.autoplay,
    telaCheia: wv.tela_cheia,
    orientacao: wv.orientacao,
    // Bunny: a prévia animada do começo da aula, pelo domínio da sala (`/api/sala/capa`); externo: a miniatura.
    capa: v.origem === "bunny" ? `/api/sala/capa/${webinarId}` : v.thumb_url && /^https:\/\//i.test(v.thumb_url) ? v.thumb_url : null,
  };
}

type LinhaOferta = {
  ligada: boolean;
  titulo: string;
  preco_original: string | null;
  preco_oferta: string | null;
  botao_texto: string;
  botao_cor: string;
  banner_url: string | null;
  banner_mobile_url: string | null;
  link: string | null;
  repassar_utms: boolean;
  aparece_seg: number;
  some_seg: number;
  pitch_seg: number | null;
  contagem_seg: number;
  contagem_layout: "classico" | "rotulos" | "urgente";
  sorteio_ligado: boolean;
  sorteio_seg: number | null;
  sorteio_numero: string | null;
};

function ofertaDeLinha(l: LinhaOferta): NonNullable<SalaOferta> {
  return {
    ligada: l.ligada,
    titulo: l.titulo,
    precoOriginal: l.preco_original,
    precoOferta: l.preco_oferta,
    botaoTexto: l.botao_texto,
    botaoCor: l.botao_cor,
    bannerUrl: l.banner_url,
    bannerMobileUrl: l.banner_mobile_url,
    link: l.link,
    repassarUtms: l.repassar_utms,
    apareceSeg: l.aparece_seg,
    someSeg: l.some_seg,
    pitchSeg: l.pitch_seg,
    contagemSeg: l.contagem_seg,
    contagemLayout: l.contagem_layout,
    sorteioLigado: l.sorteio_ligado,
    sorteioSeg: l.sorteio_seg,
    sorteioNumero: l.sorteio_numero,
  };
}

type LinhaAudiencia = { modo: "oculto" | "fixo" | "dinamico"; minimo: number | null; maximo: number | null; selo_ao_vivo: boolean };

function audienciaDeLinha(l: LinhaAudiencia): NonNullable<SalaAudiencia> {
  return { modo: l.modo, minimo: l.minimo, maximo: l.maximo, seloAoVivo: l.selo_ao_vivo };
}

type LinhaTarja = { texto: string; aparece_seg: number; duracao_seg: number; posicao: PosicaoTarja; cor: CorTarja };

function tarjaDeLinha(l: LinhaTarja): SalaTarja {
  return { texto: l.texto, apareceSeg: l.aparece_seg, duracaoSeg: l.duracao_seg, posicao: l.posicao, cor: l.cor };
}

/** Configuração da sala muda pouco e é a mesma pra todo mundo: cada instância guarda por 10 s (ver `cacheCurto`).
 *  Uma edição no painel (ou arquivar o webinar) leva até 10 s pra chegar na sala. Só guarda a sala montada sem
 *  nenhum erro de consulta, e nunca o "não existe" (um webinar recém-criado aparece na hora). */
const TTL_SALA_MS = 10_000;

type SalaMontada = { sala: Sala | null; completa: boolean };

const salaPorSlug = cacheCurto<SalaMontada>((slug) => carregarSalaDoBanco("slug", slug), {
  ttlMs: TTL_SALA_MS,
  guardar: (r) => r.completa && r.sala !== null,
});
const salaPorId = cacheCurto<SalaMontada>((id) => carregarSalaDoBanco("id", id), {
  ttlMs: TTL_SALA_MS,
  guardar: (r) => r.completa && r.sala !== null,
});

/** Esvazia o cache da sala desta instância (testes). */
export function limparCacheSala(): void {
  salaPorSlug.limpar();
  salaPorId.limpar();
}

async function carregarSalaDoBanco(coluna: "slug" | "id", valor: string): Promise<SalaMontada> {
  const db = dbAdmin();
  const { data: linhaWebinar, error: erroWebinar } = await db.from("webinars").select("*").eq(coluna, valor).maybeSingle();
  if (erroWebinar) {
    const rotulo = coluna === "slug" ? `do slug "${valor}"` : `"${valor}"`;
    console.error(`sala/dados: erro ao carregar o webinar ${rotulo}: ${(erroWebinar as { message?: string }).message ?? erroWebinar}`);
  }
  if (!linhaWebinar) return { sala: null, completa: !erroWebinar };
  return montarSala(db, linhaWebinar as LinhaWebinar);
}

/** Dados completos da sala pública, a partir do slug. `null` quando o webinar não existe. Com cache curto por
 *  instância (até 10 s de atraso para uma edição do painel aparecer). O objeto devolvido é compartilhado entre
 *  requests: só leitura. */
export async function carregarSala(slug: string): Promise<Sala | null> {
  return (await salaPorSlug(slug)).sala;
}

/** Como `carregarSala`, mas a partir do id do webinar (as APIs da sala só têm o id, nunca o slug — ele é o
 *  caminho público). `null` quando o webinar não existe. Mesmo cache curto. */
export async function carregarSalaPorId(webinarId: string): Promise<Sala | null> {
  return (await salaPorId(webinarId)).sala;
}

async function montarSala(db: ReturnType<typeof dbAdmin>, linhaWebinar: LinhaWebinar): Promise<SalaMontada> {
  const erros: unknown[] = [];
  const webinarId = linhaWebinar.id;

  const consultas = await Promise.all([
    db.from("agendas").select("*").eq("webinar_id", webinarId).maybeSingle(),
    db.from("telas_login").select("*").eq("webinar_id", webinarId).maybeSingle(),
    db.from("webinar_video").select("*").eq("webinar_id", webinarId).maybeSingle(),
    db.from("ofertas").select("*").eq("webinar_id", webinarId).maybeSingle(),
    db.from("audiencias").select("*").eq("webinar_id", webinarId).maybeSingle(),
  ]);
  const [{ data: linhaAgenda }, { data: linhaTelaLogin }, { data: linhaWebinarVideo }, { data: linhaOferta }, { data: linhaAudiencia }] = consultas;
  for (const c of consultas) if (c.error) erros.push(c.error);

  let linhaVideo: LinhaVideo | null = null;
  if (linhaWebinarVideo) {
    const { data, error } = await db.from("videos").select("*").eq("id", (linhaWebinarVideo as LinhaWebinarVideo).video_id).maybeSingle();
    if (error) erros.push(error);
    linhaVideo = (data as LinhaVideo | null) ?? null;
  }

  let jit: SalaJit | null = null;
  if (linhaWebinar.tipo_agenda === "jit") {
    const [{ data: linhasHorarios, error: erroHorarios }, { data: linhaConfig, error: erroConfig }] = await Promise.all([
      db.from("jit_horarios").select("quando, hora, intervalo_min, data, dia_semana").eq("webinar_id", webinarId).order("created_at"),
      db.from("jit_config").select("fuso, esconder_de, esconder_ate, exibicao, fim").eq("webinar_id", webinarId).maybeSingle(),
    ]);
    if (erroHorarios) erros.push(erroHorarios);
    if (erroConfig) erros.push(erroConfig);
    jit = {
      horarios: ((linhasHorarios ?? []) as LinhaHorarioJit[]).map(horarioDeLinha),
      config: configDeLinha((linhaConfig as LinhaConfigJit | null) ?? null),
    };
  }

  // Tarjas: só as ligadas (no máximo 20 por webinar, então uma consulta basta).
  const { data: linhasTarjas, error: erroTarjas } = await db
    .from("tarjas_aviso")
    .select("texto, aparece_seg, duracao_seg, posicao, cor")
    .eq("webinar_id", webinarId)
    .eq("ligada", true)
    .order("aparece_seg", { ascending: true });
  if (erroTarjas) erros.push(erroTarjas);

  const sala: Sala = {
    webinar: webinarDeLinha(linhaWebinar),
    agenda: linhaAgenda ? agendaDeLinha(linhaAgenda as LinhaAgenda) : null,
    jit,
    telaLogin: telaLoginDeLinha((linhaTelaLogin as LinhaTelaLogin | null) ?? null),
    video: videoDaSala(webinarId, (linhaWebinarVideo as LinhaWebinarVideo | null) ?? null, linhaVideo),
    oferta: linhaOferta ? ofertaDeLinha(linhaOferta as LinhaOferta) : null,
    audiencia: linhaAudiencia ? audienciaDeLinha(linhaAudiencia as LinhaAudiencia) : null,
    tarjas: ((linhasTarjas ?? []) as LinhaTarja[]).map(tarjaDeLinha),
  };
  return { sala, completa: erros.length === 0 };
}

/** `carregarSala` com cache por requisição (React `cache`): o layout e a página da sala pública carregam a mesma
 *  sala sem duplicar a consulta ao Supabase. */
export const carregarSalaCached = cache(carregarSala);

/** Conta sessões com sinal de vida nos últimos 60 s. Sem `limite` configurado, a sala nunca fica cheia. */
export async function salaCheia(webinarId: string, limite: number | null, agora: Date): Promise<boolean> {
  if (limite === null) return false;
  const desde = new Date(agora.getTime() - 60_000).toISOString();
  const { count } = await dbAdmin()
    .from("sessoes")
    .select("id", { count: "exact", head: true })
    .eq("webinar_id", webinarId)
    .gt("ultimo_sinal_em", desde);
  return (count ?? 0) >= limite;
}

export type MinhaMensagem = {
  id: string;
  autor: "participante" | "atendente" | "chatbot" | "ia";
  texto: string | null;
  imagemUrl: string | null;
  criadaEm: string;
  /** Apagada pelo atendente: `texto`/`imagemUrl` vêm nulos (o banco guarda o original pra auditoria). */
  apagada: boolean;
  /** Nome a mostrar nas respostas antigas do chatbot (descontinuado; a página da sala põe "Suporte"). */
  nomeExibicao?: string;
};

type LinhaMinhaMensagem = {
  id: string;
  autor: "participante" | "atendente" | "chatbot" | "ia";
  texto: string | null;
  imagem_url: string | null;
  apagada: boolean;
  created_at: string;
};

/** Mensagens privadas (`mensagens_suporte`) da própria sessão, em ordem — a sala põe elas de volta no chat
 *  (as novas chegam depois por polling, `GET /api/sala/suporte`). Apagada vem sem conteúdo. */
export async function carregarMinhasMensagens(sessaoId: string): Promise<MinhaMensagem[]> {
  const { data } = await dbAdmin()
    .from("mensagens_suporte")
    .select("id, autor, texto, imagem_url, apagada, created_at")
    .eq("sessao_id", sessaoId)
    .order("created_at", { ascending: true });
  return ((data ?? []) as LinhaMinhaMensagem[]).map((l) => ({
    id: l.id,
    autor: l.autor,
    texto: l.apagada ? null : l.texto,
    imagemUrl: l.apagada ? null : l.imagem_url,
    criadaEm: l.created_at,
    apagada: l.apagada,
  }));
}
