"use client";
import { TriangleAlert } from "lucide-react";
import { ESTILO_COR_TARJA, tarjaAtiva } from "@/src/lib/regras/tarjas";
import type { SalaTarja } from "@/src/lib/sala/dados";

type Props = {
  tarjas: SalaTarja[];
  /** Segundo atual do vídeo (o relógio de cada pessoa começa quando ela entra). */
  segundo: number;
  /** Sala vertical (Live): o vídeo cobre a tela e o chat ocupa a metade de baixo. */
  vertical?: boolean;
  /** Modo teste: o player mostra os controles nativos embaixo, então a tarja da base sobe um pouco mais. */
  comControles?: boolean;
};

/** Posição de cada tarja na caixa do vídeo. Topo: logo abaixo do selo AO VIVO (top 12 px + 22 px do selo + folga).
 *  Base: acima dos controles. No Live, a base fica acima do chat (que ocupa 52% da altura, de baixo pra cima). */
function classePosicao(posicao: SalaTarja["posicao"], vertical: boolean, comControles: boolean): string {
  if (posicao === "topo") return vertical ? "top-[calc(max(12px,env(safe-area-inset-top))+30px)]" : "top-[42px]";
  if (vertical) return "bottom-[calc(52%+8px)]";
  return comControles ? "bottom-16" : "bottom-3";
}

/** Faixa de largura total sobre o vídeo com o aviso de retenção ("Nós vamos fechar a sala, não saia dela!").
 *  Não bloqueia cliques no vídeo (`pointer-events-none`). Entra deslizando (ou só aparece, com movimento reduzido). */
export default function TarjaAviso({ tarjas, segundo, vertical = false, comControles = false }: Props) {
  const ativa = tarjaAtiva(tarjas, Math.floor(segundo));
  if (!ativa) return null;
  const cor = ESTILO_COR_TARJA[ativa.cor];
  const animacao = ativa.posicao === "topo" ? "motion-safe:animate-[vw-tarja-topo_.35s_ease-out]" : "motion-safe:animate-[vw-tarja-base_.35s_ease-out]";

  return (
    <div
      // Chave pelo conteúdo: a troca de uma tarja por outra refaz a animação de entrada.
      key={`${ativa.apareceSeg}-${ativa.texto}`}
      role="status"
      aria-live="polite"
      data-tarja-aviso
      className={`pointer-events-none absolute inset-x-0 z-20 flex items-center justify-center gap-2 px-4 py-2 shadow-lg max-[640px]:gap-1.5 max-[640px]:px-3 max-[640px]:py-1.5 ${classePosicao(ativa.posicao, vertical, comControles)} ${animacao}`}
      style={{ backgroundColor: cor.fundo, color: cor.texto }}
    >
      <TriangleAlert aria-hidden size={20} strokeWidth={2.5} className="shrink-0 max-[640px]:size-4" />
      <p className="line-clamp-2 text-center text-base leading-snug font-bold break-words max-[640px]:text-[13px] max-[640px]:leading-tight">{ativa.texto}</p>
    </div>
  );
}
