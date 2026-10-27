"use client";
// Botão "olho" do Dashboard: esconde os valores (borra) pra mostrar a tela sem expor números.
// Marca `data-ocultar` no contêiner `alvo`; quem desenha os valores usa a variante `[[data-ocultar]_&]:blur-md`.
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { estiloBotaoIcone } from "../_componentes/ui";

const CHAVE = "vw-ocultar-valores";

export function BotaoOcultarValores({ alvo }: { alvo: string }) {
  const [oculto, setOculto] = useState(false);

  useEffect(() => {
    try {
      setOculto(window.localStorage.getItem(CHAVE) === "1");
    } catch {
      /* sem localStorage: começa mostrando */
    }
  }, []);

  useEffect(() => {
    const el = document.getElementById(alvo);
    if (!el) return;
    if (oculto) el.setAttribute("data-ocultar", "");
    else el.removeAttribute("data-ocultar");
  }, [oculto, alvo]);

  function alternar() {
    setOculto((o) => {
      try {
        window.localStorage.setItem(CHAVE, o ? "0" : "1");
      } catch {
        /* ignora */
      }
      return !o;
    });
  }

  const rotulo = oculto ? "Mostrar valores" : "Ocultar valores";
  return (
    <button type="button" onClick={alternar} aria-pressed={oculto} aria-label={rotulo} title={rotulo} className={`${estiloBotaoIcone("quadrado")} border border-borda bg-superficie shadow-controle`}>
      {oculto ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
    </button>
  );
}
