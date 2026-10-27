// Cores: marca #0A8452 (ao vivo, retenção) e marca clara #86D9B0 (replay).
// Gráficos SVG puros (sem biblioteca), no mesmo estilo do painel Ao vivo (`webinars/[id]/ao-vivo/PainelAoVivo.tsx`).
// Compartilhados pelas Métricas por webinar e pelo Dashboard geral — nenhum tem estado, por
// isso nenhum precisa de "use client".

export type PontoRetencao = { minuto: number; visualizacoes: number };
export type PontoPorDia = { dia: string; aoVivo: number; replay: number };
export type PontoPais = { pais: string; total: number };

/** Gráfico de área simples da retenção por minuto do vídeo. */
export function GraficoRetencao({ retencao }: { retencao: PontoRetencao[] }) {
  if (retencao.length === 0) return <p className="text-sm text-vg-muted">Sem dados de retenção no período.</p>;

  const largura = 760;
  const altura = 160;
  const maximo = Math.max(1, ...retencao.map((r) => r.visualizacoes));
  const passo = largura / Math.max(1, retencao.length - 1);
  const pontos = retencao.map((r, i) => [i * passo, altura - (r.visualizacoes / maximo) * (altura - 8)] as const);
  const linha = pontos.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,${altura} ${linha} ${largura},${altura}`;
  const cadaRotulo = Math.max(1, Math.ceil(retencao.length / 10));

  return (
    <svg viewBox={`0 0 ${largura} ${altura + 18}`} className="w-full" role="img" aria-label="Retenção por minuto">
      <polygon points={area} fill="#0a8452" opacity={0.18} />
      <polyline points={linha} fill="none" stroke="#0a8452" strokeWidth={2} />
      {retencao.map(
        (r, i) =>
          i % cadaRotulo === 0 && (
            <text key={r.minuto} x={i * passo} y={altura + 14} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.6}>
              {r.minuto} min
            </text>
          ),
      )}
    </svg>
  );
}

/** Participantes por dia, ao vivo × replay, em barras empilhadas. */
export function GraficoPorDia({ porDia }: { porDia: PontoPorDia[] }) {
  if (porDia.length === 0) return <p className="text-sm text-vg-muted">Sem participantes no período.</p>;

  const largura = 760;
  const altura = 140;
  const maximo = Math.max(1, ...porDia.map((d) => d.aoVivo + d.replay));
  const passo = largura / porDia.length;
  const cadaRotulo = Math.max(1, Math.ceil(porDia.length / 10));

  return (
    <svg viewBox={`0 0 ${largura} ${altura + 18}`} className="w-full" role="img" aria-label="Participantes por dia, ao vivo e replay">
      {porDia.map((d, i) => {
        const hAoVivo = (d.aoVivo / maximo) * (altura - 8);
        const hReplay = (d.replay / maximo) * (altura - 8);
        const x = i * passo;
        const largBarra = Math.max(1, passo - 2);
        return (
          <g key={d.dia}>
            <rect x={x + 1} y={altura - hAoVivo - hReplay} width={largBarra} height={hReplay} fill="#86d9b0" opacity={0.85}>
              <title>{`${d.dia} · replay ${d.replay}`}</title>
            </rect>
            <rect x={x + 1} y={altura - hAoVivo} width={largBarra} height={hAoVivo} fill="#0a8452" opacity={0.9}>
              <title>{`${d.dia} · ao vivo ${d.aoVivo}`}</title>
            </rect>
            {i % cadaRotulo === 0 && (
              <text x={x + passo / 2} y={altura + 14} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.6}>
                {d.dia.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Top países: lista com barra proporcional ao maior total (sem SVG — mais simples de ler numa lista curta). */
export function ListaPaises({ paises }: { paises: PontoPais[] }) {
  if (paises.length === 0) return <p className="text-sm text-vg-muted">Sem dados no período.</p>;
  const maior = Math.max(1, ...paises.map((p) => p.total));

  return (
    <ul className="space-y-2">
      {paises.map((p) => (
        <li key={p.pais} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span>{p.pais}</span>
            <span className="tabular-nums text-vg-muted">{p.total}</span>
          </div>
          <div className="h-1.5 rounded-full bg-vg-panel-3">
            <div className="h-1.5 rounded-full bg-vg-accent" style={{ width: `${(p.total / maior) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
