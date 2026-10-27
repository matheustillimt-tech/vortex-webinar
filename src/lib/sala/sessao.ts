import "server-only";
import { cookies } from "next/headers";
import { dbAdmin } from "../supabase/admin";
import { env } from "../env";
import { hashIp } from "../crypto";
import { assinarToken, criarTokenAcesso, expTokenAcesso, linkDeAcesso, verificarToken } from "../regras/sessao-token";
import { inicioDaSessao } from "../regras/relogio";
import { nomeCookieNovoCadastro } from "../regras/pixels";
import { expCookieJit, tipoEventoDeEntrada } from "../regras/sala";
import { enfileirarPorEvento } from "../disparos";
import { nomeCookieAbWebinar } from "../regras/teste-ab";
import { testeAbDoCookie } from "./teste-ab";
import type { Sala } from "./dados";

const DOZE_HORAS_SEG = 12 * 60 * 60;
const VINTE_QUATRO_HORAS_SEG = 24 * 60 * 60;

export type ModoSessao = "ao_vivo" | "replay" | "teste";
export type Dispositivo = "mobile" | "desktop";
export type Geo = { pais?: string; cidade?: string; lat?: number; lon?: number };

export type DadosCriarSessao = {
  sala: Sala;
  dados: { nome: string; email: string | null; telefone: string | null };
  temporario: boolean;
  utms: Record<string, string>;
  modo: ModoSessao;
  janelaInicio: Date | null;
  agora: Date;
  geo: Geo;
  dispositivo: Dispositivo;
  navegador: string | null;
  ipHash: string | null;
  linkMagico: boolean;
  /** Inscrição do just in time (`/<slug>/lp`): horário escolhido. A sessão nasce com `jit_horario` e
   *  `inicio_sessao = jit_horario`, o evento é `inscreveu_lp` e o cookie vale até 12 h depois do fim da sessão. */
  jitHorario?: Date | null;
  /** Fuso em que o horário do JIT foi oferecido (IANA, já validado): os e-mails mostram data/hora nele. */
  jitFuso?: string | null;
};

const ERRO_SESSAO = "Não deu para abrir sua sessão.";

/** Conflito esperado (unique (sessao_id, tipo), (sessao_id, minuto) etc.): outro código de erro no insert não é
 *  ignorado. Exportada para as APIs da sala (evento, sinal) reaproveitarem a mesma checagem. */
export function ehConflito(erro: unknown): boolean {
  return !!erro && typeof erro === "object" && (erro as { code?: string }).code === "23505";
}

/** Sempre cria um novo participante (nunca reaproveita um existente — a métrica por e-mail agrupa depois), grava
 *  a sessão e o evento de entrada (menos no modo teste, que não deixa rastro), e devolve o token assinado (válido
 *  por 12 h) que vai no cookie da sala. */
