import { NextResponse, type NextRequest } from "next/server";
import type { CountryCode } from "libphonenumber-js";
import { paraE164 } from "@/src/lib/regras/telefone";
import { camposLinkMagico, decidirEntrada, ehBotDePreview, expCookieJit, origemDoRedirecionamento, slugValido, utmsDaUrl } from "@/src/lib/regras/sala";
import { estadoSala } from "@/src/lib/regras/agenda";
import { verificarTokenAcesso, verificarTokenTeste } from "@/src/lib/regras/sessao-token";
import { t } from "@/src/lib/regras/textos-sala";
import { env } from "@/src/lib/env";
import { carregarSala, salaCheia } from "@/src/lib/sala/dados";
import { caminhoSala } from "@/src/lib/sala/caminho";
import {
  cookieDaSessao,
  cookieNovoCadastro,
  criarSessao,
  geoDoCabecalho,
  ipHashDoCabecalho,
  lerSessaoDoCookie,
  sessaoDoAcesso,
  tokenDaSessao,
} from "@/src/lib/sala/sessao";
import { formularioAutoEnvio, paginaMinima } from "@/src/lib/sala/pagina-minima";

function dispositivoDoUserAgent(ua: string | null): "mobile" | "desktop" {
  return ua && /mobile|android|iphone/i.test(ua) ? "mobile" : "desktop";
}

function buscaComoObjeto(url: URL): Record<string, string> {
  const q: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    q[k] = v;
  });
  return q;
}

