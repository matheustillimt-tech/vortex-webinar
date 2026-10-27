"use client";
import { useEffect, useRef, useState } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { idiomaDoLang, t, type Idioma } from "@/src/lib/regras/textos-sala";
import { BOTAO_MARCA_SALA, TelaAviso } from "./_ui/sala-ui";

/** Erro inesperado na sala: texto curto no idioma do webinar (lido do `lang` do wrapper do layout da sala), sem
 *  detalhe técnico, e um botão para tentar de novo. */
export default function ErroSala({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [idioma, setIdioma] = useState<Idioma>("pt-BR");

  useEffect(() => {
    console.error(error);
  }, [error]);

  useEffect(() => {
    setIdioma(idiomaDoLang(ref.current?.closest("[lang]")?.getAttribute("lang")));
  }, []);

  return (
    <>
      {/* Âncora invisível para achar o `lang` do wrapper do layout da sala. */}
      <span ref={ref} hidden />
      <TelaAviso icone={<TriangleAlert aria-hidden size={28} />} tom="neutro" titulo={t(idioma, "erroInesperado")}>
        <button type="button" onClick={reset} className={`${BOTAO_MARCA_SALA} max-w-[280px]`}>
          <RotateCcw aria-hidden size={18} />
          {t(idioma, "tentarDeNovo")}
        </button>
      </TelaAviso>
    </>
  );
}
