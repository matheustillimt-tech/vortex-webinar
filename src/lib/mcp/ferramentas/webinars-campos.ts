import { agendaDeLinha, type LinhaAgenda } from "@/src/lib/regras/agenda";
import type { ModeloEmail } from "@/src/lib/regras/emails";
import { FUSOS, utcParaLocal } from "@/src/lib/regras/fuso";
import { configDeLinha, fusoDoPainelJit, modeloDeLinha, type LinhaConfigJit, type LinhaEmailJit } from "@/src/lib/regras/jit-painel";
import { formatarDuracao } from "@/src/lib/regras/video";

/**
 * Linha do banco → campos do formulário de cada passo (os MESMOS nomes e formatos que o painel preenche nas páginas
 * `app/(painel)/webinars/[id]/<passo>/page.tsx`). É a base da "atualização parcial" do MCP: lê a linha atual,
 * converte com estas funções, sobrepõe só o que veio nos argumentos (`mesclarCampos`) e passa o formulário inteiro
 * pro validador do painel. Puro (sem banco), pra dar pra testar.
 */

export type Campos = Record<string, string>;

const on = (v: boolean | null | undefined) => (v ? "on" : "");

// ---------------------------------------------------------------------------
// Mesclagem
// ---------------------------------------------------------------------------

export type ResultadoMescla = { campos: Campos } | { erro: string };

/** Sobrepõe os `args` do MCP nos campos atuais. Booleano vira "on"/"" (checkbox; `false` desliga, ao contrário de
 *  `camposDeArgs`, que só omite), número vira texto (nos campos de `tempos`, segundos viram h:mm:ss), `null` limpa
 *  ("") e `undefined` mantém. Campo que o formulário não tem → erro (pega erro de digitação do nome). */
export function mesclarCampos(
  atuais: Campos,
  args: Record<string, unknown>,
  opcoes: { ignorar?: string[]; tempos?: string[] } = {},
): ResultadoMescla {
  const ignorar = opcoes.ignorar ?? [];
  const tempos = opcoes.tempos ?? [];
  const campos = { ...atuais };
  for (const [k, v] of Object.entries(args)) {
    if (ignorar.includes(k) || v === undefined) continue;
    if (!(k in atuais)) return { erro: `Campo desconhecido: ${k}.` };
    if (v === null) campos[k] = "";
    else if (typeof v === "boolean") campos[k] = on(v);
    else if (typeof v === "number") {
      if (!Number.isFinite(v)) return { erro: `Valor inválido em ${k}.` };
      campos[k] = tempos.includes(k) ? formatarDuracao(Math.max(0, Math.floor(v))) : String(v);
    } else if (typeof v === "string") campos[k] = v;
    else return { erro: `Valor inválido em ${k}.` };
  }
  return { campos };
}

/** URL de imagem já hospedada (logo, avatar, banner): `undefined` mantém a atual, `null`/"" tira, https troca. */
export function urlImagem(v: unknown, atual: string | null): { url: string | null } | { erro: string } {
  if (v === undefined) return { url: atual };
  if (v === null || (typeof v === "string" && v.trim() === "")) return { url: null };
  if (typeof v !== "string") return { erro: "Use um link https da imagem." };
  try {
    if (new URL(v.trim()).protocol === "https:") return { url: v.trim() };
  } catch {
    // cai no erro abaixo
  }
  return { erro: "Use um link https da imagem (ou suba o arquivo com preparar_upload_imagem)." };
}

// ---------------------------------------------------------------------------
// Passo Início (tabela webinars)
// ---------------------------------------------------------------------------

export type LinhaInicio = {
  nome: string;
  titulo: string | null;
  slug: string;
  idioma: string;
  apresentador_nome: string | null;
  apresentador_avatar_url: string | null;
  acesso_facilitado: boolean;
  login_na_sala: boolean;
  sincronizar_video: boolean;
};

export function camposInicio(w: LinhaInicio): Campos {
  return {
    nome: w.nome,
    titulo: w.titulo ?? "",
    slug: w.slug,
    idioma: w.idioma,
    apresentador_nome: w.apresentador_nome ?? "",
    acesso_facilitado: on(w.acesso_facilitado),
    login_na_sala: on(w.login_na_sala),
    sincronizar_video: on(w.sincronizar_video),
  };
}

// ---------------------------------------------------------------------------
// Passo Agenda (sessão única / repetição)
// ---------------------------------------------------------------------------

export type LinhaAgendaCompleta = LinhaAgenda & { usar_sala_espera: boolean };

