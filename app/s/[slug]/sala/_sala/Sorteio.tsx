"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Gift } from "lucide-react";
import {
  chaveSorteio,
  estadoSorteioRestaurado,
  intervaloTrocaMs,
  numeroAleatorio,
  PLACEHOLDER_SORTEIO,
  sorteioTerminou,
  type EstadoSorteio,
} from "@/src/lib/regras/sorteio";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";

type Props = {
  idioma: Idioma;
  webinarId: string;
  numeroFinal: string;
};

/** "Clique aqui e escolha seu número" → "Sortear meu número" → números embaralhando a cada 50 ms por ~3,9 s →
 *  para no número real (`numeroFinal`, decidido no admin) → "Copiar número". Antes do sorteio aparece só "?".
 *  Estado guardado em `sessionStorage` por webinar ("sorteando" assim que começa, "parado" no fim): trocar de aba
 *  ou recarregar no meio da animação vai direto pro número final; uma vez parado, não sorteia de novo. */
export default function Sorteio({ idioma, webinarId, numeroFinal }: Props) {
  const chave = chaveSorteio(webinarId);
  const [estado, setEstado] = useState<EstadoSorteio>("inicial");
  const [numeroExibido, setNumeroExibido] = useState(PLACEHOLDER_SORTEIO);
  const [copiado, setCopiado] = useState(false);
  const inicioRef = useRef<number | null>(null);
  const copiadoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function salvar(valor: "sorteando" | "parado") {
    try {
      sessionStorage.setItem(chave, valor);
    } catch {
      /* sessionStorage indisponível: pior caso é poder sortear de novo num recarregamento. */
    }
  }

  useEffect(() => {
    let salvo: string | null = null;
    try {
      salvo = sessionStorage.getItem(chave);
    } catch {
      /* idem */
    }
    if (estadoSorteioRestaurado(salvo) === "parado") {
      setEstado("parado");
      setNumeroExibido(numeroFinal);
      if (salvo !== "parado") salvar("parado");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, numeroFinal]);

  useEffect(
    () => () => {
      if (copiadoTimerRef.current) clearTimeout(copiadoTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (estado !== "sorteando") return;
    inicioRef.current = Date.now();
    const id = setInterval(() => {
      const decorrido = Date.now() - (inicioRef.current ?? Date.now());
      if (sorteioTerminou(decorrido)) {
        clearInterval(id);
        setNumeroExibido(numeroFinal);
        setEstado("parado");
        salvar("parado");
        return;
      }
      setNumeroExibido(numeroAleatorio(numeroFinal, Math.random));
    }, intervaloTrocaMs());
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, chave, numeroFinal]);

  function comecarSorteio() {
    salvar("sorteando");
    setEstado("sorteando");
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(numeroFinal);
      setCopiado(true);
      if (copiadoTimerRef.current) clearTimeout(copiadoTimerRef.current);
      copiadoTimerRef.current = setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard indisponível (http sem permissão, navegador antigo etc.): sem feedback, sem quebrar a tela. */
    }
  }

  const botao = "inline-flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-md bg-marca px-5 text-base font-semibold text-white shadow-sm transition-[filter] hover:brightness-95";

  // Fluxo: presente, "Clique aqui e escolha seu número" → "Sortear meu número" → número → "Copiar".
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto p-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-marca-clara text-marca">
        <Gift aria-hidden size={30} />
      </span>

      <p className="text-5xl font-extrabold tracking-widest text-titulo tabular-nums" aria-live="polite">
        {numeroExibido}
      </p>

      {estado === "inicial" && (
        <button type="button" onClick={() => setEstado("pronto")} className={botao}>
          {t(idioma, "cliqueEscolha")}
        </button>
      )}

      {estado === "pronto" && (
        <button type="button" onClick={comecarSorteio} className={botao}>
          {t(idioma, "sortearMeuNumero")}
        </button>
      )}

      {estado === "sorteando" && <p className="text-sm font-medium text-texto-3">{t(idioma, "sortearNumero")}…</p>}

      {estado === "parado" && (
        <button type="button" onClick={copiar} className={botao}>
          {copiado ? <Check aria-hidden size={18} /> : <Copy aria-hidden size={18} />}
          {t(idioma, copiado ? "copiado" : "copiarNumero")}
        </button>
      )}
    </div>
  );
}
