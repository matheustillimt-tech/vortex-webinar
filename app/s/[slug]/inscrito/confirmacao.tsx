"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarClock, CalendarPlus, CircleCheckBig } from "lucide-react";
import { gerarIcs } from "@/src/lib/regras/ics";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import HorarioPorExtenso from "../_jit/horario";
import { BOTAO_MARCA_SALA, BOTAO_SALA, BOTAO_SECUNDARIO_SALA, IconeStatus, LINK_SALA, TelaCartao } from "../_ui/sala-ui";

type Props = {
  idioma: Idioma;
  titulo: string | null;
  fuso: string;
  inicioMs: number;
  /** A partir de quando o botão libera (10 min antes do horário). */
  abreMs: number;
  fimMs: number;
  agoraServidor: number;
  caminhoEntrada: string;
  caminhoLp: string;
  linkAcesso: string | null;
};

function tempoRestante(seg: number): string {
  const d = Math.floor(seg / 86_400);
  const h = Math.floor((seg % 86_400) / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

export default function Confirmacao(p: Props) {
  const deslocamento = useRef(p.agoraServidor - Date.now());
  const [agora, setAgora] = useState(p.agoraServidor);

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now() + deslocamento.current), 1000);
    return () => clearInterval(id);
  }, []);

  const abreMs = p.abreMs;
  const podeEntrar = agora >= abreMs && agora < p.fimMs;
  const encerrada = agora >= p.fimMs;

  function adicionarAgenda() {
    const link = p.linkAcesso ?? `${window.location.origin}${p.caminhoEntrada}`;
    const ics = gerarIcs({
      titulo: p.titulo || "Webinar",
      inicio: new Date(p.inicioMs),
      fim: new Date(p.fimMs),
      link,
      uid: `vw-${p.inicioMs}-${Math.random().toString(36).slice(2)}@vortexwebinar`,
      agora: new Date(),
    });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "webinar.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <TelaCartao largura="max-w-[590px]" alinhamento="items-center">
      <IconeStatus>
        <CircleCheckBig aria-hidden size={28} />
      </IconeStatus>

      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-xs font-semibold tracking-wide text-marca uppercase">{t(p.idioma, "inscricaoConfirmada")}</p>
        {p.titulo && <h1 className="text-2xl leading-snug font-bold text-titulo">{p.titulo}</h1>}
        <p className="inline-flex items-center gap-2 text-base font-medium text-texto-2">
          <CalendarClock aria-hidden size={18} className="shrink-0 text-marca" />
          <span className="first-letter:uppercase">
            <HorarioPorExtenso iso={new Date(p.inicioMs).toISOString()} fuso={p.fuso} idioma={p.idioma} />
          </span>
        </p>
        <p className="text-sm text-texto-3">{t(p.idioma, "inscricaoTexto")}</p>
      </div>

      <div className="flex w-full flex-col items-center gap-3">
        {encerrada ? (
          <>
            <p className="text-sm text-texto-3">{t(p.idioma, "encerrada")}</p>
            <a href={p.caminhoEntrada} className={BOTAO_MARCA_SALA}>
              {t(p.idioma, "replay")}
            </a>
          </>
        ) : podeEntrar ? (
          <a href={p.caminhoEntrada} className={BOTAO_MARCA_SALA}>
            {t(p.idioma, "entrarNaSala")}
            <ArrowRight aria-hidden size={20} />
          </a>
        ) : (
          <>
            <button type="button" disabled className={`${BOTAO_SALA} bg-suave text-texto-4`}>
              {t(p.idioma, "entrarNaSala")}
            </button>
            <p className="text-sm font-medium text-texto-3 tabular-nums" aria-live="polite">
              {t(p.idioma, "salaAbreEm", { tempo: tempoRestante(Math.max(0, Math.ceil((abreMs - agora) / 1000))) })}
            </p>
          </>
        )}

        {!encerrada && (
          <button type="button" onClick={adicionarAgenda} className={BOTAO_SECUNDARIO_SALA}>
            <CalendarPlus aria-hidden size={18} />
            {t(p.idioma, "adicionarAgenda")}
          </button>
        )}

        <a href={p.caminhoLp} className={`mt-1 ${LINK_SALA}`}>
          {t(p.idioma, "outroHorario")}
        </a>
      </div>
    </TelaCartao>
  );
}
