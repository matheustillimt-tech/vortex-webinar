"use client";
import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { alvoPublico, intervaloPublicoMs, passoPublico, type Audiencia } from "@/src/lib/regras/publico";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";

type Props = {
  idioma: Idioma;
  audiencia: { modo: "oculto" | "fixo" | "dinamico"; minimo: number | null; maximo: number | null; seloAoVivo: boolean };
  /** Fração do vídeo já percorrida (0–1), usada só no modo dinâmico para mover o alvo pela curva. */
  fracaoVideo: number;
  /** Selo "Ao Vivo"/"Replay" — escondido até a sala começar a tocar de fato. */
  comecou: boolean;
  ehReplay: boolean;
};

/** Olho + número de espectadores simulados (modo fixo ou dinâmico), ou só o selo "Ao Vivo" no modo oculto quando
 *  `seloAoVivo` está ligado. O contador anda em passos irregulares (não é um relógio): `Math.random` mora aqui,
 *  no componente — as regras (`alvoPublico`, `passoPublico`, `intervaloPublicoMs`) são puras e recebem a sorte
 *  por fora pra dar pra testar.
 *  Visual: selo na cor de marca (h 22, 10 px / 600, cantos de 2 px) + pílula branca com o olho e o
 *  número em #1F2937. */
export default function Publico({ idioma, audiencia, fracaoVideo, comecou, ehReplay }: Props) {
  const a: Audiencia = { modo: audiencia.modo, minimo: audiencia.minimo ?? 0, maximo: audiencia.maximo ?? 0 };
  const [numero, setNumero] = useState(() => alvoPublico(a, 0) ?? 0);
  const numeroRef = useRef(numero);
  const fracaoRef = useRef(fracaoVideo);
  fracaoRef.current = fracaoVideo;

  useEffect(() => {
    if (a.modo === "oculto" || !comecou) return;
    let cancelado = false;
    let id: ReturnType<typeof setTimeout>;
    function agendar() {
      id = setTimeout(() => {
        if (cancelado) return;
        const alvo = alvoPublico(a, fracaoRef.current) ?? numeroRef.current;
        const novo = passoPublico(numeroRef.current, alvo, Math.random);
        numeroRef.current = novo;
        setNumero(novo);
        agendar();
      }, intervaloPublicoMs(Math.random));
    }
    agendar();
    return () => {
      cancelado = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.modo, a.minimo, a.maximo, comecou]);

  if (!comecou) return null;

  const selo = (
    <span
      className={`inline-flex h-[22px] items-center gap-1.5 rounded-[2px] px-2 text-[10px] font-semibold tracking-wide text-white uppercase shadow-sm ${ehReplay ? "bg-[#4B5563]" : "bg-[#DC2626]"}`}
    >
      {!ehReplay && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />}
      {t(idioma, ehReplay ? "replay" : "aoVivo")}
    </span>
  );

  if (a.modo === "oculto") return audiencia.seloAoVivo ? <div className="flex items-center gap-1.5">{selo}</div> : null;

  return (
    <div className="flex items-center gap-1.5">
      {selo}
      <span
        className="inline-flex h-[22px] items-center gap-1 rounded-full bg-white px-2 text-[11px] font-semibold text-[#1F2937] tabular-nums shadow-sm"
        aria-label={`${numero} ${t(idioma, "publico")}`}
      >
        <Eye aria-hidden size={13} />
        {numero}
      </span>
    </div>
  );
}
