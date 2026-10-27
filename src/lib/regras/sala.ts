import sanitizeHtml from "sanitize-html";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { paraE164 } from "./telefone";
import { validarUrlVideo } from "./video";

const CAMPOS_LINK_MAGICO = ["nome", "email", "telefone"] as const;

/** Placeholder não preenchido pela plataforma de e-mail (ex.: `{{nome}}` sem substituição, ou o próprio nome da
 *  variável sem chaves). */
function ehPlaceholder(valor: string): boolean {
  const v = valor.trim();
  if (!v) return true;
  if (v.includes("{") || v.includes("}")) return true;
  const norm = v.toLowerCase();
  return (
    norm === "nome" ||
    norm === "email" ||
    norm === "telefone" ||
    norm === "nome_usuario" ||
    norm === "email_usuario" ||
    norm === "telefone_usuario"
  );
}

export function camposLinkMagico(q: Record<string, string | undefined>): { nome?: string; email?: string; telefone?: string } {
  const r: { nome?: string; email?: string; telefone?: string } = {};
  for (const campo of CAMPOS_LINK_MAGICO) {
    const v = q[campo];
    if (v !== undefined && !ehPlaceholder(v)) r[campo] = v;
  }
  return r;
}

const MAX_UTMS = 10;
const MAX_VALOR_UTM = 200;

export function utmsDaUrl(q: Record<string, string | undefined>): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(q)) {
    if (!chave.startsWith("utm_") || valor === undefined) continue;
    if (Object.keys(r).length >= MAX_UTMS) break;
    r[chave] = valor.slice(0, MAX_VALOR_UTM);
  }
  return r;
}

export type RegrasCadastro = {
  pedeEmail: boolean;
  emailObrigatorio: boolean;
  pedeTelefone: boolean;
  telefoneObrigatorio: boolean;
  paisPadrao: string;
};

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarCadastro(
  c: { nome?: string; email?: string; telefone?: string },
  regras: RegrasCadastro,
): { erro: string } | { dados: { nome: string; email: string | null; telefone: string | null } } {
  const nome = (c.nome ?? "").trim();
  if (nome.length < 1 || nome.length > 80) return { erro: "Informe seu nome." };

  let email: string | null = null;
  if (regras.pedeEmail) {
    const v = (c.email ?? "").trim();
    if (v === "") {
      if (regras.emailObrigatorio) return { erro: "Informe um e-mail válido." };
    } else if (!RE_EMAIL.test(v)) {
      return { erro: "Informe um e-mail válido." };
    } else {
      // Minúsculo: o checkout casa a venda pelo e-mail com igualdade exata.
      email = v.toLowerCase();
    }
  }

  let telefone: string | null = null;
  if (regras.pedeTelefone) {
    const v = (c.telefone ?? "").trim();
    if (v === "") {
      if (regras.telefoneObrigatorio) return { erro: "Informe um WhatsApp válido." };
    } else {
      const e164 = paraE164(v, regras.paisPadrao as CountryCode);
      if (!e164) return { erro: "Informe um WhatsApp válido." };
      telefone = e164;
    }
  }

  return { dados: { nome, email, telefone } };
}

/** Padrão "hls" quando o link não é reconhecido (nunca deixa a sala sem formato). */
export function formatoDoVideo(url: string): "hls" | "mp4" {
  const r = validarUrlVideo(url);
  return "tipo" in r ? r.tipo : "hls";
}

export function linkComUtms(link: string, utms: Record<string, string>): string {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return link;
  }
  for (const [chave, valor] of Object.entries(utms)) {
    if (!u.searchParams.has(chave)) u.searchParams.set(chave, valor);
  }
  return u.toString();
}

export function sanitizarTitulo(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s"],
    allowedAttributes: { "*": ["style"] },
    allowedStyles: { "*": { "text-align": [/^(left|right|center|justify)$/] } },
  });
}

// Decisão de entrada na sala ---------------------------------------------------------------------------------------

export type EntradaSala = {
  webinarAtivo: boolean;
  temVideo: boolean;
  estado: "espera" | "aberta" | "encerrada";
  replay: boolean;
  teste: boolean;
  temSessao: boolean;
  cheia: boolean;
  acessoFacilitado: boolean;
  linkMagicoValido: boolean;
};

export type DecisaoEntrada =
  | "indisponivel"
  | "espera"
  | "encerrada"
  | "cheia"
  | "sala"
  | "login"
  | "criar_sessao_magica"
  | "criar_sessao_provisoria"
  | "criar_sessao_teste";

