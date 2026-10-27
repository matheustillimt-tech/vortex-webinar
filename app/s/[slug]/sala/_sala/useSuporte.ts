"use client";
import { useEffect, useRef, useState } from "react";
import { acumularRecebidas, maisRecente } from "@/src/lib/regras/suporte";
import type { MensagemPrivada } from "./tipos";

export type MensagemSuporteApi = {
  id: string;
  autor: MensagemPrivada["autor"];
  texto: string | null;
  imagemUrl: string | null;
  nomeAutor: string | null;
  editada: boolean;
  apagada: boolean;
  criadaEm: string;
  atualizadaEm: string;
};

const INTERVALO_ABA_ABERTA_MS = 3000;
const INTERVALO_ABA_FECHADA_MS = 10_000;
/** Teto da lista acumulada (dedupe por id): a sala mescla tudo por id de qualquer forma. */
const LIMITE_RECEBIDAS = 200;

/** Busca `GET /api/sala/suporte` por polling (3 s com a aba Chat aberta, 10 s fora dela) — o participante
 *  nunca usa Supabase Realtime (não tem usuário no Auth). Só começa depois
 *  que a pessoa mandou a primeira mensagem (`ativo`); para de buscar no fim da transmissão (`parar`) e em 401
 *  (sessão expirada). `desde` acumula o maior `atualizadaEm` já visto (a string do servidor, com microssegundos),
 *  pra cada busca trazer só o que mudou; a lista devolvida é sem repetição por id e limitada.
 *  Trocar de aba (`abaAberta`) só reagenda o timer pendente pro novo intervalo — nunca dispara uma busca extra
 *  na hora da troca. */
export function useSuporte(webinarId: string, ativo: boolean, abaAberta: boolean, parar: boolean): MensagemSuporteApi[] {
  const [recebidas, setRecebidas] = useState<MensagemSuporteApi[]>([]);
  const desdeRef = useRef<string | null>(null);
  const paradoRef = useRef(false);
  const abaAbertaRef = useRef(abaAberta);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buscarRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!ativo || parar || paradoRef.current) return;
    let cancelado = false;

    async function buscar() {
      try {
        const q = desdeRef.current ? `&desde=${encodeURIComponent(desdeRef.current)}` : "";
        const resp = await fetch(`/api/sala/suporte?w=${webinarId}${q}`);
        if (resp.status === 401) {
          paradoRef.current = true;
          return;
        }
        if (resp.ok) {
          const dados = (await resp.json()) as { mensagens: MensagemSuporteApi[] };
          if (dados.mensagens.length > 0) {
            if (!cancelado) setRecebidas((atual) => acumularRecebidas(atual, dados.mensagens, LIMITE_RECEBIDAS));
            for (const m of dados.mensagens) desdeRef.current = maisRecente(desdeRef.current, m.atualizadaEm);
          }
        }
      } catch {
        /* tenta de novo no próximo intervalo — sem acumular falhas, o intervalo já é folgado. */
      }
      if (!cancelado && !paradoRef.current) {
        timerRef.current = setTimeout(buscar, abaAbertaRef.current ? INTERVALO_ABA_ABERTA_MS : INTERVALO_ABA_FECHADA_MS);
      }
    }

    buscarRef.current = () => void buscar();
    void buscar();
    return () => {
      cancelado = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webinarId, ativo, parar]);

  // Troca de aba: não busca na hora — só reagenda o timer já pendente (se houver um; entre buscas, `buscar`
  // sempre relê `abaAbertaRef.current` pra agendar a próxima com o intervalo certo).
  useEffect(() => {
    abaAbertaRef.current = abaAberta;
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => buscarRef.current(), abaAberta ? INTERVALO_ABA_ABERTA_MS : INTERVALO_ABA_FECHADA_MS);
  }, [abaAberta]);

  return recebidas;
}
