import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { estadoSalaJit, modoDaSala, slugValido } from "@/src/lib/regras/sala";
import { t } from "@/src/lib/regras/textos-sala";
import { carregarSalaCached as carregarSala, carregarMinhasMensagens } from "@/src/lib/sala/dados";
import { metadadosCompartilhamento } from "@/src/lib/sala/metadados";
import { caminhoSala } from "@/src/lib/sala/caminho";
import { lerSessaoDoCookie, mudarSessaoParaReplay } from "@/src/lib/sala/sessao";
import Indisponivel from "../indisponivel";
import Sala, { type SalaProps } from "./_sala/Sala";

type Busca = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!slugValido(slug)) return {};
  const sala = await carregarSala(slug);
  return sala ? metadadosCompartilhamento(sala) : {};
}

function normalizarBusca(sp: Busca): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    r[k] = Array.isArray(v) ? v[0] ?? "" : v;
  }
  return r;
}

/** Sala do webinar: vídeo travado no "ao vivo" (ou replay/teste), relógio sincronizado, chat, suporte, oferta,
 *  sorteio, público, fim e layout horizontal/vertical.
 *  Sem sessão válida (cookie ausente, expirado ou de outro webinar), volta pra entrada da sala, que decide o que
 *  mostrar (login, espera, cheia, etc.). */
export default async function SalaDoWebinar({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Busca>;
}) {
  const { slug } = await params;
  if (!slugValido(slug)) redirect("/");

  const sp = normalizarBusca(await searchParams);

  const sala = await carregarSala(slug);
  if (!sala || !sala.video) redirect(await caminhoSala(slug));
  // Arquivado: indisponível mesmo pra quem ainda tem o cookie de uma sessão de antes.
  if (sala.webinar.status !== "ativo") return <Indisponivel idioma={sala.webinar.idioma} />;

  const sessao = await lerSessaoDoCookie(sala.webinar.id);
  if (!sessao) redirect(await caminhoSala(slug));

  // Just in time ao vivo: só dentro da janela do horário escolhido (antes → espera, depois → encerrada/replay,
  // sem horário → inscrição); a raiz decide. O relógio do vídeo parte do horário escolhido.
  const jit = sala.webinar.tipoAgenda === "jit" && sessao.modo === "ao_vivo" && sp.replay !== "1";
  if (jit) {
    if (!sessao.jitHorario) redirect(await caminhoSala(slug));
    if (estadoSalaJit(sessao.jitHorario, sala.video.duracaoSeg || null, new Date()).estado !== "aberta") redirect(await caminhoSala(slug));
  }
  const inicioSessao = jit && sessao.jitHorario ? sessao.jitHorario : sessao.inicioSessao;

  // `?replay=1` (link do Pronto ou da tela de encerrada) com sessão ao vivo: a sessão vira replay no servidor,
  // pra o `sinal` salvar a posição e a retenção não contar como ao vivo.
  const { modo, trocarParaReplay } = modoDaSala(sessao.modo, sp.replay === "1");
  if (trocarParaReplay) await mudarSessaoParaReplay(sessao.sessaoId);

  // Respostas antigas do chatbot (descontinuado) aparecem como "Suporte".
  const rotuloSuporte = t(sala.webinar.idioma, "suporte");
  const minhasMensagens = (await carregarMinhasMensagens(sessao.sessaoId)).map((m) => (m.autor === "chatbot" ? { ...m, nomeExibicao: rotuloSuporte } : m));

  const props: SalaProps = {
    webinar: {
      id: sala.webinar.id,
      titulo: sala.webinar.titulo,
      idioma: sala.webinar.idioma,
      apresentadorNome: sala.webinar.apresentadorNome,
      apresentadorAvatarUrl: sala.webinar.apresentadorAvatarUrl,
      tituloNotificacaoCompra: sala.webinar.tituloNotificacaoCompra,
      pixelMeta: sala.webinar.pixelMeta,
      pixelTiktok: sala.webinar.pixelTiktok,
      gtm: sala.webinar.gtm,
      scriptPersonalizado: sala.webinar.scriptPersonalizado,
    },
    video: sala.video,
    relogio: {
      inicioSessao: inicioSessao.getTime(),
      agoraServidor: Date.now(),
      modo,
      // Replay recém-trocado a partir do ao vivo: começa do zero (nada salvo ainda).
      posicaoReplaySeg: trocarParaReplay ? 0 : sessao.posicaoReplaySeg ?? 0,
    },
    participante: { nome: sessao.participanteNome, email: sessao.participanteEmail, telefoneE164: sessao.participanteTelefone },
    oferta: sala.oferta,
    audiencia: sala.audiencia ?? { modo: "oculto", minimo: null, maximo: null, seloAoVivo: false },
    tarjas: sala.tarjas,
    cadastro: {
      pedeEmail: sala.telaLogin.pedeEmail,
      emailObrigatorio: sala.telaLogin.emailObrigatorio,
      pedeTelefone: sala.telaLogin.pedeTelefone,
      telefoneObrigatorio: sala.telaLogin.telefoneObrigatorio,
      placeholderNome: sala.telaLogin.placeholderNome,
      placeholderEmail: sala.telaLogin.placeholderEmail,
      placeholderTelefone: sala.telaLogin.placeholderTelefone,
      botaoTexto: sala.telaLogin.botaoTexto,
      botaoCor: sala.telaLogin.botaoCor,
      botaoCorTexto: sala.telaLogin.botaoCorTexto,
    },
    utms: sessao.utms,
    minhasMensagens,
  };

  return <Sala {...props} />;
}
