// Gráficos do Dashboard geral e das Métricas do webinar: funil de conversão em forma de
// funil (degradê da marca), donut de dispositivos e calendário de eventos agendados. SVG puro, sem estado.

export type EtapaFunilVisual = { etapa: string; rotulo: string; numero: number; percentual: number };

const numero = new Intl.NumberFormat("pt-BR");

/** Funil de conversão: colunas com rótulo, número 24/700 e %, e embaixo a forma do funil num degradê
 *  da marca clara até a marca. No celular rola na horizontal (não espreme as colunas). */
export function FunilConversao({ etapas }: { etapas: EtapaFunilVisual[] }) {
  const n = etapas.length;
  if (n === 0) return null;
  const base = Math.max(1, etapas[0]?.numero ?? 0);
  // Meia altura em cada borda de coluna: a coluna i vai da altura dela até a da próxima (a última termina igual).
  const meia = etapas.map((e) => 8 + 42 * Math.min(1, e.numero / base));
  const largura = 1000;
  const passo = largura / n;
  const topo: string[] = [];
  const baixo: string[] = [];
  for (let i = 0; i <= n; i++) {
    const h = meia[Math.min(i, n - 1)];
    const x = i * passo;
    topo.push(`${x},${60 - h}`);
    baixo.unshift(`${x},${60 + h}`);
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {etapas.map((e, i) => (
            <div key={e.etapa} className={`min-w-0 px-3 pb-3 ${i > 0 ? "border-l border-linha" : ""}`}>
              <p className="truncate text-sm text-texto-3" title={e.rotulo}>
                {e.rotulo}
              </p>
              <p className="text-valor font-bold tabular-nums text-texto">{numero.format(e.numero)}</p>
              <p className="text-xs font-medium tabular-nums text-texto-4">{i === 0 ? "100%" : `${String(e.percentual).replace(".", ",")}%`}</p>
            </div>
          ))}
        </div>
        <svg viewBox={`0 0 ${largura} 120`} preserveAspectRatio="none" className="block h-[120px] w-full" role="img" aria-label="Forma do funil de conversão">
          <defs>
            <linearGradient id="vw-funil" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--color-marca-funil)" />
              <stop offset="100%" stopColor="var(--color-marca)" />
            </linearGradient>
          </defs>
          <polygon points={[...topo, ...baixo].join(" ")} fill="url(#vw-funil)" />
          {etapas.slice(1).map((e, i) => (
            <line key={e.etapa} x1={(i + 1) * passo} x2={(i + 1) * passo} y1={0} y2={120} stroke="var(--color-superficie)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>
    </div>
  );
}

/** Donut "Dispositivos" (desktop na marca, celular na marca clara) com legenda e percentuais. */
export function DonutDispositivos({ desktop, celular }: { desktop: number; celular: number }) {
  const total = desktop + celular;
  const r = 52;
  const c = 2 * Math.PI * r;
  const fatiaDesktop = total ? (desktop / total) * c : 0;
  const pct = (v: number) => (total ? `${Math.round((v / total) * 100)}%` : "0%");
  const itens = [
    { rotulo: "Desktop", valor: desktop, cor: "var(--color-marca-forte)" },
    { rotulo: "Celular", valor: celular, cor: "var(--color-marca-funil)" },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-8">
      <svg viewBox="0 0 140 140" className="size-40 shrink-0 -rotate-90" role="img" aria-label={`Desktop ${pct(desktop)}, celular ${pct(celular)}`}>
        <circle cx={70} cy={70} r={r} fill="none" stroke="var(--color-suave)" strokeWidth={18} />
        {total > 0 && (
          <>
            <circle cx={70} cy={70} r={r} fill="none" stroke="var(--color-marca-funil)" strokeWidth={18} />
            <circle cx={70} cy={70} r={r} fill="none" stroke="var(--color-marca-forte)" strokeWidth={18} strokeDasharray={`${fatiaDesktop} ${c}`} />
          </>
        )}
      </svg>
      <ul className="space-y-3 text-sm">
        {itens.map((i) => (
          <li key={i.rotulo} className="flex items-center gap-2">
            <span aria-hidden className="size-3 rounded-sm" style={{ background: i.cor }} />
            <span className="w-16 text-texto-2">{i.rotulo}</span>
            <span className="font-semibold tabular-nums text-texto">{numero.format(i.valor)}</span>
            <span className="tabular-nums text-texto-4">({pct(i.valor)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Calendário mensal "Eventos agendados": dias com sessão ganham a contagem na cor de marca. `primeiroDiaSemana` é o
 *  dia da semana (0 = domingo) do dia 1; `contagem[dia]` é o número de sessões naquele dia do mês. */
export function CalendarioEventos({ titulo, diasNoMes, primeiroDiaSemana, hoje, contagem }: {
  titulo: string;
  diasNoMes: number;
  primeiroDiaSemana: number;
  /** Dia de hoje dentro do mês mostrado (ou `null`). */
  hoje: number | null;
  contagem: Record<number, number>;
}) {
  const celulas: (number | null)[] = [...Array(primeiroDiaSemana).fill(null), ...Array.from({ length: diasNoMes }, (_, i) => i + 1)];
  while (celulas.length % 7) celulas.push(null);

  return (
    <div className="space-y-3">
      <p className="rounded-md bg-marca px-3 py-1.5 text-center text-sm font-semibold capitalize text-white">{titulo}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {DIAS_SEMANA.map((d) => (
          <span key={d} className="py-1 font-medium text-texto-4">
            {d}
          </span>
        ))}
        {celulas.map((dia, i) => {
          if (dia === null) return <span key={`v${i}`} />;
          const qtd = contagem[dia] ?? 0;
          return (
            <span
              key={dia}
              title={qtd ? `${qtd} sessão${qtd === 1 ? "" : "es"}` : undefined}
              className={`relative grid h-9 place-items-center rounded-md text-sm tabular-nums ${qtd ? "bg-marca-clara font-semibold text-marca-forte" : "text-texto-2"} ${dia === hoje ? "ring-2 ring-marca" : ""}`}
            >
              {dia}
              {qtd > 0 && (
                <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-marca text-[10px] font-semibold text-white">{qtd > 9 ? "9+" : qtd}</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
