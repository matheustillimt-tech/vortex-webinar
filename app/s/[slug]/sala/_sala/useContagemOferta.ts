"use client";
import { useEffect, useRef, useState } from "react";
import { chaveContagemOferta, inicioContagem, restanteContagem } from "@/src/lib/regras/oferta-contagem";

/** Segundos restantes da contagem da oferta, guardada em `sessionStorage` por webinar — recarregar a página não
 *  reinicia do zero. Só conta enquanto `ativa` (a oferta já apareceu, pelos `momentos` do vídeo). */
export function useContagemOferta(webinarId: string, contagemSeg: number, ativa: boolean): number {
  const chave = chaveContagemOferta(webinarId);
  const [restante, setRestante] = useState(contagemSeg);
  const inicioRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ativa) return;
    let salvo: number | null = null;
    try {
      const v = Number(sessionStorage.getItem(chave));
      if (Number.isFinite(v) && v > 0) salvo = v;
    } catch {
      /* sessionStorage indisponível: a contagem simplesmente recomeça do início nesta visita. */
    }
    const inicio = inicioContagem(Date.now(), salvo);
    inicioRef.current = inicio;
    try {
      sessionStorage.setItem(chave, String(inicio));
    } catch {
      /* idem */
    }
    setRestante(restanteContagem(contagemSeg, inicio, Date.now()));
    const id = setInterval(() => {
      setRestante(restanteContagem(contagemSeg, inicioRef.current ?? Date.now(), Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [ativa, chave, contagemSeg]);

  return restante;
}