function respostaHtml(html: string, status = 200): NextResponse {
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function respostaIndisponivel(): NextResponse {
  return respostaHtml(paginaMinima(`<p>${t("pt-BR", "indisponivel")}</p>`), 400);
}

/** O mesmo formulário de auto-envio, usado tanto pelo GET normal quanto pela recusa do POST a um bot. O `acao` é o
 *  caminho público (`caminhoSala`): no domínio da sala o middleware reescreve `/<slug>/entrar` para
 *  `/s/<slug>/entrar`, e `req.nextUrl.pathname` aqui já é o reescrito — postar nele daria `/s/s/...` (404). */
function respostaFormulario(acao: string, campos: Record<string, string>): NextResponse {
  return respostaHtml(formularioAutoEnvio(acao, campos, "Entrar na sala"));
}

/**
 * GET nunca cria sessão (um link de WhatsApp/Facebook/Slack etc. baixa a página pra gerar a prévia, e isso não pode
 * virar um lead/evento fantasma). Devolve um HTML mínimo — sem CSS/JS externo, `cache-control: no-store`,
 * `robots: noindex` — com um formulário que se auto-envia por JS como POST pro mesmo caminho (os mesmos parâmetros
 * da query, como campos ocultos) e um botão "Entrar na sala" como alternativa pra quem tiver JS desligado.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugValido(slug)) return respostaIndisponivel();

  const q = buscaComoObjeto(req.nextUrl);
  return respostaFormulario(await caminhoSala(slug, "entrar"), q);
}

/** Entrada sem formulário visível: link mágico (`?nome=&email=&telefone=`) e acesso facilitado (sala sem tela de
 *  login, ou modo teste do Pronto via `?teste=<token>`). Recalcula a decisão do zero (nunca confia no que a página
 *  ou o GET mandaram) — cria a sessão, grava o cookie e redireciona para a sala; qualquer condição que já não bate
 *  mais (sala ficou cheia, token de teste inválido, UA de bot) volta para a raiz da sala sem criar nada. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugValido(slug)) return respostaIndisponivel();

  const ua = req.headers.get("user-agent");
  if (ehBotDePreview(ua)) {
    // Um bot não executa o <script> nem envia o formulário de verdade — isso só é alcançado se algo (proxy,
    // pré-busca) fizer o POST sozinho. Devolve a mesma página sem criar sessão.
    const q = buscaComoObjeto(req.nextUrl);
    return respostaFormulario(await caminhoSala(slug, "entrar"), q);
  }

  const q = buscaComoObjeto(req.nextUrl);
  const corpo = await req.formData().catch(() => null);
  if (corpo) {
    for (const [k, v] of corpo.entries()) if (typeof v === "string") q[k] = v;
  }

  const caminhoRaiz = await caminhoSala(slug);
  // Base dos redirecionamentos: o domínio da sala que o navegador usou (ver `origemDoRedirecionamento`).
  const origem = origemDoRedirecionamento(req.url, req.headers.get("host"), process.env.NEXT_PUBLIC_SALA_URL);
  const sala = await carregarSala(slug);
  if (!sala) return NextResponse.redirect(new URL(caminhoRaiz, origem));

  const webinarId = sala.webinar.id;
  const agora = new Date();
  const agoraSeg = Math.floor(agora.getTime() / 1000);

  // Link de acesso do e-mail: só grava o cookie da sessão que o token aponta (assinatura de acesso, não expirado,
  // do mesmo webinar, sessão existente desse webinar). Qualquer falha volta para a raiz, que segue a entrada
  // normal (no JIT, a página de inscrição) — nunca cria sessão nova por aqui.
  if (q.acesso !== undefined) {
    const acesso = verificarTokenAcesso(q.acesso, env("SALA_TOKEN_SECRET"), agoraSeg);
    if (!acesso || acesso.w !== webinarId) return NextResponse.redirect(new URL(caminhoRaiz, origem));
    try {
      const alvo = await sessaoDoAcesso(acesso.s, webinarId);
      if (!alvo) return NextResponse.redirect(new URL(caminhoRaiz, origem));
      const exp = alvo.jitHorario ? expCookieJit(alvo.jitHorario, sala.video?.duracaoSeg || null, agora) : agoraSeg + 12 * 60 * 60;
      const res = NextResponse.redirect(new URL(caminhoRaiz, origem));
      const { name, value, ...opcoes } = cookieDaSessao(webinarId, tokenDaSessao(acesso.s, webinarId, exp), exp - agoraSeg);
      res.cookies.set(name, value, opcoes);
      return res;
    } catch {
      return NextResponse.redirect(new URL(caminhoRaiz, origem));
    }
  }

  const { estado, janela } = sala.agenda ? estadoSala(sala.agenda, agora) : { estado: "encerrada" as const, janela: null };

  const replay = q.replay === "1";
  const tokenTeste = q.teste ? verificarTokenTeste(q.teste, env("SALA_TOKEN_SECRET"), agoraSeg) : null;
  const teste = !!tokenTeste && tokenTeste.w === webinarId;

  // Mesma regra da raiz: sessão de teste no cookie só conta com o link de teste (senão o link mágico voltava pra
  // raiz, que ignora a sessão de teste e mandava pra cá de novo, em loop).
  const sessaoCookie = await lerSessaoDoCookie(webinarId);
  const sessaoExistente = sessaoCookie?.modo === "teste" && !teste ? null : sessaoCookie;
  const cheia = await salaCheia(webinarId, sala.webinar.limiteSimultaneo, agora);
  const campos = camposLinkMagico(q);
  const linkMagicoValido = !!(campos.nome || campos.email || campos.telefone);

  const decisao = decidirEntrada({
    webinarAtivo: sala.webinar.status === "ativo",
    temVideo: !!sala.video,
    estado,
    replay,
    teste,
    temSessao: !!sessaoExistente,
    cheia,
    acessoFacilitado: sala.webinar.acessoFacilitado,
    linkMagicoValido,
  });

  if (decisao !== "criar_sessao_magica" && decisao !== "criar_sessao_provisoria" && decisao !== "criar_sessao_teste") {
    return NextResponse.redirect(new URL(caminhoRaiz, origem));
  }
  // Just in time: a sessão nasce na inscrição (`/lp`), com o horário escolhido. Aqui só o teste do Pronto.
  if (sala.webinar.tipoAgenda === "jit" && decisao !== "criar_sessao_teste") {
    return NextResponse.redirect(new URL(caminhoRaiz, origem));
  }

  // Teste: sessão nova, nunca provisória (o produtor pode mandar mensagem sem cadastro), sem evento nem métrica.
  // Aceita os campos do link mágico (`&nome=&telefone=&email=`) pra testar webhook com dados preenchidos.
  const dados =
    decisao === "criar_sessao_magica"
      ? { nome: campos.nome?.trim() || "Visitante", email: campos.email ?? null, telefone: campos.telefone ?? null }
      : decisao === "criar_sessao_teste"
        ? {
            nome: campos.nome?.trim() || "Teste",
            email: campos.email?.trim() || null,
            // Mesmo formato do cadastro normal (E.164), pra o webhook receber o telefone idêntico ao de um lead.
            telefone: campos.telefone ? paraE164(campos.telefone, sala.telaLogin.paisPadrao as CountryCode) ?? campos.telefone : null,
          }
        : { nome: "Visitante", email: null, telefone: null };

  try {
    const { token } = await criarSessao({
      sala,
      dados,
      temporario: decisao === "criar_sessao_provisoria",
      utms: utmsDaUrl(q),
      modo: decisao === "criar_sessao_teste" ? "teste" : replay ? "replay" : "ao_vivo",
      janelaInicio: janela?.inicio ?? null,
      agora,
      geo: geoDoCabecalho(req.headers),
      dispositivo: dispositivoDoUserAgent(ua),
      navegador: ua,
      ipHash: ipHashDoCabecalho(req.headers),
      linkMagico: decisao === "criar_sessao_magica",
    });

    const res = NextResponse.redirect(new URL(await caminhoSala(slug, "sala"), origem));
    const { name, value, ...opcoes } = cookieDaSessao(webinarId, token);
    res.cookies.set(name, value, opcoes);
    // Link mágico é um cadastro novo: a sala dispara o pixel de lead uma vez (cookie de uso único).
    if (decisao === "criar_sessao_magica") {
      const novo = cookieNovoCadastro(webinarId);
      res.cookies.set(novo.name, novo.value, novo);
    }
    return res;
  } catch {
    return NextResponse.redirect(new URL(caminhoRaiz, origem));
  }
}