/** Sem agenda salva: fuso padrão, sessão única, sala de espera ligada e o resto em branco (sem inventar horário). */
export function camposAgenda(l: LinhaAgendaCompleta | null): Campos {
  if (!l)
    return {
      fuso: FUSOS[0].valor,
      repeticao: "nenhuma",
      inicio: "",
      fim: "",
      dia_semana: "",
      hora_inicio: "",
      hora_fim: "",
      comeca_em: "",
      vigencia_fim: "",
      usar_sala_espera: "on",
    };
  const a = agendaDeLinha(l);
  const recorrente = a.repeticao !== "nenhuma";
  const inicioLocal = a.inicio ? utcParaLocal(a.inicio, a.fuso) : "";
  return {
    fuso: a.fuso,
    repeticao: a.repeticao,
    inicio: recorrente ? "" : inicioLocal,
    fim: !recorrente && a.fim ? utcParaLocal(a.fim, a.fuso) : "",
    dia_semana: a.diaSemana !== null ? String(a.diaSemana) : "",
    hora_inicio: a.horaInicio ?? "",
    hora_fim: a.horaFim ?? "",
    // Numa agenda com repetição, `inicio` guarda o "Começar em" (meia-noite do dia, no fuso).
    comeca_em: recorrente ? inicioLocal.slice(0, 10) : "",
    vigencia_fim: a.vigenciaFim ? utcParaLocal(a.vigenciaFim, a.fuso) : "",
    usar_sala_espera: on(l.usar_sala_espera),
  };
}

/** Só os campos que o formulário do painel envia em cada modo: sessão única não manda "Começar em" nem "Repetir
 *  até"; repetição não manda início/fim; dia da semana só no semanal. */
