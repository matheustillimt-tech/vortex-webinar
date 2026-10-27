"use client";
import { useEffect, useRef, useState } from "react";
import { mensagensVisiveis } from "@/src/lib/regras/momentos";
import {
  esperaAposFalhaMs,
  janelaInicial,
  precisaBuscarProxima,
  precisaRecarregarJanela,
  proximaJanela,
  vendasParaAvisar,
  type Janela,
} from "@/src/lib/regras/linha-do-tempo";

export type LinhaMensagem = { segundo: number; nome: string; texto: string; suporte: boolean };
export type LinhaVenda = { segundo: number; texto: string };

type RespostaJanela = { mensagens: LinhaMensagem[]; vendas: LinhaVenda[] };

/** Busca a linha do tempo (mensagens e vendas simuladas) em janelas de 300 s, emendando a próxima um pouco antes
 *  de chegar no fim da carregada, e recarregando quando a pessoa pula pra fora da janela (reposicionou o vídeo).
 *  A primeira busca (e a de cada reposicionamento) inclui a janela anterior, pra quem chega atrasado ver o chat
 *  recente. Falha de rede: espera crescente (2 s, 4 s... até 30 s) antes de tentar de novo; 401 (sessão expirada)
 *  para de buscar. Devolve só o que já devia ter aparecido até `segundo` e as vendas novas desde a última leitura
 *  (`consumirVendasNovas`), pra tocar o toast uma vez cada — nunca em rajada ao entrar ou ao reposicionar. */
export function useLinhaDoTempo(webinarId: string, segundo: number, ativo: boolean) {
  const [mensagens, setMensagens] = useState<LinhaMensagem[]>([]);
  const [vendas, setVendas] = useState<LinhaVenda[]>([]);
  const janelaRef = useRef<Janela | null>(null);
  const buscandoRef = useRef(false);
  const falhasRef = useRef(0);
  const proximaTentativaEmRef = useRef(0);
  const paradoRef = useRef(false);
  const ultimoSegundoVendaRef = useRef<number | null>(null);
  const [vendasNovas, setVendasNovas] = useState<LinhaVenda[]>([]);

  useEffect(() => {
    if (!ativo || paradoRef.current || buscandoRef.current) return;
    if (Date.now() < proximaTentativaEmRef.current) return;
    const segundoInt = Math.floor(segundo);

    async function buscar(janela: Janela, substituir: boolean) {
      buscandoRef.current = true;
      try {
        const resp = await fetch(`/api/sala/linha-do-tempo?w=${webinarId}&de=${janela.de}&ate=${janela.ate}`);
        if (resp.status === 401) {
          // Sessão expirou: não adianta insistir (a sala segue com o que já tem).
          paradoRef.current = true;
          return;
        }
        if (!resp.ok) throw new Error(`linha do tempo: HTTP ${resp.status}`);
        const dados = (await resp.json()) as RespostaJanela;
        janelaRef.current = substituir || !janelaRef.current ? janela : { de: janelaRef.current.de, ate: janela.ate };
        falhasRef.current = 0;
        proximaTentativaEmRef.current = 0;
        setMensagens((atual) => (substituir ? dados.mensagens : [...atual, ...dados.mensagens]));
        setVendas((atual) => (substituir ? dados.vendas : [...atual, ...dados.vendas]));
      } catch {
        falhasRef.current += 1;
        proximaTentativaEmRef.current = Date.now() + esperaAposFalhaMs(falhasRef.current);
      } finally {
        buscandoRef.current = false;
      }
    }

    if (janelaRef.current === null || precisaRecarregarJanela(janelaRef.current, segundoInt)) {
      void buscar(janelaInicial(segundoInt), true);
      return;
    }
    if (precisaBuscarProxima(janelaRef.current.ate, segundoInt)) {
      void buscar(proximaJanela(janelaRef.current.ate), false);
    }
  }, [webinarId, segundo, ativo]);

  useEffect(() => {
    const segundoInt = Math.floor(segundo);
    const novas = vendasParaAvisar(vendas, ultimoSegundoVendaRef.current, segundoInt);
    ultimoSegundoVendaRef.current = segundoInt;
    if (novas.length > 0) setVendasNovas((atual) => [...atual, ...novas]);
  }, [segundo, vendas]);

  function consumirVendasNovas() {
    setVendasNovas([]);
  }

  return {
    mensagens: mensagensVisiveis(mensagens, Math.floor(segundo)),
    vendasVisiveis: mensagensVisiveis(vendas, Math.floor(segundo)),
    vendasNovas,
    consumirVendasNovas,
  };
}
