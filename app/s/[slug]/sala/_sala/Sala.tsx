"use client";
import AtalhosTeste, { momentosDoTeste } from "./AtalhosTeste";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Paperclip, SendHorizontal } from "lucide-react";
import { marcosDeTempo, transmissaoEncerrada, type Marco } from "@/src/lib/regras/relogio";
import { decidirLayoutSala } from "@/src/lib/regras/player";
import { momentos } from "@/src/lib/regras/momentos";
import { linkOfertaSeguro } from "@/src/lib/regras/sala";
import { nomeCookieNovoCadastro, valorCookie } from "@/src/lib/regras/pixels";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import type { SalaAudiencia, SalaOferta, SalaTarja, SalaVideo, SalaWebinar } from "@/src/lib/sala/dados";
import type { MinhaMensagem } from "@/src/lib/sala/dados";
import Player from "./Player";
import Fim from "./Fim";
import Pixels from "./Pixels";
import Abas, { type AbaChave } from "./Abas";
import Chat from "./Chat";
import OfertaCard, { BarraOferta } from "./Oferta";
import Sorteio from "./Sorteio";
import Publico from "./Publico";
import AvisoVenda from "./AvisoVenda";
import TarjaAviso from "./TarjaAviso";
import CadastroModal, { type SalaCadastro } from "./CadastroModal";
import { useRelogio, type ModoRelogio } from "./useRelogio";
import { useLinhaDoTempo } from "./useLinhaDoTempo";
import { useContagemOferta } from "./useContagemOferta";
import { useSuporte, type MensagemSuporteApi } from "./useSuporte";
import { validarImagem } from "@/src/lib/regras/midia";
import type { MensagemPrivada } from "./tipos";
import { SelosSeguranca } from "../../_ui/sala-ui";

export type SalaProps = {
  webinar: Pick<
    SalaWebinar,
    | "id"
    | "titulo"
    | "idioma"
    | "apresentadorNome"
    | "apresentadorAvatarUrl"
    | "tituloNotificacaoCompra"
    | "pixelMeta"
    | "pixelTiktok"
    | "gtm"
    | "scriptPersonalizado"
  >;
  video: NonNullable<SalaVideo>;
  relogio: { inicioSessao: number; agoraServidor: number; modo: ModoRelogio; posicaoReplaySeg: number };
  participante: { nome: string; email: string | null; telefoneE164: string | null };
  oferta: SalaOferta;
  audiencia: NonNullable<SalaAudiencia>;
  /** Tarjas de aviso ligadas (faixa sobre o vídeo num momento do vídeo). */
  tarjas: SalaTarja[];
  cadastro: SalaCadastro;
  utms: Record<string, string>;
  minhasMensagens: MinhaMensagem[];
};

const LARGURA_VERTICAL = 950;
const INTERVALO_SINAL_MS = 30_000;