export function camposAgendaParaEnvio(c: Campos): Campos {
  const r = { ...c };
  if (r.repeticao === "nenhuma") {
    delete r.comeca_em;
    delete r.vigencia_fim;
    delete r.dia_semana;
    delete r.hora_inicio;
    delete r.hora_fim;
  } else {
    delete r.inicio;
    delete r.fim;
    if (r.repeticao !== "semanal") delete r.dia_semana;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Just in time
// ---------------------------------------------------------------------------

export function camposConfigJit(l: LinhaConfigJit | null): Campos {
  const cfg = configDeLinha(l);
  return {
    fuso: cfg.fuso,
    esconder_de: cfg.esconderDe === null ? "" : String(cfg.esconderDe),
    esconder_ate: cfg.esconderAte === null ? "" : String(cfg.esconderAte),
    exibicao: cfg.exibicao,
    fim: cfg.fim ? utcParaLocal(cfg.fim, fusoDoPainelJit(cfg.fuso)) : "",
  };
}

/** E-mail do JIT: o salvo ou o modelo padrão do idioma (o mesmo que o cartão do painel mostra). */
export function camposEmailJit(l: LinhaEmailJit | undefined, padrao: ModeloEmail): Campos {
  const m = modeloDeLinha(l, padrao);
  return {
    remetente_nome: m.remetenteNome,
    assunto: m.assunto,
    texto: m.texto,
    minutos_antes: m.minutosAntes === null ? "" : String(m.minutosAntes),
  };
}

// ---------------------------------------------------------------------------
// Tela de login
// ---------------------------------------------------------------------------

export type LinhaTelaLogin = {
  logo_url: string | null;
  logo_alinhamento: string;
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

export const COLUNAS_TELA_LOGIN =
  "logo_url, logo_alinhamento, logo_largura_total, barra_ligada, barra_valor, barra_cor, barra_cor_texto, titulo_html, botao_texto, botao_cor, botao_cor_texto, pede_email, email_obrigatorio, pede_telefone, telefone_obrigatorio, pais_padrao, placeholder_nome, placeholder_email, placeholder_telefone";

/** Defaults da tabela `telas_login` (iguais aos da página do painel), quando a linha ainda não existe. */
export const PADRAO_TELA_LOGIN: LinhaTelaLogin = {
  logo_url: null,
  logo_alinhamento: "centro",
  logo_largura_total: true,
  barra_ligada: true,
  barra_valor: 92,
  barra_cor: "#0a8452",
  barra_cor_texto: "#ffffff",
  titulo_html: null,
  botao_texto: "Assistir transmissão",
  botao_cor: "#007509",
  botao_cor_texto: "#ffffff",
  pede_email: true,
  email_obrigatorio: true,
  pede_telefone: false,
  telefone_obrigatorio: false,
  pais_padrao: "BR",
  placeholder_nome: "Como podemos te chamar",
  placeholder_email: "Seu melhor e-mail",
  placeholder_telefone: "Seu WhatsApp",
};

export function camposTelaLogin(l: LinhaTelaLogin | null): Campos {
  const t = l ?? PADRAO_TELA_LOGIN;
  return {
    logo_alinhamento: t.logo_alinhamento,
    logo_largura_total: on(t.logo_largura_total),
    barra_ligada: on(t.barra_ligada),
    barra_valor: String(t.barra_valor),
    barra_cor: t.barra_cor,
    barra_cor_texto: t.barra_cor_texto,
    titulo_html: t.titulo_html ?? "",
    botao_texto: t.botao_texto,
    botao_cor: t.botao_cor,
    botao_cor_texto: t.botao_cor_texto,
    pede_email: on(t.pede_email),
    email_obrigatorio: on(t.email_obrigatorio),
    pede_telefone: on(t.pede_telefone),
    telefone_obrigatorio: on(t.telefone_obrigatorio),
    pais_padrao: t.pais_padrao,
    placeholder_nome: t.placeholder_nome,
    placeholder_email: t.placeholder_email,
    placeholder_telefone: t.placeholder_telefone,
  };
}

// ---------------------------------------------------------------------------
// Oferta
// ---------------------------------------------------------------------------

export type LinhaOferta = {
  ligada: boolean;
  nome: string;
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
  contagem_layout: string;
  sorteio_ligado: boolean;
  sorteio_seg: number | null;
  sorteio_numero: string | null;
};

export const COLUNAS_OFERTA =
  "ligada, nome, titulo, preco_original, preco_oferta, botao_texto, botao_cor, banner_url, banner_mobile_url, link, repassar_utms, aparece_seg, some_seg, pitch_seg, contagem_seg, contagem_layout, sorteio_ligado, sorteio_seg, sorteio_numero";

/** Defaults da tabela `ofertas` (iguais aos da página do painel), quando a linha ainda não existe. */
export const PADRAO_OFERTA: LinhaOferta = {
  ligada: true,
  nome: "",
  titulo: "",
  preco_original: null,
  preco_oferta: null,
  botao_texto: "Quero aproveitar",
  botao_cor: "#02890b",
  banner_url: null,
  banner_mobile_url: null,
  link: null,
  repassar_utms: false,
  aparece_seg: 60,
  some_seg: 0,
  pitch_seg: null,
  contagem_seg: 300,
  contagem_layout: "classico",
  sorteio_ligado: false,
  sorteio_seg: null,
  sorteio_numero: null,
};

/** Campos de tempo da oferta (h:mm:ss ou mm:ss; aceitam segundos inteiros no MCP). */
export const TEMPOS_OFERTA = ["aparece", "some", "pitch", "contagem", "sorteio_momento"];

export function camposOferta(l: LinhaOferta | null): Campos {
  const o = l ?? PADRAO_OFERTA;
  return {
    ligada: on(o.ligada),
    nome: o.nome,
    titulo: o.titulo,
    preco_original: o.preco_original ?? "",
    preco_oferta: o.preco_oferta ?? "",
    botao_texto: o.botao_texto,
    botao_cor: o.botao_cor,
    link: o.link ?? "",
    repassar_utms: on(o.repassar_utms),
    aparece: formatarDuracao(o.aparece_seg),
    some: o.some_seg === 0 ? "" : formatarDuracao(o.some_seg),
    pitch: o.pitch_seg !== null ? formatarDuracao(o.pitch_seg) : "",
    contagem: formatarDuracao(o.contagem_seg),
    contagem_layout: o.contagem_layout,
    sorteio_ligado: on(o.sorteio_ligado),
    sorteio_momento: o.sorteio_seg !== null ? formatarDuracao(o.sorteio_seg) : "",
    sorteio_numero: o.sorteio_numero ?? "",
  };
}

// ---------------------------------------------------------------------------
// Audiência e vídeo
// ---------------------------------------------------------------------------

export type LinhaAudiencia = { modo: string; minimo: number | null; maximo: number | null; selo_ao_vivo: boolean };

export function camposAudiencia(l: LinhaAudiencia | null): Campos {
  const a = l ?? { modo: "oculto", minimo: null, maximo: null, selo_ao_vivo: true };
  return {
    modo: a.modo,
    minimo: a.minimo !== null ? String(a.minimo) : "",
    maximo: a.maximo !== null ? String(a.maximo) : "",
    selo_ao_vivo: on(a.selo_ao_vivo),
  };
}

export type LinhaWebinarVideo = { video_id: string; autoplay: boolean; tela_cheia: boolean; orientacao: string };

export function camposVideo(l: LinhaWebinarVideo | null): Campos {
  return {
    video_id: l?.video_id ?? "",
    autoplay: on(l?.autoplay ?? true),
    tela_cheia: on(l?.tela_cheia ?? false),
    orientacao: l?.orientacao ?? "horizontal",
  };
}
