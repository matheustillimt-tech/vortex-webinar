"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { Play, Volume2 } from "lucide-react";
import { posicaoInicialPlayer } from "@/src/lib/regras/relogio";
import {
  backoffMs,
  correcaoDeDeriva,
  ehSafariOuIOS,
  escolherMotorHls,
  conferirPosicaoInicial,
  estadoConexao,
  seekForaDoLimite,
  tocandoComDados,
} from "@/src/lib/regras/player";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import type { ModoRelogio } from "./useRelogio";

type HlsClasse = typeof Hls;

export type Props = {
  url: string;
  formato: "hls" | "mp4";
  autoplay: boolean;
  modo: ModoRelogio;
  idioma: Idioma;
  /** Duração confiável do vídeo (s); <= 20 é tratada como desconhecida. */
  duracaoSeg: number;
  /** Posição esperada agora (ao vivo: o relógio da sala). Identidade estável — lida em intervalos, nunca guardada
   *  em estado pra não re-renderizar o player o tempo todo. */
  segundoEsperado: () => number;
  /** Posição salva do replay (s). */
  posicaoReplaySeg: number;
  /** A sala decidiu que acabou (relógio ao vivo ou `ended`): pausa e desliga travas e correção. */
  encerrado: boolean;
  onTimeUpdate: (segundo: number) => void;
  onClicouVideo: () => void;
  onFim: () => void;
  className?: string;
  /** Sala vertical (Live): o vídeo cobre a tela toda (`object-cover`) em vez de caber nela. */
  cobrir?: boolean;
  /** Imagem de fundo enquanto o vídeo não toca (autoplay bloqueado, carregando). */
  capa?: string | null;
};

function tocaHlsNativo(video: HTMLVideoElement): boolean {
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}

/**
 * Player travado da sala: sem controles (fora do modo teste), hls.js quando preciso (com recuperação de erro),
 * travas de pausa/avanço/velocidade, Media Session neutralizada, começo e correção de deriva pelo relógio ao vivo
 * (inclusive no autoplay mudo, antes do clique), e recuperação de travamento com espera crescente. O modo teste
 * desliga só as travas e mostra os controles nativos — `timeupdate`/`ended` continuam valendo (linha do tempo e
 * fim funcionam no teste).
 *
 * Callbacks chegam por refs: os listeners são registrados uma vez por montagem, não a cada render.
 */
