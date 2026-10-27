"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Cartao, Numero } from "../../../_componentes/ui";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import type { Ponto } from "./Mapa";

const Mapa = dynamic(() => import("./Mapa"), { ssr: false });

type Bucket = { inicio: string; total: number };
type Dados = { aoVivo: number; replay: number; desktop: number; mobile: number; pontos: Ponto[]; serie: Bucket[]; fuso: string; atualizadoEm: string };

const INTERVALO_MS = 5_000;

/** Hora no fuso da agenda (o mesmo dos buckets da série); sem fuso, a do navegador. */
function horaCurta(iso: string, fuso?: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: fuso });
}

/** Gráfico de barras simples (SVG puro, sem biblioteca) com os acessos por bucket de 10 min do dia. */
function GraficoAcessos({ serie, fuso }: { serie: Bucket[]; fuso?: string }) {
  if (serie.length === 0) return <p className="text-sm text-vg-muted">Sem acessos hoje ainda.</p>;

  const largura = 760;
  const altura = 140;
  const maximo = Math.max(1, ...serie.map((b) => b.total));
  const passo = largura / serie.length;
  const margemBase = 16;

  // No máximo ~8 rótulos no eixo (um a cada N barras), senão fica ilegível com buckets de 10 min no dia inteiro.
  const cadaRotulo = Math.max(1, Math.ceil(serie.length / 8));

  return (
    <svg viewBox={`0 0 ${largura} ${altura + margemBase}`} className="w-full" role="img" aria-label="Acessos por 10 minutos, hoje">
      {serie.map((b, i) => {
        const h = (b.total / maximo) * (altura - 8);
        const x = i * passo;
        return (
          <g key={b.inicio}>
            <rect x={x + 1} y={altura - h} width={Math.max(1, passo - 2)} height={h} fill="#0a8452" opacity={0.85}>
              <title>{`${horaCurta(b.inicio, fuso)} · ${b.total}`}</title>
            </rect>
            {i % cadaRotulo === 0 && (
              <text x={x + passo / 2} y={altura + 12} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.6}>
                {horaCurta(b.inicio, fuso)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function PainelAoVivo({ webinarId }: { webinarId: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState(false);
  const [atendentesOnline, setAtendentesOnline] = useState(0);

  // Polling a cada 5 s: pula a vez se a busca anterior ainda não voltou e pausa com a aba escondida (volta a
  // buscar na hora quando a aba aparece de novo).
  useEffect(() => {
    let cancelado = false;
    let emAndamento = false;

    async function carregar() {
      if (emAndamento || document.hidden) return;
      emAndamento = true;
      try {
        const r = await fetch(`/api/painel/ao-vivo/${webinarId}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as Dados;
        if (!cancelado) {
          setDados(j);
          setErro(false);
        }
      } catch {
        if (!cancelado) setErro(true);
      } finally {
        emAndamento = false;
      }
    }

    function aoMudarVisibilidade() {
      if (!document.hidden) void carregar();
    }

    void carregar();
    const timer = setInterval(() => void carregar(), INTERVALO_MS);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      cancelado = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [webinarId]);

  // "Atendentes online": só leitura do canal de presença da sala de atendimento — nunca faz `track`, pra não
  // inflar a contagem real de quem está atendendo.
  useEffect(() => {
    const supabase = dbNavegador();
    const canal = supabase.channel(`atendimento:${webinarId}`, { config: { private: true } });
    canal.on("presence", { event: "sync" }, () => setAtendentesOnline(Object.keys(canal.presenceState()).length)).subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [webinarId]);

  return (
    <div className="space-y-4">
      {erro && (
        <div className="rounded-lg bg-vg-erro/90 px-3 py-2 text-center text-sm font-medium text-white">
          Não deu para atualizar. Tentando de novo…
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Numero rotulo="Ao vivo" valor={dados?.aoVivo ?? "–"} icone="sensors" destaque />
        <Numero rotulo="No replay" valor={dados ? `+ ${dados.replay}` : "–"} icone="movie" />
        <Numero rotulo="Desktop × Celular" valor={dados ? `${dados.desktop} × ${dados.mobile}` : "–"} icone="devices" />
        <Numero rotulo="Atendentes online" valor={atendentesOnline} icone="support_agent" />
      </div>

      <Cartao titulo="Acessos por 10 min (hoje)">
        <GraficoAcessos serie={dados?.serie ?? []} fuso={dados?.fuso} />
      </Cartao>

      <Cartao titulo="Mapa do público online">
        <Mapa pontos={dados?.pontos ?? []} />
      </Cartao>

      {dados && <p className="text-right text-xs text-vg-text-3">Atualizado às {horaCurta(dados.atualizadoEm, dados.fuso)}</p>}
    </div>
  );
}
