import { redirect } from "next/navigation";
import { estadoSalaJit, MINUTOS_ENTRADA_ANTES_JIT, slugValido } from "@/src/lib/regras/sala";
import { carregarSalaCached as carregarSala } from "@/src/lib/sala/dados";
import { caminhoSala } from "@/src/lib/sala/caminho";
import { lerSessaoDoCookie, linkDeAcessoDaSessao } from "@/src/lib/sala/sessao";
import Indisponivel from "../indisponivel";
import Confirmacao from "./confirmacao";

export const metadata = { robots: { index: false, follow: false } };

/** Inscrição confirmada do just in time: data/hora escolhida, "Entrar na sala" (libera 10 min antes, com contagem)
 *  e "Adicionar à agenda" (.ics gerado no navegador). Sem sessão de inscrição no cookie → página de inscrição. */
export default async function Inscrito({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugValido(slug)) return <Indisponivel idioma="pt-BR" />;

  const sala = await carregarSala(slug);
  if (!sala) return <Indisponivel idioma="pt-BR" />;
  if (sala.webinar.tipoAgenda !== "jit" || !sala.jit) redirect(await caminhoSala(slug));

  const sessao = await lerSessaoDoCookie(sala.webinar.id);
  if (!sessao || !sessao.jitHorario) redirect(await caminhoSala(slug, "lp"));

  const { janela } = estadoSalaJit(sessao.jitHorario, sala.video?.duracaoSeg || null, new Date());

  // Link do calendário: o link de acesso individual (abre em qualquer aparelho); sem a URL da sala configurada (dev),
  // o cliente usa o endereço da própria página.
  let linkAcesso: string | null = null;
  try {
    linkAcesso = linkDeAcessoDaSessao({ slug, sessaoId: sessao.sessaoId, webinarId: sala.webinar.id, jitHorario: sessao.jitHorario });
  } catch {
    linkAcesso = null;
  }

  return (
    <Confirmacao
      idioma={sala.webinar.idioma}
      titulo={sala.webinar.titulo}
      fuso={sala.jit.config.fuso}
      inicioMs={janela.inicio.getTime()}
      abreMs={janela.inicio.getTime() - MINUTOS_ENTRADA_ANTES_JIT * 60_000}
      fimMs={janela.fim.getTime()}
      agoraServidor={Date.now()}
      caminhoEntrada={await caminhoSala(slug)}
      caminhoLp={await caminhoSala(slug, "lp")}
      linkAcesso={linkAcesso}
    />
  );
}
