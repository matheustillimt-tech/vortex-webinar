import { ehFusoValido } from "./fuso";
import { formatarHorarioJit, rotuloFuso } from "./jit";
import { FUSO_PADRAO_JIT, MAX_ASSUNTO, MINUTOS_LEMBRETE_PADRAO, TIPOS_EMAIL, type TipoEmail } from "./jit-form";
import type { Idioma } from "./textos-sala";

export { TIPOS_EMAIL, type TipoEmail };

/** Modelo de um e-mail do JIT. No banco (`emails_jit`): `remetente_nome`, `assunto`, `modelo.texto`, `minutos_antes`. */
export type ModeloEmail = { remetenteNome: string; assunto: string; texto: string; minutosAntes: number | null };

/** Valores das variáveis `{{nome}}`, `{{webinar}}`, `{{data}}`, `{{hora}}`, `{{link}}`, `{{minutos}}` (já formatados). */
export type VarsEmail = { nome: string; webinar: string; data: string; hora: string; link: string; minutos: string };

export const VARIAVEIS_EMAIL: readonly (keyof VarsEmail)[] = ["nome", "webinar", "data", "hora", "link", "minutos"];
export const TEXTO_BOTAO_EMAIL = "Acessar o webinar";

const REMETENTE_PADRAO = "Equipe";

const PADRAO: Record<Idioma, Record<TipoEmail, { assunto: string; texto: string }>> = {
  "pt-BR": {
    inscricao: {
      assunto: "Inscrição confirmada: {{webinar}}",
      texto:
        "Olá, {{nome}}!\n\nSua inscrição no {{webinar}} está confirmada.\n\nData: {{data}}\nHorário: {{hora}}\n\n" +
        "Guarde este e-mail: é por este link que você entra na sala.\n{{link}}",
    },
    lembrete: {
      assunto: "Faltam {{minutos}} minutos: {{webinar}}",
      texto:
        "Olá, {{nome}}!\n\nO {{webinar}} começa em {{minutos}} minutos, às {{hora}}.\n\n" +
        "Separe um lugar tranquilo e entre um pouco antes pelo link abaixo.\n{{link}}",
    },
    comecando: {
      assunto: "Estamos começando: {{webinar}}",
      texto: "Olá, {{nome}}!\n\nO {{webinar}} está começando agora. Entre na sala pelo link abaixo.\n{{link}}",
    },
  },
  es: {
    inscricao: {
      assunto: "Inscripción confirmada: {{webinar}}",
      texto:
        "¡Hola, {{nome}}!\n\nTu inscripción en {{webinar}} está confirmada.\n\nFecha: {{data}}\nHora: {{hora}}\n\n" +
        "Guarda este correo: con este enlace entras a la sala.\n{{link}}",
    },
    lembrete: {
      assunto: "Faltan {{minutos}} minutos: {{webinar}}",
      texto: "¡Hola, {{nome}}!\n\n{{webinar}} empieza en {{minutos}} minutos, a las {{hora}}.\n\nEntra un poco antes por el enlace.\n{{link}}",
    },
    comecando: {
      assunto: "Estamos empezando: {{webinar}}",
      texto: "¡Hola, {{nome}}!\n\n{{webinar}} está empezando ahora. Entra a la sala por el enlace.\n{{link}}",
    },
  },
  en: {
    inscricao: {
      assunto: "You're registered: {{webinar}}",
      texto:
        "Hi {{nome}}!\n\nYour registration for {{webinar}} is confirmed.\n\nDate: {{data}}\nTime: {{hora}}\n\n" +
        "Keep this email: this link takes you into the room.\n{{link}}",
    },
    lembrete: {
      assunto: "{{minutos}} minutes to go: {{webinar}}",
      texto: "Hi {{nome}}!\n\n{{webinar}} starts in {{minutos}} minutes, at {{hora}}.\n\nJoin a little early using the link below.\n{{link}}",
    },
    comecando: {
      assunto: "We're starting: {{webinar}}",
      texto: "Hi {{nome}}!\n\n{{webinar}} is starting now. Join the room using the link below.\n{{link}}",
    },
  },
};

