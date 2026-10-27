"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { decidirEntrada, slugValido, utmsDaUrl, validarCadastro } from "@/src/lib/regras/sala";
import { estadoSala } from "@/src/lib/regras/agenda";
import { carregarSala, salaCheia } from "@/src/lib/sala/dados";
import { caminhoSala } from "@/src/lib/sala/caminho";
import { cookieDaSessao, cookieNovoCadastro, criarSessao, geoDoCabecalho, ipHashDoCabecalho, lerSessaoDoCookie } from "@/src/lib/sala/sessao";

export type ResultadoEntrada = {
  erro?: string;
  valores?: { nome?: string; email?: string; telefone?: string };
};

const ERRO_SESSAO = "Não deu para abrir sua sessão.";

function dispositivoDoUserAgent(ua: string | null): "mobile" | "desktop" {
  return ua && /mobile|android|iphone/i.test(ua) ? "mobile" : "desktop";
}

/** O campo oculto `utms` chega como JSON cru do cliente — nunca confiar nele sem passar pelo mesmo filtro da
 *  query string (`utmsDaUrl`: só chaves `utm_*`, só valores string, no máximo 10 chaves, 200 caracteres cada). */
function utmsDoCampo(valor: FormDataEntryValue | null): Record<string, string> {
  let bruto: unknown;
  try {
    bruto = JSON.parse(String(valor ?? "{}"));
  } catch {
    return {};
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return {};

  const somenteString: Record<string, string> = {};
  for (const [chave, v] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof v === "string") somenteString[chave] = v;
  }
  return utmsDaUrl(somenteString);
}

/** Cadastro da tela de login da sala. Erro de validação ou de sessão devolve `{ erro, valores }` (nunca lança);
 *  sucesso redireciona para a sala. */
export async function entrar(slug: string, _prev: ResultadoEntrada, form: FormData): Promise<ResultadoEntrada> {
  // Defesa (a página já nunca chega a renderizar este formulário com um slug fora do formato): nunca segue com um
  // slug que poderia compor um caminho/redirect pra outro host.
  if (!slugValido(slug)) return { erro: "Sala não encontrada." };

  const valores = {
    nome: String(form.get("nome") ?? ""),
    email: String(form.get("email") ?? ""),
    telefone: String(form.get("telefone") ?? ""),
  };
  const replay = String(form.get("replay") ?? "") === "1";
  const utms = utmsDoCampo(form.get("utms"));

  const sala = await carregarSala(slug);
  if (!sala) redirect(await caminhoSala(slug));
  // Just in time não usa esta tela (a inscrição é na `/lp`): a raiz decide.
  if (sala.webinar.tipoAgenda === "jit") redirect(await caminhoSala(slug));

  const resultado = validarCadastro(valores, sala.telaLogin);
  if ("erro" in resultado) return { erro: resultado.erro, valores };

  const agora = new Date();
  const { estado, janela } = sala.agenda ? estadoSala(sala.agenda, agora) : { estado: "encerrada" as const, janela: null };
  // Sessão de teste só vale pelo link de teste: quem abriu o teste antes e se cadastra no link normal entra como
  // participante (sem isso, a sessão de teste do cookie mandava de volta pra sala de teste).
  const sessaoCookie = await lerSessaoDoCookie(sala.webinar.id);
  const sessao = sessaoCookie?.modo === "teste" ? null : sessaoCookie;
  const cheia = await salaCheia(sala.webinar.id, sala.webinar.limiteSimultaneo, agora);

  const decisao = decidirEntrada({
    webinarAtivo: sala.webinar.status === "ativo",
    temVideo: !!sala.video,
    estado,
    replay,
    teste: false,
    temSessao: !!sessao,
    cheia,
    acessoFacilitado: sala.webinar.acessoFacilitado,
    linkMagicoValido: false,
  });

  if (decisao === "indisponivel") redirect(await caminhoSala(slug));
  if (decisao === "espera") redirect(await caminhoSala(slug, "espera"));
  if (decisao === "encerrada") redirect(await caminhoSala(slug));
  if (decisao === "cheia") redirect(await caminhoSala(slug, "cheia"));
  const caminhoDaSala = `${await caminhoSala(slug, "sala")}${replay ? "?replay=1" : ""}`;
  if (decisao === "sala") redirect(caminhoDaSala);
  // Só resta "login" ou "criar_sessao_provisoria" — este formulário só é renderizado quando a página decide
  // "login" (acesso facilitado nem mostra a tela), então "criar_sessao_provisoria" aqui é só defensivo: o admin
  // pode ter ligado o acesso facilitado no meio da visita, com o formulário já aberto no navegador da pessoa.
  // Em qualquer um dos dois casos, o certo é seguir e criar a sessão com o que foi digitado.

  try {
    const h = await headers();
    const { token } = await criarSessao({
      sala,
      dados: resultado.dados,
      temporario: false,
      utms,
      modo: replay ? "replay" : "ao_vivo",
      janelaInicio: janela?.inicio ?? null,
      agora,
      geo: geoDoCabecalho(h),
      dispositivo: dispositivoDoUserAgent(h.get("user-agent")),
      navegador: h.get("user-agent"),
      ipHash: ipHashDoCabecalho(h),
      linkMagico: false,
    });

    const { name, value, ...opcoes } = cookieDaSessao(sala.webinar.id, token);
    const jar = await cookies();
    jar.set(name, value, opcoes);
    // Só depois do cadastro dar certo: a sala lê este cookie de uso único e dispara o pixel de lead uma vez.
    const novo = cookieNovoCadastro(sala.webinar.id);
    jar.set(novo.name, novo.value, novo);
  } catch {
    return { erro: ERRO_SESSAO, valores };
  }

  redirect(caminhoDaSala);
}