/** O que mostrar/fazer ao abrir a sala, nesta ordem (a primeira regra que bater decide). `encerrada` vence
 *  `temSessao` (só teste e replay furam essa fila) — assim quem já tinha sessão numa transmissão que terminou
 *  ainda vê a tela de "encerrada" (com o link de replay), em vez de cair direto na sala. Token de teste válido
 *  sempre abre uma sessão de teste nova, mesmo com uma sessão normal no cookie (o cookie de teste substitui o
 *  normal pra esse webinar) — senão o produtor cairia na própria sessão normal, contando métricas. */
export function decidirEntrada(e: EntradaSala): DecisaoEntrada {
  if (!e.webinarAtivo || !e.temVideo) return "indisponivel";
  if (e.teste) return "criar_sessao_teste";
  if (e.replay) return e.temSessao ? "sala" : "login";
  if (e.estado === "encerrada") return "encerrada";
  if (e.temSessao) return "sala";
  if (e.estado === "espera") return "espera";
  if (e.cheia) return "cheia";
  if (e.linkMagicoValido) return "criar_sessao_magica";
  if (e.acessoFacilitado) return "criar_sessao_provisoria";
  return "login";
}

const RE_BOT_PREVIEW =
  /whatsapp|facebookexternalhit|facebot|slackbot|telegrambot|twitterbot|linkedinbot|discordbot|googlebot|bingbot|applebot/i;

/** Bots de preview de link (WhatsApp, Facebook, Slack, Telegram, X/Twitter, LinkedIn, Discord) e crawlers de
 *  busca comuns (Google, Bing, Apple) — essas visitas nunca devem criar sessão/participante/evento. */
export function ehBotDePreview(userAgent: string | null): boolean {
  return !!userAgent && RE_BOT_PREVIEW.test(userAgent);
}

// Caminho público da sala ------------------------------------------------------------------------------------------

/** Só letras minúsculas, dígitos e hífen (3–60 caracteres): o mesmo formato de slug usado no resto do app.
 *  Qualquer coisa fora disso (`/evil.com`, `..`, espaço, etc.) é rejeitada antes de entrar num caminho ou redirect. */
export function slugValido(slug: string): boolean {
  return /^[a-z0-9-]{3,60}$/.test(slug);
}

/** `/<slug>/<sufixo>` quando o host da requisição é o domínio da sala; `/s/<slug>/<sufixo>` em qualquer outro host
 *  (painel, localhost em dev). Núcleo puro — o lado servidor fica em `src/lib/sala/caminho.ts`.
 *  Slug fora do formato (`^[a-z0-9-]{3,60}$`) nunca chega a compor o caminho — devolve `"/"` em vez de um caminho
 *  tipo `//evil.com` (um slug decodificado pelo Next como `/evil.com` viraria um redirect pra outro host). */
export function caminhoPublico(host: string, hostSala: string, slug: string, sufixo = ""): string {
  if (!slugValido(slug)) return "/";
  const h = host.toLowerCase().split(":")[0];
  const base = hostSala && h === hostSala.toLowerCase() ? `/${slug}` : `/s/${slug}`;
  return sufixo ? `${base}/${sufixo}` : base;
}

/** Origem (`protocolo://host[:porta]`) dos redirecionamentos absolutos das rotas da sala (`/entrar`, `/t/<slug>`).
 *  O `req.url` de uma rota do Next nem sempre traz o host que o navegador usou: no `next dev`/`next start` ele é
 *  montado com o hostname em que o servidor escuta (`http://localhost:3150/...`), não com o `Host` da requisição.
 *  Aberta em `sala.localhost:3150`, a entrada redirecionava para `localhost:3150/<slug>/sala` — o domínio do painel,
 *  sem o cookie da sessão recém-criada — e o middleware mandava para o `/login` do painel.
 *  Quando o `Host` é o domínio da sala configurado, a origem vem da própria configuração (`NEXT_PUBLIC_SALA_URL`),
 *  nunca do cabeçalho (que não é confiável); em qualquer outro caso, a do `req.url`, como antes. */
export function origemDoRedirecionamento(urlRequisicao: string, host: string | null, salaUrl: string | undefined): string {
  try {
    const sala = new URL(salaUrl ?? "");
    const h = (host ?? "").toLowerCase().split(":")[0];
    if (h && h === sala.hostname.toLowerCase()) return sala.origin;
  } catch {
    /* sem domínio da sala configurado (ou inválido): segue com a origem da requisição. */
  }
  return new URL(urlRequisicao).origin;
}