async function postSala(caminho: string, corpo: Record<string, unknown>) {
  try {
    await fetch(`/api/sala/${caminho}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  } catch {
    /* falha de rede num evento de métrica não deve quebrar a sala. */
  }
}

type ResultadoEnvio = "ok" | "cadastro" | "erro";

/** Mescla as mensagens recém-chegadas do polling (`/api/sala/suporte`) nas já exibidas: por `id`, uma edição
 *  substitui, mantendo o `segundo` que a mensagem já tinha (pra não saltar de lugar no feed misto da aba Chat) —
 *  uma mensagem nova do atendente/IA, sem `segundo` ainda, entra na posição atual do vídeo. */
function mesclarComServidor(atual: MensagemPrivada[], doServidor: MensagemSuporteApi[], segundoAtual: number): MensagemPrivada[] {
  const mapa = new Map(atual.map((m) => [m.id, m]));
  for (const m of doServidor) {
    const existente = mapa.get(m.id);
    mapa.set(m.id, {
      id: m.id,
      autor: m.autor,
      texto: m.texto,
      imagemUrl: m.imagemUrl,
      criadaEm: m.criadaEm,
      atualizadaEm: m.atualizadaEm,
      apagada: m.apagada,
      nomeExibicao: m.nomeAutor ?? existente?.nomeExibicao,
      segundo: existente?.segundo ?? segundoAtual,
    });
  }
  return Array.from(mapa.values());
}

export default function Sala({ webinar, video, relogio, participante, oferta, audiencia, tarjas, cadastro, utms, minhasMensagens }: SalaProps) {
  const idioma: Idioma = webinar.idioma;
  const { segundo, segundoRef, setSegundo, segundoEsperado, agoraServidorMs, posicaoInicial } = useRelogio(relogio);

  // `null` até montar: servidor e primeiro render do cliente usam o mesmo layout (horizontal), sem erro de
  // hidratação; a largura real entra no efeito.
  const [largura, setLargura] = useState<number | null>(null);
  const [fim, setFim] = useState(false);
  const [aba, setAba] = useState<AbaChave>("chat");
  const [cadastroNovo, setCadastroNovo] = useState(false);
  const [nomeParticipante, setNomeParticipante] = useState(participante.nome);
  // A sala "começa" no clique em "Clique para ouvir/assistir": antes disso o campo de mensagem fica desligado.
  const [iniciada, setIniciada] = useState(false);

  // As já gravadas (voltou pra sala) entram no feed do chat no ponto do vídeo em que foram mandadas: no ao vivo, o
  // tempo desde o início da sessão; no replay/teste não dá pra saber, ficam no começo.
  const [mensagensPrivadas, setMensagensPrivadas] = useState<MensagemPrivada[]>(
    minhasMensagens.map((m) => ({
      id: m.id,
      autor: m.autor,
      texto: m.texto,
      imagemUrl: m.imagemUrl,
      criadaEm: m.criadaEm,
      apagada: m.apagada,
      nomeExibicao: m.nomeExibicao,
      segundo: relogio.modo === "ao_vivo" ? Math.max(0, Math.floor((new Date(m.criadaEm).getTime() - relogio.inicioSessao) / 1000)) : 0,
    })),
  );
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [mostrarCadastro, setMostrarCadastro] = useState(false);
  const pendenteRef = useRef<string | null>(null);
  const arquivoInputRef = useRef<HTMLInputElement | null>(null);

  const marcosEnviadosRef = useRef<Set<Marco>>(new Set());
  const ultimoMinutoSinalRef = useRef(-1);
  const abaForcadaRef = useRef<{ oferta: boolean; sorteio: boolean }>({ oferta: false, sorteio: false });

  // Sala aberta por navegação interna do Next (depois do cadastro, ou da sala de espera): recarrega a página uma vez.
  // No iPhone, a rolagem que o teclado deixou na tela anterior continuava aqui e desalinhava os toques — o campo do
  // chat e os botões de baixo (inclusive o da oferta) não respondiam até a pessoa atualizar a página. Depois do
  // recarregamento, o documento já é a própria sala e isto não roda de novo.
  useEffect(() => {
    const navegacao = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!navegacao) return;
    if (new URL(navegacao.name).pathname !== window.location.pathname) window.location.replace(window.location.href);
  }, []);

  const ehReplay = relogio.modo === "replay";
  const ehTeste = relogio.modo === "teste";
  // Modo teste: os atalhos pulam o vídeo direto pro momento (o player do teste já tem os controles liberados).
  const caixaVideoRef = useRef<HTMLDivElement>(null);
  function irParaNoTeste(segundoAlvo: number) {
    const caixa = caixaVideoRef.current;
    const v = caixa?.querySelector("video");
    if (!caixa || !v) return;
    // Tira o aviso "clique para ouvir/assistir" (mesmo caminho do clique da pessoa), pula e já dá play com som.
    caixa.querySelector<HTMLButtonElement>("[data-comecar-video]")?.click();
    v.currentTime = segundoAlvo;
    v.muted = false;
    const tocar = () => void v.play().catch(() => {
      // Navegador recusou com som: toca mudo pra não ficar parado.
      v.muted = true;
      void v.play().catch(() => {});
    });
    tocar();
    v.addEventListener("seeked", tocar, { once: true });
  }
  const chaveNovoCadastro = nomeCookieNovoCadastro(webinar.id);

  // Linha do tempo também no teste (o produtor confere chat e vendas simuladas); a API não grava nada.
  const { mensagens: mensagensSimuladas, vendasVisiveis, vendasNovas, consumirVendasNovas } = useLinhaDoTempo(webinar.id, segundo, true);

  // Respostas do atendimento (atendente/IA), que aparecem no próprio chat marcando a pessoa, por polling: só depois
  // da primeira mensagem da pessoa (o `minhasMensagens` carregado no servidor já conta), 3 s com a aba Chat aberta,
  // 10 s fora dela, parando no fim da transmissão. O participante nunca usa Supabase Realtime.
  const jaComecouSuporte = mensagensPrivadas.some((m) => m.autor === "participante");
  const recebidasSuporte = useSuporte(webinar.id, jaComecouSuporte, aba === "chat", fim || ehTeste);

  useEffect(() => {
    if (recebidasSuporte.length === 0) return;
    setMensagensPrivadas((atual) => mesclarComServidor(atual, recebidasSuporte, Math.floor(segundoRef.current)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recebidasSuporte]);

  useEffect(() => {
    function aoRedimensionar() {
      setLargura(window.innerWidth);
    }
    aoRedimensionar();
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, []);

  // Celular (< 950 px): a sala ocupa a área visível de verdade e fica presa nela. No Android o teclado encolhe o
  // layout (`interactive-widget=resizes-content` no viewport da sala); no iOS não — `100dvh` continua a tela toda, só
  // o `visualViewport` encolhe e, ao focar o campo de mensagem, ele ainda desliza pra baixo (`offsetTop`) pra mostrar
  // o campo. Com a sala `fixed` no topo e na altura da área visível, o vídeo continua em cima e o campo logo acima do
  // teclado, sem a tela descer.
  const celular = largura !== null && largura < LARGURA_VERTICAL;
  const [areaVisivel, setAreaVisivel] = useState<{ altura: number; topo: number } | null>(null);
  useEffect(() => {
    if (!celular) {
      setAreaVisivel(null);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    function atualizar() {
      setAreaVisivel({ altura: Math.round(vv!.height), topo: Math.max(0, Math.round(vv!.offsetTop)) });
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    }
    atualizar();
    vv.addEventListener("resize", atualizar);
    vv.addEventListener("scroll", atualizar);
    return () => {
      vv.removeEventListener("resize", atualizar);
      vv.removeEventListener("scroll", atualizar);
    };
  }, [celular]);

  // Cadastro novo: o servidor deixa um cookie de uso único depois do login/link mágico que deu certo. Passa pro
  // `sessionStorage` (sobrevive a um recarregamento) e apaga o cookie.
  useEffect(() => {
    let novo = false;
    try {
      if (valorCookie(document.cookie, chaveNovoCadastro) === "1") {
        document.cookie = `${chaveNovoCadastro}=; Max-Age=0; path=/; secure; samesite=lax`;
        sessionStorage.setItem(chaveNovoCadastro, "1");
        novo = true;
      }
      novo = novo || sessionStorage.getItem(chaveNovoCadastro) === "1";
    } catch {
      /* segue como "não é cadastro novo" — pior caso é não disparar o pixel de lead. */
    }
    setCadastroNovo(novo);
  }, [chaveNovoCadastro]);

  // Evento de acesso, uma vez por sessão (o servidor ignora repetição pelo `unique (sessao_id, tipo)`).
  useEffect(() => {
    if (ehTeste) return;
    void postSala("evento", { w: webinar.id, tipo: "acessou_sala", segundo: 0 });
  }, [webinar.id, ehTeste]);

  // Marcos de tempo (15/30/45/60 min) e sinal de presença quando o minuto muda.
  useEffect(() => {
    if (ehTeste) return;
    for (const marco of marcosDeTempo(segundo)) {
      if (!marcosEnviadosRef.current.has(marco)) {
        marcosEnviadosRef.current.add(marco);
        void postSala("evento", { w: webinar.id, tipo: marco, segundo: Math.floor(segundo) });
      }
    }
    const minuto = Math.floor(segundo / 60);
    if (minuto !== ultimoMinutoSinalRef.current) {
      ultimoMinutoSinalRef.current = minuto;
      void postSala("sinal", { w: webinar.id, segundo: Math.floor(segundo) });
    }
  }, [segundo, webinar.id, ehTeste]);

  // Sinal de presença a cada 30 s, sempre com a posição atual (lida da ref, não a do momento da montagem).
  useEffect(() => {
    if (ehTeste) return;
    const id = setInterval(() => void postSala("sinal", { w: webinar.id, segundo: Math.floor(segundoRef.current) }), INTERVALO_SINAL_MS);
    return () => clearInterval(id);
  }, [webinar.id, ehTeste, segundoRef]);

  // Fim da transmissão. Ao vivo: pelo relógio da sala (checado a cada 1 s, mesmo com o vídeo atrasado ou parado);
  // replay: pela posição do vídeo; e, em qualquer modo, pelo `ended` do vídeo (onFim do player).
  useEffect(() => {
    if (relogio.modo !== "ao_vivo") return;
    function checar() {
      const acabou = transmissaoEncerrada({
        modo: "ao_vivo",
        inicioSessaoMs: relogio.inicioSessao,
        agoraServidorMs: agoraServidorMs(),
        duracaoSeg: video.duracaoSeg,
        segundoVideo: segundoRef.current,
      });
      if (acabou) setFim(true);
    }
    checar();
    const id = setInterval(checar, 1000);
    return () => clearInterval(id);
  }, [relogio.modo, relogio.inicioSessao, video.duracaoSeg, agoraServidorMs, segundoRef]);

  useEffect(() => {
    if (relogio.modo !== "replay") return;
    const acabou = transmissaoEncerrada({ modo: "replay", inicioSessaoMs: relogio.inicioSessao, agoraServidorMs: 0, duracaoSeg: video.duracaoSeg, segundoVideo: segundo });
    if (acabou) setFim(true);
  }, [segundo, relogio.modo, relogio.inicioSessao, video.duracaoSeg]);

  const aoTerminarVideo = useCallback(() => setFim(true), []);

  // Momentos (pitch/oferta/sorteio) — abrem as abas correspondentes na hora em que aparecem e mandam os eventos.
  const momentosAtual = momentos(oferta, Math.floor(segundo), fim);

  useEffect(() => {
    if (!momentosAtual.pitch || ehTeste) return;
    void postSala("evento", { w: webinar.id, tipo: "pitch", segundo: Math.floor(segundoRef.current) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [momentosAtual.pitch]);

  useEffect(() => {
    if (!momentosAtual.oferta) return;
    // Também no teste: o servidor não grava métrica, só dispara os webhooks da oferta.
    void postSala("evento", { w: webinar.id, tipo: "oferta", segundo: Math.floor(segundoRef.current) });
    if (!abaForcadaRef.current.oferta) {
      abaForcadaRef.current.oferta = true;
      setAba("oferta");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [momentosAtual.oferta]);

  useEffect(() => {
    if (!momentosAtual.oferta && abaForcadaRef.current.oferta) {
      abaForcadaRef.current.oferta = false;
      setAba((atual) => (atual === "oferta" ? "chat" : atual));
    }
  }, [momentosAtual.oferta]);

  useEffect(() => {
    if (!momentosAtual.sorteio || abaForcadaRef.current.sorteio) return;
    abaForcadaRef.current.sorteio = true;
    setAba("sorteio");
  }, [momentosAtual.sorteio]);

  const restanteOferta = useContagemOferta(webinar.id, oferta?.contagemSeg ?? 0, momentosAtual.oferta);

  const aoClicarVideo = useCallback(() => {
    setIniciada(true);
    if (!ehTeste) void postSala("evento", { w: webinar.id, tipo: "clicou_video", segundo: Math.floor(segundoRef.current) });
  }, [ehTeste, webinar.id, segundoRef]);

  function aoClicarOferta() {
    void postSala("evento", { w: webinar.id, tipo: "clicou_oferta", segundo: Math.floor(segundo) });
    // Só http(s): um link `javascript:`/`data:` configurado no admin nunca é aberto.
    const link = linkOfertaSeguro(oferta?.link ?? null, oferta?.repassarUtms ? utms : {}, {
      nome: nomeParticipante,
      email: participante.email,
      telefoneE164: participante.telefoneE164,
    });
    if (link) window.open(link, "_blank", "noopener,noreferrer");
  }

  function adicionarMensagemPrivada(m: MensagemPrivada) {
    setMensagensPrivadas((atual) => [...atual, m]);
  }

  async function enviarAoServidor(textoEnviar: string): Promise<ResultadoEnvio> {
    setEnviando(true);
    setErroEnvio(null);
    try {
      const resp = await fetch("/api/sala/mensagem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ w: webinar.id, texto: textoEnviar }),
      });
      if (resp.status === 403) {
        const corpo = (await resp.json().catch(() => null)) as { erro?: string; precisaCadastro?: boolean; codigo?: string } | null;
        if (corpo?.codigo === "link") {
          setErroEnvio(t(idioma, "semLinks"));
          return "erro";
        }
        if (corpo?.precisaCadastro) {
          pendenteRef.current = textoEnviar;
          setMostrarCadastro(true);
          return "cadastro";
        }
        setErroEnvio(corpo?.erro ?? t(idioma, "erroMensagem"));
        return "erro";
      }
      if (resp.status === 429) {
        setErroEnvio(t(idioma, "aguardeMensagem"));
        return "erro";
      }
      if (!resp.ok) {
        setErroEnvio(t(idioma, "erroMensagem"));
        return "erro";
      }
      const dados = (await resp.json()) as { id: string; texto: string; criadaEm: string };
      const segundoEnvio = Math.floor(segundoRef.current);
      adicionarMensagemPrivada({ id: dados.id, autor: "participante", texto: dados.texto, imagemUrl: null, criadaEm: dados.criadaEm, segundo: segundoEnvio });

      return "ok";
    } catch {
      setErroEnvio(t(idioma, "erroMensagem"));
      return "erro";
    } finally {
      setEnviando(false);
    }
  }

  /** Botão de clipe: sobe a imagem (`/api/sala/imagem`) e, dando certo, grava a mensagem com ela
   *  (`/api/sala/mensagem`, `imagemUrl`, texto vazio) — mesmas regras de sessão provisória/replay/teste do envio
   *  de texto. */
  async function aoEscolherImagem(arquivo: File) {
    const erroValidacao = validarImagem(arquivo.type, arquivo.size);
    if (erroValidacao) {
      setErroEnvio(erroValidacao);
      return;
    }

    setEnviandoImagem(true);
    setErroEnvio(null);
    try {
      const corpo = new FormData();
      corpo.append("w", webinar.id);
      corpo.append("arquivo", arquivo);
      const respImagem = await fetch("/api/sala/imagem", { method: "POST", body: corpo });

      if (respImagem.status === 403) {
        const corpoErro = (await respImagem.json().catch(() => null)) as { erro?: string; precisaCadastro?: boolean } | null;
        if (corpoErro?.precisaCadastro) {
          setMostrarCadastro(true);
          return;
        }
        setErroEnvio(corpoErro?.erro ?? t(idioma, "erroMensagem"));
        return;
      }
      if (respImagem.status === 429) {
        setErroEnvio(t(idioma, "aguardeMensagem"));
        return;
      }
      if (!respImagem.ok) {
        setErroEnvio(t(idioma, "erroMensagem"));
        return;
      }
      const { url } = (await respImagem.json()) as { url: string };

      const respMensagem = await fetch("/api/sala/mensagem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ w: webinar.id, texto: "", imagemUrl: url }),
      });
      if (!respMensagem.ok) {
        setErroEnvio(t(idioma, "erroMensagem"));
        return;
      }
      const dados = (await respMensagem.json()) as { id: string; texto: string | null; imagemUrl: string | null; criadaEm: string };
      adicionarMensagemPrivada({
        id: dados.id,
        autor: "participante",
        texto: dados.texto,
        imagemUrl: dados.imagemUrl,
        criadaEm: dados.criadaEm,
        segundo: Math.floor(segundoRef.current),
      });
    } catch {
      setErroEnvio(t(idioma, "erroMensagem"));
    } finally {
      setEnviandoImagem(false);
    }
  }

  // O campo funciona desde a entrada: tocar nele antes de tocar no vídeo também liga o som (`comecarSomPeloCampo`).
  const campoDesativado = fim || ehReplay;

  /** Primeiro toque no campo de mensagem, antes de a pessoa tocar no vídeo: liga o som pelo mesmo caminho do
   *  "Clique para ouvir" (ainda dentro do gesto, que é o que o navegador exige pra tocar com som). */
  function comecarSomPeloCampo() {
    if (iniciada) return;
    caixaVideoRef.current?.querySelector<HTMLButtonElement>("[data-comecar-video]")?.click();
  }

  async function aoEnviar(ev: React.FormEvent) {
    ev.preventDefault();
    const v = texto.trim();
    if (!v || campoDesativado || enviando) return;
    // O texto só sai do campo quando o envio dá certo (falha ou cadastro pendente: continua lá).
    const resultado = await enviarAoServidor(v);
    if (resultado === "ok") setTexto("");
  }

  async function aoCadastrar(nome: string) {
    setMostrarCadastro(false);
    const nomeLimpo = nome.trim();
    if (nomeLimpo) setNomeParticipante(nomeLimpo);
    // Cadastro novo feito dentro da sala: pixel de lead uma vez (o próprio Pixels guarda que já disparou).
    try {
      sessionStorage.setItem(chaveNovoCadastro, "1");
    } catch {
      /* sem sessionStorage: dispara só nesta visita. */
    }
    setCadastroNovo(true);

    const v = pendenteRef.current;
    pendenteRef.current = null;
    if (v) {
      const resultado = await enviarAoServidor(v);
      if (resultado === "ok") setTexto((atual) => (atual.trim() === v ? "" : atual));
    }
  }

  const layout = largura === null ? "horizontal" : decidirLayoutSala(video.orientacao, largura);
  const vertical = layout === "vertical";

  const abasDisponiveis: { chave: AbaChave; rotulo: string }[] = [
    { chave: "chat", rotulo: t(idioma, "chat") },
  ];
  if (momentosAtual.oferta) abasDisponiveis.push({ chave: "oferta", rotulo: t(idioma, "oferta") });
  if (momentosAtual.sorteio && oferta?.sorteioNumero) abasDisponiveis.push({ chave: "sorteio", rotulo: t(idioma, "sorteio") });

  const motivoDesativado = fim ? "chatEncerrado" : ehReplay ? "comentariosDesativados" : null;
  const ofertaAtiva = !!oferta?.ligada && momentosAtual.oferta;
  const podeEnviar = !campoDesativado && !enviando && texto.trim().length > 0;

  const painelAbas = (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`shrink-0 ${vertical ? "px-3 pt-2" : "px-3 pt-3"}`}>
        <Abas abas={abasDisponiveis} atual={aba} onEscolher={setAba} live={vertical} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {aba === "chat" && (
          <Chat
            idioma={idioma}
            participanteNome={nomeParticipante}
            mensagensSimuladas={mensagensSimuladas}
            vendasVisiveis={vendasVisiveis}
            mensagensPrivadas={mensagensPrivadas}
            live={vertical}
          />
        )}
        {aba === "oferta" && oferta?.ligada && (
          <div className={`flex-1 overflow-y-auto overscroll-contain ${vertical ? "m-3 rounded-xl bg-white" : ""}`}>
            <OfertaCard idioma={idioma} oferta={oferta} restante={restanteOferta} mobile={largura !== null && largura < LARGURA_VERTICAL} onClicar={aoClicarOferta} />
          </div>
        )}
        {aba === "sorteio" && oferta?.sorteioNumero && (
          <div className={`flex min-h-0 flex-1 flex-col ${vertical ? "m-3 rounded-xl bg-white" : ""}`}>
            <Sorteio idioma={idioma} webinarId={webinar.id} numeroFinal={oferta.sorteioNumero} />
          </div>
        )}
      </div>

      {/* Celular e Live: barra fixa da oferta acima do campo de mensagem, em todas as abas menos a própria Oferta. No
          computador ela fica sob o vídeo (faixa), então aqui some a partir de 950 px. */}
      {ofertaAtiva && oferta && aba !== "oferta" && (
        <BarraOferta
          idioma={idioma}
          oferta={oferta}
          restante={restanteOferta}
          onClicar={aoClicarOferta}
          variante={vertical ? "live" : "painel"}
          className={vertical ? "" : "min-[950px]:hidden"}
        />
      )}

      {erroEnvio && (
        <p role="alert" className={`shrink-0 px-3 pt-1.5 text-xs font-medium ${vertical ? "text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]" : "bg-white text-erro"}`}>
          {erroEnvio}
        </p>
      )}

      {/* Campo de envio: barra branca de 70 px com borda em cima (no Live, translúcida). Preso embaixo: o painel ocupa o
          resto da tela no celular. */}
      <form
        onSubmit={aoEnviar}
        className={`flex min-h-[70px] shrink-0 items-center gap-2 px-3 pb-[max(0px,env(safe-area-inset-bottom))] ${
          vertical ? "bg-transparent" : "border-t border-linha bg-white"
        }`}
      >
        <input
          ref={arquivoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(ev) => {
            const arquivo = ev.target.files?.[0];
            ev.target.value = "";
            if (arquivo) void aoEscolherImagem(arquivo);
          }}
        />
        <button
          type="button"
          onClick={() => arquivoInputRef.current?.click()}
          disabled={campoDesativado || enviandoImagem}
          aria-label={t(idioma, "anexarImagem")}
          title={t(idioma, "anexarImagem")}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            vertical ? "text-white hover:bg-white/15" : "text-texto-3 hover:bg-suave hover:text-texto"
          }`}
        >
          {enviandoImagem ? <LoaderCircle aria-hidden size={20} className="animate-spin" /> : <Paperclip aria-hidden size={20} />}
        </button>
        <input
          value={texto}
          onChange={(ev) => setTexto(ev.target.value)}
          onPointerDown={comecarSomPeloCampo}
          onFocus={comecarSomPeloCampo}
          disabled={campoDesativado}
          maxLength={400}
          enterKeyHint="send"
          aria-label={t(idioma, "mensagemPlaceholder")}
          placeholder={t(idioma, motivoDesativado ?? "mensagemPlaceholder")}
          className={`h-10 min-w-0 flex-1 px-3 text-base outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
            vertical
              ? "rounded-full border border-white/25 bg-black/35 text-white placeholder:text-white/70 backdrop-blur-sm focus:border-white/60"
              : "rounded-md border border-borda bg-white text-texto shadow-controle placeholder:text-apagado focus:border-marca focus:ring-2 focus:ring-marca/20"
          }`}
        />
        <button
          type="submit"
          // Tocar no enviar não tira o foco do campo: o teclado do celular continua aberto pra próxima mensagem.
          onMouseDown={(ev) => ev.preventDefault()}
          disabled={!podeEnviar}
          aria-label={t(idioma, "enviar")}
          title={t(idioma, "enviar")}
          className={`flex h-10 w-10 shrink-0 items-center justify-center text-white transition-[filter,opacity] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 ${
            vertical ? "rounded-full bg-marca" : "rounded-md bg-marca"
          }`}
        >
          {enviando ? <LoaderCircle aria-hidden size={18} className="animate-spin" /> : <SendHorizontal aria-hidden size={18} />}
        </button>
      </form>

      {mostrarCadastro && (
        <CadastroModal idioma={idioma} webinarId={webinar.id} cadastro={cadastro} onCadastrado={aoCadastrar} onFechar={() => setMostrarCadastro(false)} />
      )}
    </div>
  );

  const comecouVideo = segundo > 0 || ehTeste;

  // Uma árvore só pros três layouts (só as classes mudam): cruzar os 950 px ou girar o celular não desmonta o
  // <Player>.
  // - Computador (≥ 950 px): título no topo, player 16:9 com a faixa da oferta embaixo, chat de 380 px à direita
  //   (mesma altura da coluna do vídeo, mínimo 480 px) e selos no rodapé.
  // - Celular (< 950 px, vídeo horizontal): player 16:9 no topo, chat ocupando o resto e o campo de envio preso
  //   embaixo; a sala fica presa na área visível (100dvh, ou a do `visualViewport` com o teclado aberto).
  // - Live (vídeo vertical, < 950 px): vídeo cobrindo a tela e o chat por cima, na metade de baixo.
  // As classes de celular/computador são por media query (sem salto na hidratação); só o Live depende da largura
  // medida no navegador, porque depende também da orientação do vídeo.
  const estiloAltura: React.CSSProperties | undefined =
    areaVisivel !== null ? { position: "fixed", left: 0, right: 0, top: `${areaVisivel.topo}px`, height: `${areaVisivel.altura}px` } : undefined;

  return (
    <>
      {!ehTeste && (
        <Pixels
          webinarId={webinar.id}
          pixelMeta={webinar.pixelMeta}
          pixelTiktok={webinar.pixelTiktok}
          gtm={webinar.gtm}
          cadastroNovo={cadastroNovo}
          scriptPersonalizado={webinar.scriptPersonalizado}
          teste={ehTeste}
        />
      )}

      <main
        style={estiloAltura}
        className={
          vertical
            ? "fixed inset-x-0 top-0 h-dvh overflow-hidden bg-black"
            : "flex min-h-dvh flex-col bg-[#F9F9F9] max-[950px]:h-dvh max-[950px]:min-h-0 max-[950px]:overflow-hidden"
        }
      >
        <header className={vertical ? "hidden" : "mx-auto flex w-full max-w-[1440px] items-center justify-between gap-4 px-6 pt-6 pb-4 max-[950px]:hidden"}>
          <h1 className="min-w-0 truncate text-2xl leading-8 font-bold text-titulo">{webinar.titulo}</h1>
          <span className="shrink-0 text-sm text-texto-3">
            {t(idioma, "eu")}: <span className="font-medium text-texto">{nomeParticipante}</span>
          </span>
        </header>

        <div
          className={
            vertical
              ? "absolute inset-0"
              : "mx-auto flex w-full max-w-[1440px] flex-1 items-stretch gap-6 px-6 pb-6 max-[950px]:min-h-0 max-[950px]:flex-col max-[950px]:gap-0 max-[950px]:p-0"
          }
        >
          <section className={vertical ? "absolute inset-0" : "flex min-w-0 flex-1 flex-col gap-4 max-[950px]:flex-none max-[950px]:gap-0"}>
            <div
              ref={caixaVideoRef}
              className={
                vertical ? "absolute inset-0 bg-black" : "relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-black max-[950px]:rounded-none"
              }
            >
              <Player
                url={video.url}
                formato={video.formato}
                autoplay={video.autoplay}
                modo={relogio.modo}
                idioma={idioma}
                duracaoSeg={video.duracaoSeg}
                segundoEsperado={segundoEsperado}
                posicaoReplaySeg={posicaoInicial}
                encerrado={fim}
                onTimeUpdate={setSegundo}
                onClicouVideo={aoClicarVideo}
                onFim={aoTerminarVideo}
                className="h-full w-full"
                cobrir={vertical}
                capa={video.capa}
              />
              <div className={`pointer-events-none absolute left-3 z-40 ${vertical ? "top-[max(12px,env(safe-area-inset-top))]" : "top-3"}`}>
                <Publico
                  idioma={idioma}
                  audiencia={audiencia}
                  fracaoVideo={video.duracaoSeg > 0 ? Math.min(1, segundo / video.duracaoSeg) : 0}
                  comecou={comecouVideo}
                  ehReplay={ehReplay}
                />
              </div>
              {!fim && <TarjaAviso tarjas={tarjas} segundo={segundo} vertical={vertical} comControles={ehTeste} />}
              <AvisoVenda
                titulo={webinar.tituloNotificacaoCompra ?? t(idioma, "vendaConfirmada")}
                vendas={vendasNovas}
                onConsumido={consumirVendasNovas}
                vertical={vertical}
              />
              {fim && <Fim idioma={idioma} oferta={oferta} onClicarOferta={aoClicarOferta} />}
            </div>

            {ehTeste && !vertical && <AtalhosTeste momentos={momentosDoTeste(oferta)} onIrPara={irParaNoTeste} />}

            {/* Computador: faixa da oferta sob o vídeo enquanto ela estiver ativa. */}
            {ofertaAtiva && oferta && !vertical && (
              <BarraOferta idioma={idioma} oferta={oferta} restante={restanteOferta} onClicar={aoClicarOferta} variante="faixa" className="max-[950px]:hidden" />
            )}
          </section>

          <aside
            className={
              vertical
                ? "absolute inset-x-0 bottom-0 z-20 flex h-[52%] flex-col bg-linear-to-t from-black/85 via-black/55 to-transparent pt-6"
                : "relative min-h-[480px] w-[380px] shrink-0 overflow-hidden rounded-xl border border-linha bg-white min-[950px]:max-tela-slg:w-[340px] max-[950px]:min-h-0 max-[950px]:w-full max-[950px]:flex-1 max-[950px]:rounded-none max-[950px]:border-0"
            }
          >
            {/* No computador o painel acompanha a altura da coluna do vídeo: o conteúdo fica em camada absoluta pra
                não esticar a linha conforme o chat cresce. */}
            <div className={vertical ? "flex min-h-0 flex-1 flex-col" : "absolute inset-0"}>{painelAbas}</div>
          </aside>
        </div>

        <footer className={vertical ? "hidden" : "pb-8 max-[950px]:hidden"}>
          <SelosSeguranca idioma={idioma} />
        </footer>
      </main>

      {ehTeste && (
        <div className="pointer-events-none fixed top-2 right-2 z-50 rounded-md border border-[#FDE68A] bg-aviso-fundo px-2 py-1 text-[11px] font-semibold text-aviso shadow-sm">
          Modo teste
        </div>
      )}
    </>
  );
}
