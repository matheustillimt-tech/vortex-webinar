"use client";

export type AbaChave = "chat" | "oferta" | "sorteio";

type Props = {
  abas: { chave: AbaChave; rotulo: string }[];
  atual: AbaChave;
  onEscolher: (aba: AbaChave) => void;
  /** Sala vertical (Live): abas translúcidas por cima do vídeo. */
  live?: boolean;
};

/** Barra de abas: trilho cinza #D9D9D9, aba ativa branca, 14 px / 500,
 *  em grade de 1, 2 ou 3 colunas (Chat sempre; Oferta e Sorteio quando chegam os momentos). */
export default function Abas({ abas, atual, onEscolher, live = false }: Props) {
  return (
    <div
      role="tablist"
      className={`grid h-10 w-full gap-1 rounded-md p-1 ${live ? "bg-black/35 backdrop-blur-sm" : "bg-[#D9D9D9]"}`}
      style={{ gridTemplateColumns: `repeat(${abas.length}, minmax(0, 1fr))` }}
    >
      {abas.map((item) => {
        const ativa = atual === item.chave;
        const cor = ativa
          ? live
            ? "bg-white/90 text-texto shadow-sm"
            : "bg-white text-texto shadow-sm"
          : live
            ? "text-white/85 hover:text-white"
            : "text-[#52525B] hover:text-texto";
        return (
          <button
            key={item.chave}
            type="button"
            role="tab"
            aria-selected={ativa}
            onClick={() => onEscolher(item.chave)}
            className={`truncate rounded-sm px-2 text-sm font-medium transition-colors ${cor}`}
          >
            {item.rotulo}
          </button>
        );
      })}
    </div>
  );
}