// Modo da sala a partir da sessão ------------------------------------------------------------------------------

/** Modo em que a sala abre. `?replay=1` com uma sessão ao vivo troca a sessão pra replay no servidor
 *  (`trocarParaReplay`), pra que o `sinal` salve a posição e a retenção não conte como ao vivo. Teste nunca muda. */
export function modoDaSala(modoSessao: "ao_vivo" | "replay" | "teste", replayNaUrl: boolean): { modo: "ao_vivo" | "replay" | "teste"; trocarParaReplay: boolean } {
  if (modoSessao === "teste") return { modo: "teste", trocarParaReplay: false };
  if (modoSessao === "replay") return { modo: "replay", trocarParaReplay: false };
  if (replayNaUrl) return { modo: "replay", trocarParaReplay: true };
  return { modo: "ao_vivo", trocarParaReplay: false };
}

/** Link do botão da oferta: só `http:`/`https:` (nunca `javascript:`, `data:` etc.), com as UTMs repassadas
 *  quando pedido. `null` quando não há link aproveitável. */
export type DadosParticipanteOferta = { nome?: string | null; email?: string | null; telefoneE164?: string | null };

/** Valor de cada `{{campo}}` aceito no link da oferta. `telefone` vai só com dígitos e DDI (`5537900001111`);
 *  `telefone_sem_ddi` sem o código do país (`37900001111`), como os checkouts costumam pedir. */
function camposDaOferta(d: DadosParticipanteOferta): Record<string, string> {
  const bruto = d.telefoneE164?.trim() ?? "";
  // A sessão de teste guarda o telefone como veio no link (pode faltar o +55): sem DDI, lê como Brasil.
  const n = bruto ? parsePhoneNumberFromString(bruto, "BR") : undefined;
  return {
    nome: d.nome?.trim() ?? "",
    email: d.email?.trim() ?? "",
    telefone: n ? n.number.replace(/\D/g, "") : bruto.replace(/\D/g, ""),
    telefone_sem_ddi: n ? n.nationalNumber : "",
  };
}

/** Link do botão da oferta: só http(s) (nunca `javascript:`/`data:`), `{{nome}}`, `{{email}}`, `{{telefone}}` e
 *  `{{telefone_sem_ddi}}` nos parâmetros trocados pelos dados de quem está na sala (parâmetro que ficaria vazio
 *  sai do link, pra o checkout não receber `name=`), e as UTMs da sessão repassadas sem sobrescrever as do link. */
export function linkOfertaSeguro(link: string | null, utms: Record<string, string>, dados: DadosParticipanteOferta = {}): string | null {
  if (!link) return null;
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const campos = camposDaOferta(dados);
  for (const [chave, valor] of [...u.searchParams.entries()]) {
    if (!/\{\{\s*\w+\s*\}\}/.test(valor)) continue;
    const preenchido = valor.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, campo: string) => campos[campo.toLowerCase()] ?? "");
    if (preenchido.trim()) u.searchParams.set(chave, preenchido);
    else u.searchParams.delete(chave);
  }
  return linkComUtms(u.toString(), utms);
}

// Evento de entrada -------------------------------------------------------------------------------------------

export type EventoEntrada = "link_magico" | "sem_login" | "login_provisorio" | "fez_login";

/** Tipo do evento gravado quando a sessão nasce (o modo teste não grava nenhum). Link mágico vence; cadastro
 *  completo (formulário de login, `temporario = false`) é sempre `fez_login`, seja qual for `login_na_sala`;
 *  entrada provisória do acesso facilitado (pulou o formulário) é `sem_login` quando a sala nunca pede cadastro
 *  (`login_na_sala` desligado) e `login_provisorio` quando vai pedir o cadastro dentro da sala. */
export function tipoEventoDeEntrada(o: { linkMagico: boolean; temporario: boolean; loginNaSala: boolean }): EventoEntrada {
  if (o.linkMagico) return "link_magico";
  if (!o.temporario) return "fez_login";
  return o.loginNaSala ? "login_provisorio" : "sem_login";
}

// Sala do just in time ----------------------------------------------------------------------------------------

/** Quanto antes do horário escolhido a pessoa já pode entrar (espera com contagem). */
export const MINUTOS_ENTRADA_ANTES_JIT = 10;
/** Sem duração do vídeo conhecida, a sala do JIT fica aberta por 2 h. */
const DURACAO_PADRAO_JIT_SEG = 2 * 60 * 60;