export async function criarSessao(p: DadosCriarSessao): Promise<{ sessaoId: string; token: string; exp: number }> {
  const db = dbAdmin();
  const webinarId = p.sala.webinar.id;

  // E-mail sempre sem espaço e minúsculo (o link mágico chega aqui sem passar por `validarCadastro`): o checkout
  // casa a venda por igualdade exata com o e-mail minúsculo.
  const email = p.dados.email?.trim().toLowerCase() || null;
  const { data: participanteInserido, error: erroParticipante } = await db
    .from("participantes")
    .insert({ webinar_id: webinarId, nome: p.dados.nome, email, telefone_e164: p.dados.telefone, temporario: p.temporario })
    .select("id")
    .single();
  if (erroParticipante || !participanteInserido) throw new Error(ERRO_SESSAO);
  const participanteId = (participanteInserido as { id: string }).id;

  const jitHorario = p.jitHorario ?? null;
  const inicio =
    p.modo === "replay" && !jitHorario
      ? p.agora
      : inicioDaSessao({
          sincronizar: p.sala.webinar.sincronizarVideo,
          janelaInicio: p.janelaInicio ?? p.agora,
          primeiroAcesso: p.agora,
          jitEscolhido: jitHorario,
        });

  // Teste A/B: quem chegou pelo `/t/<slug>` traz o cookie de marcação deste webinar. Ponto único das três entradas
  // (login/cadastro, `/entrar` e inscrição do JIT). Modo teste não entra nas métricas do A/B.
  const testeAbId = p.modo === "teste" ? null : await testeAbDaRequisicao(db, webinarId, p.agora);

  const { data: sessaoInserida, error: erroSessao } = await db
    .from("sessoes")
    .insert({
      participante_id: participanteId,
      webinar_id: webinarId,
      teste_ab_id: testeAbId,
      variacao_webinar_id: testeAbId ? webinarId : null,
      inicio_sessao: inicio.toISOString(),
      jit_horario: jitHorario ? jitHorario.toISOString() : null,
      jit_fuso: jitHorario ? (p.jitFuso ?? null) : null,
      modo: p.modo,
      utms: p.utms,
      dispositivo: p.dispositivo,
      navegador: p.navegador,
      pais: p.geo.pais ?? null,
      cidade: p.geo.cidade ?? null,
      lat: p.geo.lat ?? null,
      lon: p.geo.lon ?? null,
      ip_hash: p.ipHash,
    })
    .select("id")
    .single();
  if (erroSessao || !sessaoInserida) throw new Error(ERRO_SESSAO);
  const sessaoId = (sessaoInserida as { id: string }).id;

  // Modo teste: sem evento, sem retenção (link assinado do Pronto, não entra nas métricas reais).
  if (p.modo !== "teste") {
    const tipo = jitHorario
      ? "inscreveu_lp"
      : tipoEventoDeEntrada({ linkMagico: p.linkMagico, temporario: p.temporario, loginNaSala: p.sala.webinar.loginNaSala });
    const { error: erroEvento } = await db.from("eventos").insert({ sessao_id: sessaoId, webinar_id: webinarId, tipo });
    if (erroEvento && !ehConflito(erroEvento)) throw new Error(ERRO_SESSAO);

    // Falha de enfileirar nunca derruba a entrada na sala: só loga e segue.
    try {
      await enfileirarPorEvento(sessaoId, webinarId, tipo);
    } catch (e) {
      console.error(`sala/sessao: não deu para enfileirar disparos da sessão ${sessaoId} (${tipo}): ${e}`);
    }
  }

  const exp = jitHorario
    ? expCookieJit(jitHorario, p.sala.video?.duracaoSeg ?? null, p.agora)
    : Math.floor(p.agora.getTime() / 1000) + DOZE_HORAS_SEG;
  const token = assinarToken({ s: sessaoId, w: webinarId, exp }, env("SALA_TOKEN_SECRET"));

  return { sessaoId, token, exp };
}

/** Lê o cookie de marcação do A/B (`vw_abw_<webinarId>`) da requisição atual. Fora de uma requisição (ou qualquer
 *  falha) → null: o A/B nunca derruba a criação da sessão. */
async function testeAbDaRequisicao(db: ReturnType<typeof dbAdmin>, webinarId: string, agora: Date): Promise<string | null> {
  let valor: string | undefined;
  try {
    const jar = await cookies();
    valor = jar?.get(nomeCookieAbWebinar(webinarId))?.value;
  } catch {
    return null;
  }
  if (!valor) return null;
  return testeAbDoCookie(db, valor, webinarId, env("SALA_TOKEN_SECRET"), agora);
}

/** Token do cookie da sala para uma sessão que já existe (inscrição repetida no JIT, link de acesso do e-mail). */
export function tokenDaSessao(sessaoId: string, webinarId: string, exp: number): string {
  return assinarToken({ s: sessaoId, w: webinarId, exp }, env("SALA_TOKEN_SECRET"));
}

/** Inscrição que a mesma pessoa (mesmo e-mail) já fez no mesmo horário do JIT desse webinar: a mais recente, ou
 *  `null`. Só sessões ao vivo (teste e replay não contam). Sem e-mail não há como reconhecer a pessoa. */
