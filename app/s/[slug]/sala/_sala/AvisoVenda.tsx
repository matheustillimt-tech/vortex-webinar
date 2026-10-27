"use client";
import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import type { LinhaVenda } from "./useLinhaDoTempo";

type Props = {
  titulo: string;
  vendas: LinhaVenda[];
  /** Avisa o pai que pode esvaziar a fila recebida (já tiramos uma cópia aqui) — evita mostrar a mesma venda de
   *  novo se o pai renderizar outra vez antes do toast acabar. */
  onConsumido: () => void;
  /** Sala vertical (Live): o aviso fica a 40% da altura. */
  vertical?: boolean;
};

const DURACAO_MS = 4000;

/** Toast sobre o vídeo com `tituloNotificacaoCompra` (padrão "Venda confirmada!") + o texto da venda simulada,
 *  por 4 s. Quando chegam várias de uma vez (ex.: depois de reposicionar o vídeo), mostra uma de cada vez em
 *  fila, nunca sobrepostas. */
export default function AvisoVenda({ titulo, vendas, onConsumido, vertical = false }: Props) {
  const [fila, setFila] = useState<LinhaVenda[]>([]);
  const [atual, setAtual] = useState<LinhaVenda | null>(null);

  useEffect(() => {
    if (vendas.length === 0) return;
    setFila((f) => [...f, ...vendas]);
    onConsumido();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendas]);

  useEffect(() => {
    if (atual || fila.length === 0) return;
    const [proxima, ...resto] = fila;
    setAtual(proxima);
    setFila(resto);
  }, [atual, fila]);

  useEffect(() => {
    if (!atual) return;
    const id = setTimeout(() => setAtual(null), DURACAO_MS);
    return () => clearTimeout(id);
  }, [atual]);

  if (!atual) return null;

  // Aviso verde no canto inferior do vídeo (na sala vertical, a 40% da altura).
  return (
    <div
      key={atual.segundo + atual.texto}
      role="status"
      className={`pointer-events-none absolute left-3 z-20 flex w-[min(320px,calc(100%-24px))] animate-[vw-entrar-toast_.25s_ease-out] items-start gap-2.5 rounded-lg bg-ok px-3.5 py-2.5 text-white shadow-lg ${
        vertical ? "top-[40%]" : "bottom-3"
      }`}
    >
      <CircleCheck aria-hidden size={20} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm leading-5 font-semibold">{titulo}</p>
        <p className="text-[13px] leading-5 break-words text-white/90">{atual.texto}</p>
      </div>
    </div>
  );
}