export default function Player({
  url,
  formato,
  autoplay,
  modo,
  idioma,
  duracaoSeg,
  segundoEsperado,
  posicaoReplaySeg,
  encerrado,
  onTimeUpdate,
  onClicouVideo,
  onFim,
  className,
  cobrir = false,
  capa,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const ultimaPosicaoValidaRef = useRef(0);
  const ultimaCorrecaoRef = useRef(0);
  const paradoDesdeRef = useRef<number | null>(null);
  const recarregandoRef = useRef(false);
  const tentativaRef = useRef(0);
  const jaTocouRef = useRef(false);
  /** `waiting` pendente: o vídeo parou por falta de dados e ainda não voltou a andar. */
  const esperandoDadosRef = useRef(false);
  const encerradoRef = useRef(encerrado);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onFimRef = useRef(onFim);
  const segundoEsperadoRef = useRef(segundoEsperado);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
    onFimRef.current = onFim;
    segundoEsperadoRef.current = segundoEsperado;
  });

  const [precisaClique, setPrecisaClique] = useState<"ouvir" | "assistir" | null>(null);
  /** O vídeo já está andando de verdade (autoplay mudo deu certo): aí o fundo do aviso é o próprio vídeo. */
  const [videoAndando, setVideoAndando] = useState(false);

  const travado = modo !== "teste";

  /** setTimeout que é cancelado sozinho quando o player desmonta. */
  const agendar = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timeoutsRef.current.delete(id);
      fn();
    }, ms);
    timeoutsRef.current.add(id);
  }, []);

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const id of timeouts) clearTimeout(id);
      timeouts.clear();
    };
  }, []);

  /** Onde o vídeo deve estar agora: ao vivo, o relógio (limitado a duração − 1); replay, a posição salva. */
  const posicaoDeInicio = useCallback(
    () => posicaoInicialPlayer({ modo, esperadoSeg: segundoEsperadoRef.current(), posicaoReplaySeg, duracaoSeg }),
    [modo, posicaoReplaySeg, duracaoSeg],
  );

  /** Reposiciona marcando a posição como válida antes (o `seeking` da própria correção não é barrado) e abrindo
   *  a carência de 3 s da correção de deriva. */
  const irPara = useCallback((video: HTMLVideoElement, segundo: number) => {
    ultimaPosicaoValidaRef.current = segundo;
    ultimaCorrecaoRef.current = Date.now();
    video.currentTime = segundo;
  }, []);

  // Confere a posição quando o vídeo começa a tocar de fato: no iPhone o pulo inicial (no `loadedmetadata`) às vezes
  // é ignorado e a aula recomeçava do zero ao atualizar a página. Fora do teste; no máximo 3 tentativas.
  const posicaoConfirmadaRef = useRef(false);
  const tentativasPosicaoRef = useRef(0);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || modo === "teste") return;
    function conferir() {
      const v = video!;
      if (posicaoConfirmadaRef.current || v.paused || v.seeking || v.readyState < 3) return;
      const r = conferirPosicaoInicial({ atualSeg: v.currentTime, alvoSeg: posicaoDeInicio(), tentativas: tentativasPosicaoRef.current });
      if (r === "ok") {
        posicaoConfirmadaRef.current = true;
        return;
      }
      tentativasPosicaoRef.current += 1;
      irPara(v, r);
    }
    video.addEventListener("playing", conferir);
    video.addEventListener("timeupdate", conferir);
    return () => {
      video.removeEventListener("playing", conferir);
      video.removeEventListener("timeupdate", conferir);
    };
  }, [modo, posicaoDeInicio, irPara]);

  // Monta a fonte (hls.js, HLS nativo ou MP4 direto) e começa na posição certa -----------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelado = false;

    function criarHls(HlsLib: HlsClasse, posicao: number) {
      const v = videoRef.current;
      if (!v || cancelado) return;
      // Qualidade limitada ao tamanho do player: no celular não puxa 1080p (economiza tráfego do Bunny sem perda visível).
      const hls = new HlsLib({ startPosition: posicao, capLevelToPlayerSize: true });
      hlsRef.current = hls;
      hls.on(HlsLib.Events.ERROR, (_evento, dados) => {
        if (!dados.fatal || cancelado || hlsRef.current !== hls) return;
        tentativaRef.current += 1;
        const espera = backoffMs(tentativaRef.current);
        if (dados.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
          agendar(() => {
            if (!cancelado && hlsRef.current === hls) hls.startLoad();
          }, espera);
        } else if (dados.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          // Erro sem recuperação no próprio hls.js: destrói e recria, retomando de onde estava.
          const retomar = modo === "ao_vivo" ? posicaoDeInicio() : v.currentTime;
          hls.destroy();
          hlsRef.current = null;
          agendar(() => criarHls(HlsLib, retomar), espera);
        }
      });
      hls.loadSource(url);
      hls.attachMedia(v);
    }

    // Posição definitiva quando os metadados chegam (o relógio andou desde a montagem; e no HLS nativo/MP4 o
    // `currentTime` só vale depois disso).
    function aoCarregarMetadados() {
      const v = videoRef.current;
      if (!v || cancelado) return;
      const inicio = posicaoDeInicio();
      if (Math.abs(v.currentTime - inicio) > 0.5) irPara(v, inicio);
      else ultimaPosicaoValidaRef.current = v.currentTime;
    }
    video.addEventListener("loadedmetadata", aoCarregarMetadados, { once: true });

    async function montar() {
      const v = videoRef.current;
      if (!v) return;
      const inicio = posicaoDeInicio();
      ultimaPosicaoValidaRef.current = inicio;

      if (formato === "hls") {
        const { default: HlsLib } = await import("hls.js");
        if (cancelado) return;
        const motor = escolherMotorHls({
          hlsSuportado: HlsLib.isSupported(),
          tocaNativo: tocaHlsNativo(v),
          safariOuIOS: ehSafariOuIOS(navigator.userAgent),
        });
        if (motor === "hlsjs") criarHls(HlsLib, inicio);
        else v.src = url;
      } else {
        v.src = url;
      }

      if (autoplay) {
        v.muted = true;
        try {
          await v.play();
        } catch {
          /* autoplay bloqueado: o clique resolve. */
        }
        if (!cancelado) setPrecisaClique("ouvir");
      } else {
        setPrecisaClique("assistir");
      }
    }
    void montar();

    return () => {
      cancelado = true;
      video.removeEventListener("loadedmetadata", aoCarregarMetadados);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // Só quando a fonte muda — posição inicial/autoplay valem na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, formato]);

  // Eventos que valem em qualquer modo (inclusive teste): posição, fim, travamento ---------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function aoAtualizarTempo() {
      const atual = video!.currentTime;
      if (atual > ultimaPosicaoValidaRef.current) esperandoDadosRef.current = false;
      ultimaPosicaoValidaRef.current = atual;
      onTimeUpdateRef.current(atual);
      paradoDesdeRef.current = null;
      recarregandoRef.current = false;
      tentativaRef.current = 0;
    }
    function aoEsperar() {
      if (paradoDesdeRef.current === null) paradoDesdeRef.current = Date.now();
    }
    function aoEsperarDados() {
      esperandoDadosRef.current = true;
      aoEsperar();
    }
    function aoTocar() {
      jaTocouRef.current = true;
      setVideoAndando(true);
      esperandoDadosRef.current = false;
    }
    function aoTerminar() {
      onFimRef.current();
    }

    video.addEventListener("timeupdate", aoAtualizarTempo);
    video.addEventListener("waiting", aoEsperarDados);
    video.addEventListener("stalled", aoEsperar);
    video.addEventListener("playing", aoTocar);
    video.addEventListener("ended", aoTerminar);
    return () => {
      video.removeEventListener("timeupdate", aoAtualizarTempo);
      video.removeEventListener("waiting", aoEsperarDados);
      video.removeEventListener("stalled", aoEsperar);
      video.removeEventListener("playing", aoTocar);
      video.removeEventListener("ended", aoTerminar);
    };
  }, []);

  // Travas (só fora do teste): pausa, velocidade, avanço manual, Media Session --------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !travado) return;

    function aoPausar() {
      if (video!.ended || encerradoRef.current) return;
      agendar(() => {
        if (!video!.ended && !encerradoRef.current) void video!.play().catch(() => {});
      }, 100);
    }
    function aoMudarVelocidade() {
      if (video!.playbackRate !== 1) video!.playbackRate = 1;
    }
    function aoBuscar() {
      if (seekForaDoLimite(video!.currentTime, ultimaPosicaoValidaRef.current)) video!.currentTime = ultimaPosicaoValidaRef.current;
    }

    video.addEventListener("pause", aoPausar);
    video.addEventListener("ratechange", aoMudarVelocidade);
    video.addEventListener("seeking", aoBuscar);

    const temMediaSession = typeof navigator !== "undefined" && "mediaSession" in navigator;
    const acoes: MediaSessionAction[] = ["pause", "seekto", "seekforward", "seekbackward"];
    if (temMediaSession) {
      for (const acao of acoes) {
        try {
          navigator.mediaSession.setActionHandler(acao, acao === "pause" ? () => void video.play().catch(() => {}) : () => {});
        } catch {
          /* nem todo navegador aceita todas as ações — segue sem ela. */
        }
      }
    }

    return () => {
      video.removeEventListener("pause", aoPausar);
      video.removeEventListener("ratechange", aoMudarVelocidade);
      video.removeEventListener("seeking", aoBuscar);
      if (temMediaSession) {
        for (const acao of acoes) {
          try {
            navigator.mediaSession.setActionHandler(acao, null);
          } catch {
            /* idem */
          }
        }
      }
    };
  }, [travado, agendar]);

  // Fim decidido pela sala: pausa e congela travas/correção --------------------------------------------------------
  useEffect(() => {
    encerradoRef.current = encerrado;
    if (encerrado) videoRef.current?.pause();
  }, [encerrado]);

  // Ao vivo: correção de deriva a cada 2 s enquanto toca com dados (inclusive mudo, antes do clique) ----------------
  useEffect(() => {
    if (modo !== "ao_vivo") return;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const alvo = correcaoDeDeriva({
        tocando: tocandoComDados({
          pausado: video.paused,
          terminou: video.ended,
          readyState: video.readyState,
          esperandoDados: esperandoDadosRef.current,
        }),
        encerrado: encerradoRef.current,
        agoraMs: Date.now(),
        ultimaCorrecaoMs: ultimaCorrecaoRef.current,
        atualSeg: video.currentTime,
        esperadoSeg: segundoEsperadoRef.current(),
        duracaoSeg,
      });
      if (alvo !== null) irPara(video, alvo);
    }, 2000);
    return () => clearInterval(id);
  }, [modo, duracaoSeg, irPara]);

  // Voltou pra aba: retoma (o navegador pode ter pausado o vídeo em segundo plano) ----------------------------------
  useEffect(() => {
    if (!travado) return;
    function aoMudarVisibilidade() {
      if (document.visibilityState !== "visible") return;
      const video = videoRef.current;
      if (!video || !jaTocouRef.current || video.ended || encerradoRef.current) return;
      if (video.paused) void video.play().catch(() => {});
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  }, [travado]);

  // Vídeo parado: recarrega a fonte com espera crescente (sem aviso na tela) --------------------------------------------------
  useEffect(() => {
    const id = setInterval(() => {
      const desde = paradoDesdeRef.current;
      if (desde === null || encerradoRef.current) return;
      const estado = estadoConexao(Date.now() - desde);

      if (estado === "recarregar" && !recarregandoRef.current) {
        recarregandoRef.current = true;
        tentativaRef.current += 1;
        agendar(() => {
          const video = videoRef.current;
          if (!video) return;
          if (hlsRef.current) {
            hlsRef.current.startLoad();
          } else {
            const posicao = video.currentTime;
            // `currentTime` só vale depois dos metadados da fonte nova; ao vivo, volta pro relógio da sala.
            video.addEventListener("loadedmetadata", () => irPara(video, modo === "ao_vivo" ? posicaoDeInicio() : posicao), { once: true });
            video.src = url;
            void video.play().catch(() => {});
          }
          // Recomeça a contar: se continuar parado mais 12 s, tenta de novo com uma espera maior (o `timeupdate`
          // zera as tentativas quando o vídeo volta a andar).
          paradoDesdeRef.current = Date.now();
          recarregandoRef.current = false;
        }, backoffMs(tentativaRef.current));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [url, modo, agendar, posicaoDeInicio, irPara]);

  function aoClicarParaComecar() {
    const video = videoRef.current;
    if (!video) return;
    if (modo === "ao_vivo") {
      const inicio = posicaoDeInicio();
      if (Math.abs(video.currentTime - inicio) > 1) irPara(video, inicio);
    }
    video.muted = false;
    void video.play().catch(() => {});
    setPrecisaClique(null);
    onClicouVideo();
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <video
        ref={videoRef}
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        controls={modo === "teste"}
        className={`h-full w-full bg-black ${cobrir ? "object-cover" : "object-contain"}`}
        style={{ pointerEvents: modo === "teste" ? "auto" : "none" }}
      />

      {precisaClique && !encerrado && (
        // A área toda é clicável. Fundo: a aula "rodando" — o próprio vídeo, se o autoplay mudo deixou tocar; senão a
        // prévia animada do começo da aula (`capa`), que toca até com o iPhone em modo de pouca energia. Na frente, o
        // play grande pulsando (com o selo de som) e o "Sua aula já começou / Clique para ouvir" bem visível.
        <button
          type="button"
          data-comecar-video
          onClick={aoClicarParaComecar}
          className="group absolute inset-0 z-30 isolate flex flex-col items-center justify-center gap-3 overflow-hidden p-3 text-white max-[400px]:gap-2"
        >
          {capa && !videoAndando && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={capa} alt="" aria-hidden className="absolute inset-0 -z-10 h-full w-full scale-105 object-cover blur-[1.5px]" />
          )}
          <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/25 via-black/45 to-black/70" />
          <span className="relative flex size-20 items-center justify-center max-[400px]:size-16">
            <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-white/40" />
            <span className="relative flex size-full items-center justify-center rounded-full bg-white text-black shadow-xl transition-transform group-hover:scale-105 group-active:scale-95">
              <Play aria-hidden className="ml-1 size-9 max-[400px]:size-7" fill="currentColor" />
            </span>
            {precisaClique === "ouvir" && (
              <span className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full border-2 border-white bg-marca text-white shadow-md max-[400px]:size-7">
                <Volume2 aria-hidden size={16} />
              </span>
            )}
          </span>
          <span className="relative flex flex-col items-center text-center">
            <span className="text-2xl leading-tight font-extrabold [text-shadow:0_2px_8px_rgb(0_0_0/0.6)] max-[400px]:text-xl">{t(idioma, "aulaComecou")}</span>
            <span className="mt-1.5 rounded-full bg-marca px-4 py-1.5 text-base leading-tight font-bold shadow-lg max-[400px]:text-sm">
              {precisaClique === "ouvir" ? t(idioma, "cliqueOuvir") : t(idioma, "cliqueAssistir")}
            </span>
          </span>
        </button>
      )}

    </div>
  );
}
