import { NextResponse, type NextRequest } from "next/server";
import { ehBotDePreview, origemDoRedirecionamento, slugValido } from "@/src/lib/regras/sala";
import { criarTokenAb, verificarTokenAb } from "@/src/lib/regras/sessao-token";
import { DIAS_COOKIE_AB, dentroDoPeriodo, escolherVariacaoAb, nomeCookieAb, nomeCookieAbWebinar } from "@/src/lib/regras/teste-ab";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import { env } from "@/src/lib/env";
import { carregarTesteAb, type VariacaoAtivaAb } from "@/src/lib/sala/teste-ab";
import { caminhoSala } from "@/src/lib/sala/caminho";
import { paginaMinima } from "@/src/lib/sala/pagina-minima";

const SEG_COOKIE = DIAS_COOKIE_AB * 24 * 60 * 60;

function respostaHtml(html: string, status: number): NextResponse {
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function naoEncontrado(): NextResponse {
  return respostaHtml(paginaMinima(`<p>${t("pt-BR", "indisponivel")}</p>`), 404);
}

function indisponivel(idioma: Idioma): NextResponse {
  return respostaHtml(paginaMinima(`<p>${t(idioma, "linkIndisponivel")}</p>`), 200);
}

async function redirecionar(req: NextRequest, v: VariacaoAtivaAb): Promise<NextResponse> {
  // Origem do domínio da sala que o navegador usou, não a do `req.url` (em dev ela vem como `localhost`).
  const url = new URL(await caminhoSala(v.slug), origemDoRedirecionamento(req.url, req.headers.get("host"), process.env.NEXT_PUBLIC_SALA_URL));
  url.search = req.nextUrl.search; // UTMs e o resto da query seguem para o webinar
  const res = NextResponse.redirect(url, 307);
  res.headers.set("cache-control", "no-store");
  return res;
}

function opcoesCookie(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

/**
 * Entrada do teste A/B (`/t/<slug>` no domínio da sala). Só escolhe a variação e redireciona: nunca cria sessão nem
 * evento (a sessão nasce na entrada do webinar, que lê o cookie de marcação `vw_abw_<webinarId>`).
 * - Teste inexistente → 404. Arquivado, fora do período ou sem webinar ativo → "Este link não está disponível agora."
 * - Robô de pré-visualização → variação A, sem cookie (não conta no sorteio). Pré-busca/pré-renderização do
 *   navegador (`Sec-Purpose: prefetch`) NÃO é tratada como robô: a resposta pré-buscada é a que o navegador usa
 *   quando a pessoa abre o link, então ela precisa do sorteio e dos cookies (senão cairia sempre na A, sem marcação).
 *   Esta rota não cria sessão nem evento, então pré-busca não infla nenhuma métrica.
 * - Cookie `vw_ab_<testeId>` válido e ainda variação ativa → a mesma; senão sorteia pelo percentual e grava.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugValido(slug)) return naoEncontrado();

  const teste = await carregarTesteAb(slug).catch(() => null);
  if (!teste) return naoEncontrado();

  const agora = new Date();
  if (!dentroDoPeriodo(teste, agora) || teste.variacoes.length === 0) return indisponivel(teste.idioma);

  if (ehBotDePreview(req.headers.get("user-agent"))) return redirecionar(req, teste.variacoes[0]);

  const segredo = env("SALA_TOKEN_SECRET");
  const agoraSeg = Math.floor(agora.getTime() / 1000);
  const valor = req.cookies.get(nomeCookieAb(teste.id))?.value;
  const doCookie = valor ? verificarTokenAb(valor, segredo, agoraSeg) : null;
  const webinarDoCookie = doCookie && doCookie.t === teste.id ? doCookie.w : null;

  const escolha = escolherVariacaoAb(teste.variacoes, webinarDoCookie, Math.random);
  if (!escolha) return indisponivel(teste.idioma);
  const { variacao, sorteada } = escolha;

  const exp = sorteada || !doCookie ? agoraSeg + SEG_COOKIE : doCookie.exp;
  const token = criarTokenAb({ t: teste.id, w: variacao.webinarId, exp }, segredo);
  const res = await redirecionar(req, variacao);
  if (sorteada) res.cookies.set(nomeCookieAb(teste.id), token, opcoesCookie(SEG_COOKIE));
  res.cookies.set(nomeCookieAbWebinar(variacao.webinarId), token, opcoesCookie(Math.max(60, exp - agoraSeg)));
  return res;
}