/** Modelos padrão dos 3 e-mails ("Restaurar padrão" e webinar sem modelo salvo). */
export function modelosPadrao(idioma: Idioma): Record<TipoEmail, ModeloEmail> {
  const p = PADRAO[idioma] ?? PADRAO["pt-BR"];
  const m = (tipo: TipoEmail): ModeloEmail => ({
    remetenteNome: REMETENTE_PADRAO,
    assunto: p[tipo].assunto,
    texto: p[tipo].texto,
    minutosAntes: tipo === "lembrete" ? MINUTOS_LEMBRETE_PADRAO : null,
  });
  return { inscricao: m("inscricao"), lembrete: m("lembrete"), comecando: m("comecando") };
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Só `http:`/`https:` (nunca `javascript:`, `data:` etc.); senão "". */
function linkSeguro(link: string): string {
  try {
    const u = new URL(link);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

const RE_VAR = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/** Troca as variáveis conhecidas; desconhecidas ficam como estão. `literal` e `valor` permitem escapar cada parte. */
function substituir(texto: string, vals: Record<string, string>, literal: (s: string) => string, valor: (s: string) => string): string {
  let r = "";
  let ultimo = 0;
  for (const m of texto.matchAll(RE_VAR)) {
    const nome = m[1].toLowerCase();
    r += literal(texto.slice(ultimo, m.index));
    r += nome in vals ? valor(vals[nome]) : literal(m[0]);
    ultimo = m.index + m[0].length;
  }
  return r + literal(texto.slice(ultimo));
}

function layout(corpo: string, link: string): string {
  const botao = link
    ? `<p style="margin:28px 0 8px;text-align:center"><a href="${escaparHtml(link)}" style="display:inline-block;background:#111827;color:#ffffff;` +
      `text-decoration:none;font-weight:600;padding:14px 28px;border-radius:8px">${TEXTO_BOTAO_EMAIL}</a></p>`
    : "";
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f3f4f6">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px">' +
    '<tr><td style="padding:32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#111827">' +
    corpo +
    botao +
    "</td></tr></table></td></tr></table></body></html>"
  );
}

/** Monta o e-mail a partir do modelo (texto puro escrito no painel): substitui as variáveis, escapa o HTML (do
 *  texto e dos valores), linhas em branco separam parágrafos (`<p>`) e quebra simples vira `<br>`, num layout fixo
 *  com o botão "Acessar o webinar" (só com link http/https; senão sem botão e `{{link}}` vazio). Devolve também a
 *  versão em texto puro e o assunto numa linha só, com até 150 caracteres. */
export function renderizarEmail(modelo: { assunto: string; texto: string }, vars: VarsEmail): { assunto: string; html: string; texto: string } {
  const link = linkSeguro(vars.link);
  const umaLinha = (s: string) => s.replace(/[\r\n]+/g, " ");
  const vals: Record<string, string> = {
    nome: umaLinha(vars.nome),
    webinar: umaLinha(vars.webinar),
    data: umaLinha(vars.data),
    hora: umaLinha(vars.hora),
    link,
    minutos: umaLinha(vars.minutos),
  };
  const id = (s: string) => s;
  const textoModelo = modelo.texto.replace(/\r\n?/g, "\n").trim();

  const assunto = umaLinha(substituir(modelo.assunto, vals, id, id)).replace(/\s+/g, " ").trim().slice(0, MAX_ASSUNTO);

  const corpoHtml = substituir(textoModelo, vals, escaparHtml, escaparHtml)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px">${p.split("\n").join("<br>")}</p>`)
    .join("");

  let texto = substituir(textoModelo, vals, id, id);
  if (link) texto += `\n\n${TEXTO_BOTAO_EMAIL}: ${link}`;

  return { assunto, html: layout(corpoHtml, link), texto };
}

export type EnvioAgendado = { tipo: TipoEmail; enviarEm: Date };

/** Quando mandar cada e-mail de uma inscrição: `inscricao` agora; `lembrete` `minutosLembrete` antes do horário,
 *  só se ainda faltar mais que isso (null/≤ 0 → sem lembrete); `comecando` no horário, se ainda não chegou. */
export function agendaDeEmails(jitHorario: Date, agora: Date, minutosLembrete: number | null): EnvioAgendado[] {
  const lista: EnvioAgendado[] = [{ tipo: "inscricao", enviarEm: agora }];
  if (minutosLembrete && minutosLembrete > 0) {
    const lembrete = new Date(jitHorario.getTime() - minutosLembrete * 60_000);
    if (lembrete.getTime() > agora.getTime()) lista.push({ tipo: "lembrete", enviarEm: lembrete });
  }
  if (jitHorario.getTime() > agora.getTime()) lista.push({ tipo: "comecando", enviarEm: jitHorario });
  return lista;
}

/** Valores das variáveis de uma inscrição: data por extenso e hora (`HH:mm`) no fuso ("participante" ou inválido →
 *  Brasília). Fora do horário de Brasília, `{{hora}}` leva o fuso junto: "14:00 (Lisbon, GMT+0)". */
export function varsEmail(o: {
  nome: string;
  webinar: string;
  jitHorario: Date;
  fuso: string;
  link: string;
  minutos: number | null;
  idioma?: Idioma;
}): VarsEmail {
  const zona = o.fuso !== "participante" && ehFusoValido(o.fuso) ? o.fuso : FUSO_PADRAO_JIT;
  const { data, hora } = formatarHorarioJit(o.jitHorario, zona, o.idioma ?? "pt-BR");
  return {
    nome: o.nome,
    webinar: o.webinar,
    data,
    hora: zona === FUSO_PADRAO_JIT ? hora : `${hora} (${rotuloFuso(o.jitHorario, zona)})`,
    link: o.link,
    minutos: o.minutos === null ? "" : String(o.minutos),
  };
}

/** Especiais de endereço (RFC 5322): um nome com eles sem aspas vira outro endereço (`,`) ou um `From` inválido. */
const ESPECIAIS_FROM = /[(),.:;@[\]]/;

/** Cabeçalho `From`: "<remetente_nome> <endereço do EMAIL_FROM>". Se `EMAIL_FROM` vier como `Nome <email>`, usa só o
 *  endereço; tira do nome o que quebraria o cabeçalho (`< > " \` e quebras de linha) e põe o nome entre aspas
 *  quando ele tem vírgula, ponto, parênteses etc. (ex.: "Vórtex, Aulas" sem aspas seriam dois destinatários e o
 *  Resend recusaria todos os envios). */
export function remetenteEmail(nome: string, emailFrom: string): string {
  const m = /<([^>]+)>/.exec(emailFrom);
  const endereco = (m ? m[1] : emailFrom).trim();
  const limpo = nome.replace(/[<>"\\]/g, "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!limpo) return endereco;
  return ESPECIAIS_FROM.test(limpo) ? `"${limpo}" <${endereco}>` : `${limpo} <${endereco}>`;
}
