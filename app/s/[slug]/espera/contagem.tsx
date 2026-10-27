"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";

const UNIDADES = [
  ["dias", 86_400] as const,
  ["horas", 3_600] as const,
  ["minutos", 60] as const,
  ["segundos", 1] as const,
];

/** Segundos até `inicioMs` (com o relógio corrigido pelo `agoraServidor`), atualizados a cada 1 s. Com `atualizar`,
 *  faz `router.refresh()` ao zerar e a cada 15 s (a raiz da sala manda para a sala quando ela abre). */
function useAtualizarAoZerar(inicioMs: number, agoraServidor: number, atualizar: boolean): number {
  const router = useRouter();
  const deslocamentoRef = useRef(agoraServidor - Date.now());
  const [restanteSeg, setRestanteSeg] = useState(() => Math.max(0, Math.floor((inicioMs - (Date.now() + deslocamentoRef.current)) / 1000)));
  const zerouRef = useRef(false);

  useEffect(() => {
    const tick = setInterval(() => {
      const s = Math.max(0, Math.floor((inicioMs - (Date.now() + deslocamentoRef.current)) / 1000));
      setRestanteSeg(s);
      if (atualizar && s <= 0 && !zerouRef.current) {
        zerouRef.current = true;
        router.refresh();
      }
    }, 1000);
    const confere = atualizar ? setInterval(() => router.refresh(), 15_000) : null;
    return () => {
      clearInterval(tick);
      if (confere) clearInterval(confere);
    };
  }, [inicioMs, router, atualizar]);

  return restanteSeg;
}

/** Só a parte que abre a sala, sem mostrar nada: a página de espera do editor sem o bloco `contagem` também precisa
 *  atualizar ao chegar a hora (senão a pessoa fica parada na espera com a sala já aberta). */
export function AtualizadorEspera({ inicioMs, agoraServidor }: { inicioMs: number; agoraServidor: number }) {
  useAtualizarAoZerar(inicioMs, agoraServidor, true);
  return null;
}

/** "Começa em" dias/horas/minutos/segundos até `inicioMs`; ao zerar, `router.refresh()` (a agenda pode ter virado
 *  "aberta" nesse instante). A cada 15 s confere de novo de qualquer forma, por segurança (relógio do visitante
 *  desalinhado, agenda editada no meio do caminho).
 *
 *  `agoraServidor` (ms, lido no servidor ao renderizar) corrige o relógio do visitante: o deslocamento
 *  (`agoraServidor - Date.now()` no instante em que o componente monta) é aplicado em todo tick, então um relógio
 *  local atrasado/adiantado não muda quando a contagem zera.
 *
 *  `atualizar = false` (bloco `contagem` da página de registro do editor, na `/lp`): só conta, sem `router.refresh()`
 *  (a `/lp` não "abre" ao zerar; atualizar a cada 15 s só recarregaria a página de inscrição de todo visitante).
 *
 *  `formato = "texto"`: a espera padrão ("X dias, Y horas, Z minutos e W segundos", numa linha).
 *  `"blocos"` (padrão): números grandes com o rótulo embaixo, usado pelo bloco `contagem` das páginas do editor; o
 *  rótulo herda a cor da página (com opacidade), então serve a fundo claro e escuro. */
export default function Contagem({
  inicioMs,
  idioma,
  agoraServidor,
  atualizar = true,
  formato = "blocos",
}: {
  inicioMs: number;
  idioma: Idioma;
  agoraServidor: number;
  atualizar?: boolean;
  formato?: "blocos" | "texto";
}) {
  const restanteSeg = useAtualizarAoZerar(inicioMs, agoraServidor, atualizar);

  let resto = restanteSeg;
  const partes = UNIDADES.map(([chave, seg]) => {
    const valor = Math.floor(resto / seg);
    resto -= valor * seg;
    return { chave, valor };
  });

  if (formato === "texto") {
    const [d, h, m, seg] = partes.map((p) => p.valor);
    return (
      <p className="text-xl leading-snug font-bold text-marca tabular-nums" aria-live="polite">
        {t(idioma, "contagemPorExtenso", { d, h, m, s: seg })}
      </p>
    );
  }

  return (
    <div className="flex items-center justify-center gap-5" aria-live="polite">
      {partes.map(({ chave, valor }) => (
        <div key={chave} className="flex flex-col items-center">
          <span className="text-3xl font-bold tabular-nums">{String(valor).padStart(2, "0")}</span>
          <span className="mt-1 text-[11px] tracking-wide uppercase opacity-60">{t(idioma, chave)}</span>
        </div>
      ))}
    </div>
  );
}
