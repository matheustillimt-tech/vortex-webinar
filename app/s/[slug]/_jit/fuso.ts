"use client";
import { useEffect, useState } from "react";
import { FUSO_PADRAO_JIT } from "@/src/lib/regras/jit-form";

/** Fuso do navegador (nome IANA) ou `null` se o navegador não informar. */
export function fusoDoNavegador(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Fuso em que a página mostra os horários: o da configuração, ou o do navegador quando a configuração é
 *  "participante". O primeiro render (servidor e hidratação) usa Brasília; o do navegador entra depois de montar. */
export function useFusoAplicado(fusoConfig: string): string {
  const [fuso, setFuso] = useState(fusoConfig === "participante" ? FUSO_PADRAO_JIT : fusoConfig);
  useEffect(() => {
    if (fusoConfig !== "participante") return;
    const f = fusoDoNavegador();
    if (f) setFuso(f);
  }, [fusoConfig]);
  return fuso;
}
