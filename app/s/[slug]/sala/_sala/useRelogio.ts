"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { deslocamentoRelogio, segundoEsperadoAoVivo } from "@/src/lib/regras/relogio";

export type ModoRelogio = "ao_vivo" | "replay" | "teste";

export type RelogioProps = {
  /** Início da sessão (ms, vindo do servidor). */
  inicioSessao: number;
  /** Relógio do servidor no momento em que a página carregou (ms). */
  agoraServidor: number;
  modo: ModoRelogio;
  /** Posição salva do replay (s), usada como ponto de partida quando `modo === "replay"`. */
  posicaoReplaySeg: number;
};

/**
 * Relógio da sala: corrige o relógio local pelo deslocamento medido na carga (`agoraServidor − Date.now()`) e
 * expõe `segundo` — a posição real do vídeo, atualizada pelo `timeupdate` do player (é o vídeo que manda a posição
 * que o resto da sala usa pra decidir mensagens, oferta, sorteio etc.).
 *
 * Tudo que o player e os intervalos leem fica em refs, e as funções devolvidas têm identidade estável (as props
 * vêm do servidor e não mudam): assim o player não refaz efeitos nem intervalos a cada `timeupdate`.
 * - `segundoEsperado()`: ao vivo, onde o vídeo deveria estar agora; no replay/teste, a posição atual (não há
 *   "esperado" — cada um assiste no próprio ritmo).
 * - `agoraServidorMs()`: relógio local corrigido pelo deslocamento (decide o fim pelo relógio no ao vivo).
 * - `segundoRef`: posição atual sem depender de render (sinal de 30 s, eventos).
 */
export function useRelogio(p: RelogioProps) {
  const { modo, inicioSessao, agoraServidor } = p;
  const deslocamentoRef = useRef<number | null>(null);
  const posicaoInicial = modo === "replay" ? p.posicaoReplaySeg : 0;
  const [segundo, setSegundoEstado] = useState(posicaoInicial);
  const segundoRef = useRef(posicaoInicial);

  // Medido na primeira leitura (o efeito do player roda antes do efeito deste hook, então não dá pra depender de um
  // useEffect aqui pra ter o deslocamento pronto quando o player monta).
  const agoraServidorMs = useCallback((): number => {
    if (deslocamentoRef.current === null) deslocamentoRef.current = deslocamentoRelogio(agoraServidor, Date.now());
    return Date.now() + deslocamentoRef.current;
  }, [agoraServidor]);

  useEffect(() => {
    agoraServidorMs();
  }, [agoraServidorMs]);

  const segundoEsperado = useCallback((): number => {
    if (modo !== "ao_vivo") return segundoRef.current;
    return segundoEsperadoAoVivo(inicioSessao, agoraServidorMs());
  }, [modo, inicioSessao, agoraServidorMs]);

  const setSegundo = useCallback((s: number) => {
    segundoRef.current = s;
    setSegundoEstado(s);
  }, []);

  return { segundo, segundoRef, setSegundo, segundoEsperado, agoraServidorMs, posicaoInicial };
}