export type EstadoSalaJit = {
  estado: "espera" | "aberta" | "encerrada";
  janela: { inicio: Date; fim: Date };
  /** `true` de 10 min antes do horário até o fim (espera com contagem ou aberta). */
  podeEntrar: boolean;
};

/** Estado da sala do JIT pelo horário escolhido: espera antes do horário (a partir de 10 min antes já pode entrar
 *  e vê a contagem), aberta do horário até horário + duração do vídeo, depois encerrada (replay). */
export function estadoSalaJit(jitHorario: Date, duracaoSeg: number | null, agora: Date): EstadoSalaJit {
  const duracao = duracaoSeg && duracaoSeg > 0 ? duracaoSeg : DURACAO_PADRAO_JIT_SEG;
  const inicio = jitHorario.getTime();
  const fim = inicio + duracao * 1000;
  const t = agora.getTime();
  const janela = { inicio: new Date(inicio), fim: new Date(fim) };
  if (t >= fim) return { estado: "encerrada", janela, podeEntrar: false };
  if (t >= inicio) return { estado: "aberta", janela, podeEntrar: true };
  return { estado: "espera", janela, podeEntrar: t >= inicio - MINUTOS_ENTRADA_ANTES_JIT * 60_000 };
}

/** O cookie da sala vale no mínimo 12 h (como a entrada normal). */
const DOZE_HORAS_SEG = 12 * 60 * 60;

/** Expiração (segundos Unix) do cookie de uma inscrição do JIT: até 12 h depois do fim da sessão escolhida
 *  (horário + duração do vídeo, ou 2 h sem duração), dando tempo do replay; nunca menos que 12 h a partir de agora. */
export function expCookieJit(jitHorario: Date, duracaoSeg: number | null, agora: Date): number {
  const fimSeg = Math.floor(estadoSalaJit(jitHorario, duracaoSeg, jitHorario).janela.fim.getTime() / 1000);
  return Math.max(Math.floor(agora.getTime() / 1000) + DOZE_HORAS_SEG, fimSeg + DOZE_HORAS_SEG);
}

export type EntradaJit = {
  webinarAtivo: boolean;
  temVideo: boolean;
  /** Token de teste (`?teste=`) válido para este webinar. */
  teste: boolean;
  replay: boolean;
  sessao: { modo: "ao_vivo" | "replay" | "teste"; jitHorario: Date | null } | null;
  duracaoSeg: number | null;
  agora: Date;
};

export type DecisaoEntradaJit = "indisponivel" | "criar_sessao_teste" | "lp" | "espera" | "sala" | "encerrada";

/** Entrada da sala de um webinar just in time: sem sessão (ou sessão sem horário escolhido) vai para a página de
 *  inscrição (`/lp`); com sessão, a janela do horário escolhido decide (espera com contagem / sala / encerrada com
 *  replay). Teste (token do Pronto) e replay furam a janela, como na entrada normal. */
export function decidirEntradaJit(e: EntradaJit): DecisaoEntradaJit {
  if (!e.webinarAtivo || !e.temVideo) return "indisponivel";
  if (e.teste) return "criar_sessao_teste";
  if (!e.sessao) return "lp";
  // Sessão de teste no link normal (sem `?teste=`): entra como participante.
  if (e.sessao.modo === "teste") return "lp";
  if (e.replay || e.sessao.modo === "replay") return "sala";
  if (!e.sessao.jitHorario) return "lp";
  const { estado } = estadoSalaJit(e.sessao.jitHorario, e.duracaoSeg, e.agora);
  if (estado === "espera") return "espera";
  if (estado === "aberta") return "sala";
  return "encerrada";
}

/** Horário que a pessoa escolheu, conferido contra os oferecidos agora (o servidor recalcula a lista). Exibição
 *  `entrar_direto` não mostra escolha: usa o próximo. Fora da lista (passou, mudou a configuração, valor forjado)
 *  → `null` ("Esse horário não está mais disponível."). */
export function escolherHorarioJit(oferecidos: Date[], escolhido: string, exibicao: string): Date | null {
  if (exibicao === "entrar_direto") return oferecidos[0] ?? null;
  const ms = Date.parse(escolhido);
  if (!Number.isFinite(ms)) return null;
  return oferecidos.find((d) => d.getTime() === ms) ?? null;
}
