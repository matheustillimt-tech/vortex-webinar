"use client";

/** Modo teste: atalhos pra pular direto pros momentos da aula (início, pitch, oferta e, se houver, sorteio). Só
 *  aparece pro produtor no link de teste; o participante nunca vê. */
export type Momento = { rotulo: string; segundo: number };

export function momentosDoTeste(o: { pitchSeg: number | null; apareceSeg: number; sorteioLigado: boolean; sorteioSeg: number | null } | null): Momento[] {
  const lista: Momento[] = [{ rotulo: "Início do webinar", segundo: 0 }];
  if (!o) return lista;
  if (o.pitchSeg !== null && o.pitchSeg > 0) lista.push({ rotulo: "Início do pitch", segundo: o.pitchSeg });
  lista.push({ rotulo: "Oferta", segundo: o.apareceSeg });
  if (o.sorteioLigado && o.sorteioSeg !== null) lista.push({ rotulo: "Sorteio", segundo: o.sorteioSeg });
  return lista;
}

function hms(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export default function AtalhosTeste({ momentos, onIrPara }: { momentos: Momento[]; onIrPara: (segundo: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#FDE68A] bg-aviso-fundo p-3 max-[950px]:rounded-none">
      <span className="mr-1 text-xs font-semibold text-aviso">Ir para (só no teste):</span>
      {momentos.map((m) => (
        <button
          key={m.rotulo}
          type="button"
          onClick={() => onIrPara(Math.max(0, m.segundo - 3))}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-linha bg-white px-3 text-xs font-semibold text-[#1F2937] shadow-sm hover:bg-[#F9FAFB]"
        >
          {m.rotulo}
          <span className="font-normal text-[#6B7280] tabular-nums">{hms(m.segundo)}</span>
        </button>
      ))}
    </div>
  );
}
