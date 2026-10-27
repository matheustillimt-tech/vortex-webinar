"use client";
// "Assistir prévia" da biblioteca de vídeos: modal com o vídeo (HLS pelo hls.js quando o navegador não toca .m3u8
// sozinho; MP4 direto).
import { useEffect, useRef } from "react";
import type Hls from "hls.js";
import { Modal } from "../_componentes/modal";

export function PreviaVideo({ aberto, aoFechar, nome, url }: { aberto: boolean; aoFechar: () => void; nome: string; url: string }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!aberto) return;
    let hls: Hls | null = null;
    let cancelado = false;
    const el = video.current;
    if (!el) return;
    const ehHls = /\.m3u8(\?|$)/i.test(url);
    if (!ehHls || el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = url;
    } else {
      void import("hls.js").then(({ default: HlsJs }) => {
        if (cancelado || !HlsJs.isSupported()) {
          if (!cancelado) el.src = url;
          return;
        }
        hls = new HlsJs();
        hls.loadSource(url);
        hls.attachMedia(el);
      });
    }
    return () => {
      cancelado = true;
      hls?.destroy();
      el.removeAttribute("src");
      el.load();
    };
  }, [aberto, url]);

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Prévia do vídeo" descricao={nome} largura="xl">
      <video ref={video} controls playsInline className="aspect-video w-full rounded-md bg-black" />
    </Modal>
  );
}