export async function buscarInscricaoJit(webinarId: string, email: string | null, jitHorario: Date): Promise<string | null> {
  if (!email) return null;
  const { data, error } = await dbAdmin()
    .from("sessoes")
    .select("id, participantes!inner(email)")
    .eq("webinar_id", webinarId)
    .eq("jit_horario", jitHorario.toISOString())
    .eq("modo", "ao_vivo")
    .eq("participantes.email", email.trim().toLowerCase())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`sala/sessao: não deu para procurar a inscrição do JIT: ${(error as { message?: string }).message ?? error}`);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

/** Sessão apontada por um link de acesso: tem de existir e ser do webinar. Devolve o horário do JIT (ou `null`). */
export async function sessaoDoAcesso(sessaoId: string, webinarId: string): Promise<{ jitHorario: Date | null } | null> {
  const { data, error } = await dbAdmin().from("sessoes").select("id, webinar_id, jit_horario").eq("id", sessaoId).maybeSingle();
  if (error || !data) return null;
  const linha = data as { id: string; webinar_id: string; jit_horario: string | null };
  if (linha.webinar_id !== webinarId) return null;
  return { jitHorario: linha.jit_horario ? new Date(linha.jit_horario) : null };
}

/** Link de acesso individual que vai nos e-mails do JIT: `<SALA_URL>/<slug>?acesso=<token>`, válido até 12 h depois
 *  do horário escolhido. */
export function linkDeAcessoDaSessao(o: { slug: string; sessaoId: string; webinarId: string; jitHorario: Date }): string {
  const token = criarTokenAcesso({ s: o.sessaoId, w: o.webinarId, exp: expTokenAcesso(o.jitHorario) }, env("SALA_TOKEN_SECRET"));
  return linkDeAcesso(env("NEXT_PUBLIC_SALA_URL"), o.slug, token);
}

export type SessaoLida = {
  sessaoId: string;
  webinarId: string;
  participanteId: string;
  participanteNome: string;
  /** E-mail e telefone (E.164) do cadastro: vão pro link da oferta (`{{email}}`, `{{telefone}}`). */
  participanteEmail: string | null;
  participanteTelefone: string | null;
  /** Sessão provisória (acesso facilitado / cadastro incompleto): só o nome, sem e-mail/telefone — a API de
   *  mensagem recusa envio (403) e a de cadastro completa os dados. */
  temporario: boolean;
  modo: ModoSessao;
  inicioSessao: Date;
  /** Horário escolhido na inscrição do just in time (`null` fora do JIT). */
  jitHorario: Date | null;
  utms: Record<string, string>;
  /** Posição salva do replay (último `sinal` recebido); `null` fora do replay ou sem sinal ainda — a sala usa 0. */
  posicaoReplaySeg: number | null;
};

type LinhaSessaoComParticipante = {
  id: string;
  webinar_id: string;
  participante_id: string;
  modo: ModoSessao;
  inicio_sessao: string;
  jit_horario?: string | null;
  utms: Record<string, string> | null;
  posicao_replay_seg: number | null;
  participantes: { nome: string; temporario: boolean; email: string | null; telefone_e164: string | null } | null;
};

/** Sessão do cookie `vw_<webinarId>`. `null` se faltar, a assinatura/expiração não baterem (token de 12 h), a
 *  sessão não existir mais, ou pertencer a outro webinar. */
