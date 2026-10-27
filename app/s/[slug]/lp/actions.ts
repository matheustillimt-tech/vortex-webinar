"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { escolherHorarioJit, expCookieJit, slugValido, utmsDaUrl, validarCadastro } from "@/src/lib/regras/sala";
import { proximosHorariosJit } from "@/src/lib/regras/jit";
import { ehFusoValido } from "@/src/lib/regras/fuso";
import { FUSO_PADRAO_JIT } from "@/src/lib/regras/jit-form";
import { verificarTokenTeste } from "@/src/lib/regras/sessao-token";
import { t } from "@/src/lib/regras/textos-sala";
import { env } from "@/src/lib/env";
import { carregarSala } from "@/src/lib/sala/dados";
import { caminhoSala } from "@/src/lib/sala/caminho";
import {
  buscarInscricaoJit,
  cookieDaSessao,
  criarSessao,
  geoDoCabecalho,
  ipHashDoCabecalho,
  tokenDaSessao,
} from "@/src/lib/sala/sessao";
import { enfileirarEmailsDaInscricao } from "@/src/lib/emails";

export type ResultadoInscricao = {
  erro?: string;
  valores?: { nome?: string; email?: string; telefone?: string };
};

function dispositivoDoUserAgent(ua: string | null): "mobile" | "desktop" {
  return ua && /mobile|android|iphone/i.test(ua) ? "mobile" : "desktop";
}

/** O campo oculto `utms` chega cru do cliente: passa pelo mesmo filtro da query string (`utmsDaUrl`). */
function utmsDoCampo(valor: FormDataEntryValue | null): Record<string, string> {
  let bruto: unknown;
  try {
    bruto = JSON.parse(String(valor ?? "{}"));
  } catch {
    return {};
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return {};
  const somenteString: Record<string, string> = {};
  for (const [chave, v] of Object.entries(bruto as Record<string, unknown>)) if (typeof v === "string") somenteString[chave] = v;
  return utmsDaUrl(somenteString);
}

/** Fuso do navegador (campo oculto): só um nome IANA válido e curto; senão `undefined` (as regras usam Brasília). */
function fusoDoCampo(valor: FormDataEntryValue | null): string | undefined {
  const f = String(valor ?? "").trim();
  return f && f.length <= 64 && ehFusoValido(f) ? f : undefined;
}

/** Inscrição na página do just in time. Recalcula os horários oferecidos agora (nunca confia na lista do cliente),
 *  reaproveita a inscrição da mesma pessoa no mesmo horário (renova o cookie) ou cria a sessão com o horário
 *  escolhido (`inicio_sessao = jit_horario`, evento `inscreveu_lp`, disparos e e-mails). Modo teste (`?teste=` do
 *  Pronto) cria só a sessão de teste: sem evento, disparo nem e-mail. Erro devolve `{ erro, valores }`; sucesso
 *  redireciona para `/<slug>/inscrito`. */
export async function inscrever(slug: string, _prev: ResultadoInscricao, form: FormData): Promise<ResultadoInscricao> {
  if (!slugValido(slug)) return { erro: "Sala não encontrada." };

  const valores = {
    nome: String(form.get("nome") ?? ""),
    email: String(form.get("email") ?? ""),
    telefone: String(form.get("telefone") ?? ""),
  };

  const sala = await carregarSala(slug);
  if (!sala) redirect(await caminhoSala(slug));
  // Webinar que não é (mais) just in time, arquivado ou sem vídeo: a raiz da sala decide o que mostrar.
  if (sala.webinar.tipoAgenda !== "jit" || !sala.jit || sala.webinar.status !== "ativo" || !sala.video) {
    redirect(await caminhoSala(slug));
  }
  const idioma = sala.webinar.idioma;
  const webinarId = sala.webinar.id;

  const resultado = validarCadastro(valores, sala.telaLogin);
  if ("erro" in resultado) return { erro: resultado.erro, valores };

  const agora = new Date();
  const fusoNavegador = fusoDoCampo(form.get("fuso"));
  const oferecidos = proximosHorariosJit(sala.jit.horarios, sala.jit.config, agora, fusoNavegador);
  // Fuso em que os horários foram oferecidos (o mesmo que `proximosHorariosJit` aplicou): vai nos e-mails.
  const fusoAplicado = sala.jit.config.fuso === "participante" ? (fusoNavegador ?? FUSO_PADRAO_JIT) : sala.jit.config.fuso;
  const jitHorario = escolherHorarioJit(oferecidos, String(form.get("horario") ?? ""), sala.jit.config.exibicao);
  if (!jitHorario) return { erro: t(idioma, "horarioIndisponivel"), valores };

  const tokenTeste = String(form.get("teste") ?? "");
  const testeValido = tokenTeste ? verificarTokenTeste(tokenTeste, env("SALA_TOKEN_SECRET"), Math.floor(agora.getTime() / 1000)) : null;
  const teste = !!testeValido && testeValido.w === webinarId;

  try {
    const jar = await cookies();
    const existente = teste ? null : await buscarInscricaoJit(webinarId, resultado.dados.email, jitHorario);
    if (existente) {
      // Mesma pessoa, mesmo horário: devolve a mesma sessão (sem novo evento nem e-mail), renovando o cookie.
      const exp = expCookieJit(jitHorario, sala.video.duracaoSeg || null, agora);
      const { name, value, ...opcoes } = cookieDaSessao(webinarId, tokenDaSessao(existente, webinarId, exp), exp - Math.floor(agora.getTime() / 1000));
      jar.set(name, value, opcoes);
    } else {
      const h = await headers();
      const { sessaoId, token, exp } = await criarSessao({
        sala,
        dados: resultado.dados,
        temporario: false,
        utms: utmsDoCampo(form.get("utms")),
        modo: teste ? "teste" : "ao_vivo",
        janelaInicio: jitHorario,
        agora,
        geo: geoDoCabecalho(h),
        dispositivo: dispositivoDoUserAgent(h.get("user-agent")),
        navegador: h.get("user-agent"),
        ipHash: ipHashDoCabecalho(h),
        linkMagico: false,
        jitHorario,
        jitFuso: fusoAplicado,
      });
      const { name, value, ...opcoes } = cookieDaSessao(webinarId, token, exp - Math.floor(agora.getTime() / 1000));
      jar.set(name, value, opcoes);
      // `criarSessao` já gravou o evento `inscreveu_lp` e enfileirou os disparos (fora do modo teste). Os e-mails
      // nunca derrubam a inscrição (a função só loga).
      if (!teste) {
        await enfileirarEmailsDaInscricao({ sessaoId, webinarId, email: resultado.dados.email, jitHorario, agora });
      }
    }
  } catch {
    return { erro: t(idioma, "erroInscricao"), valores };
  }

  redirect(await caminhoSala(slug, "inscrito"));
}