export async function lerSessaoDoCookie(webinarId: string): Promise<SessaoLida | null> {
  const jar = await cookies();
  const valor = jar.get(`vw_${webinarId}`)?.value;
  if (!valor) return null;

  const agoraSeg = Math.floor(Date.now() / 1000);
  const dados = verificarToken(valor, env("SALA_TOKEN_SECRET"), agoraSeg);
  // token de teste (`t: 1`, sem `s`) não é uma sessão: só `verificarTokenTeste` aceita esse formato.
  if (!dados || !dados.s || dados.t !== undefined || dados.w !== webinarId) return null;

  const { data, error } = await dbAdmin().from("sessoes").select("*, participantes(nome, temporario, email, telefone_e164)").eq("id", dados.s).maybeSingle();
  if (error || !data) return null;
  const sessao = data as LinhaSessaoComParticipante;
  if (sessao.webinar_id !== webinarId) return null;

  return {
    sessaoId: sessao.id,
    webinarId: sessao.webinar_id,
    participanteId: sessao.participante_id,
    participanteNome: sessao.participantes?.nome ?? "",
    participanteEmail: sessao.participantes?.email ?? null,
    participanteTelefone: sessao.participantes?.telefone_e164 ?? null,
    temporario: sessao.participantes?.temporario ?? false,
    modo: sessao.modo,
    inicioSessao: new Date(sessao.inicio_sessao),
    jitHorario: sessao.jit_horario ? new Date(sessao.jit_horario) : null,
    utms: sessao.utms ?? {},
    posicaoReplaySeg: sessao.posicao_replay_seg,
  };
}

/** Opções do cookie da sala: httpOnly, secure, sameSite=lax, path=/, 12 h (ou `maxAgeSeg`, no JIT). */
export function cookieDaSessao(webinarId: string, token: string, maxAgeSeg: number = DOZE_HORAS_SEG) {
  return {
    name: `vw_${webinarId}`,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.max(60, Math.floor(maxAgeSeg)),
  };
}

/** Cookie de uso único (5 min, legível pelo navegador) que avisa a sala de que a entrada acabou de criar um
 *  cadastro novo — a sala dispara o pixel de lead uma vez e apaga o cookie. Gravado só depois do sucesso. */
export function cookieNovoCadastro(webinarId: string) {
  return {
    name: nomeCookieNovoCadastro(webinarId),
    value: "1",
    httpOnly: false,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 300,
  };
}

/** `?replay=1` com uma sessão ao vivo: a sessão passa a ser de replay (o `sinal` salva a posição e a retenção
 *  deixa de contar como ao vivo). Só troca quem ainda está em `ao_vivo` — teste nunca vira replay. */
export async function mudarSessaoParaReplay(sessaoId: string): Promise<void> {
  const { error } = await dbAdmin().from("sessoes").update({ modo: "replay" }).eq("id", sessaoId).eq("modo", "ao_vivo");
  if (error) console.error(`sala/sessao: não deu para trocar a sessão ${sessaoId} para replay: ${(error as { message?: string }).message ?? error}`);
}

/** Token do link de teste gerado no Pronto (`?teste=<token>`): sem `s`, `t: 1`, válido por 24 h. */
export function tokenTeste(webinarId: string, agora: Date): string {
  const exp = Math.floor(agora.getTime() / 1000) + VINTE_QUATRO_HORAS_SEG;
  return assinarToken({ w: webinarId, t: 1, exp }, env("SALA_TOKEN_SECRET"));
}

/** Geolocalização pelos cabeçalhos da Vercel. A cidade vem URL-encoded (cai pro valor cru se não decodificar). */
export function geoDoCabecalho(headers: Headers): Geo {
  const geo: Geo = {};
  const pais = headers.get("x-vercel-ip-country");
  if (pais) geo.pais = pais;

  const cidade = headers.get("x-vercel-ip-city");
  if (cidade) {
    try {
      geo.cidade = decodeURIComponent(cidade);
    } catch {
      geo.cidade = cidade;
    }
  }

  const latBruta = headers.get("x-vercel-ip-latitude");
  if (latBruta !== null) {
    const lat = Number(latBruta);
    if (Number.isFinite(lat)) geo.lat = lat;
  }
  const lonBruta = headers.get("x-vercel-ip-longitude");
  if (lonBruta !== null) {
    const lon = Number(lonBruta);
    if (Number.isFinite(lon)) geo.lon = lon;
  }

  return geo;
}

/** Hash do primeiro IP de `x-forwarded-for`, ou `null` sem cabeçalho. */
export function ipHashDoCabecalho(headers: Headers): string | null {
  const encaminhado = headers.get("x-forwarded-for");
  if (!encaminhado) return null;
  const ip = encaminhado.split(",")[0]?.trim();
  return ip ? hashIp(ip) : null;
}
