// "Simule sua audiência" do passo Audiência: a curva do contador de público ao longo do vídeo, calculada pela mesma
// regra da sala (`alvoPublico`, em src/lib/regras/publico.ts). SVG puro, sem estado: serve a server e client.
import { alvoPublico, type Audiencia } from "@/src/lib/regras/publico";
import { formatarDuracao } from "@/src/lib/regras/video";

const PONTOS = 96;
const L = 640;
const A = 200;
const M = { esq: 40, dir: 12, topo: 12, base: 26 };

/** Escala "redonda" do eixo Y (0 até um teto bonito acima do máximo). */
function tetoEixo(maximo: number): number {
  if (maximo <= 0) return 10;
  const base = 10 ** Math.floor(Math.log10(maximo));
  for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * base >= maximo * 1.1) return f * base;
  return 10 * base;
}

export function GraficoAudiencia({ audiencia, duracaoSeg }: { audiencia: Audiencia; duracaoSeg: number | null }) {
  const pontos = Array.from({ length: PONTOS + 1 }, (_, i) => {
    const f = i / PONTOS;
    return { f, v: alvoPublico(audiencia, f) ?? 0 };
  });
  const valores = pontos.map((p) => p.v);
  const maximo = Math.max(...valores);
  const minimo = Math.min(...valores);
  const teto = tetoEixo(maximo);
  const largura = L - M.esq - M.dir;
  const altura = A - M.topo - M.base;
  const x = (f: number) => M.esq + f * largura;
  const y = (v: number) => M.topo + altura - (v / teto) * altura;
  const linha = pontos.map((p) => `${x(p.f).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${x(0)},${y(0)} ${linha} ${x(1)},${y(0)}`;
  const marcasX = [0, 0.25, 0.5, 0.75, 1];
  const marcasY = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(teto * f));
  const rotuloX = (f: number) => (duracaoSeg ? formatarDuracao(Math.round(duracaoSeg * f)) : `${Math.round(f * 100)}%`);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-borda p-4">
          <p className="text-sm font-medium text-texto-2">Máximo</p>
          <p className="text-valor font-bold tabular-nums text-texto">{maximo.toLocaleString("pt-BR")}</p>
        </div>
        <div className="rounded-lg border border-borda p-4">
          <p className="text-sm font-medium text-texto-2">Mínimo</p>
          <p className="text-valor font-bold tabular-nums text-texto">{minimo.toLocaleString("pt-BR")}</p>
        </div>
      </div>
      <figure className="rounded-lg border border-borda p-4">
        <figcaption className="mb-2 text-sm font-semibold text-texto-2">Simule sua audiência</figcaption>
        <svg viewBox={`0 0 ${L} ${A}`} className="w-full" role="img" aria-label={`Audiência ao longo do vídeo: de ${minimo} a ${maximo} pessoas.`}>
          {marcasY.map((v) => (
            <g key={v}>
              <line x1={M.esq} x2={L - M.dir} y1={y(v)} y2={y(v)} stroke="#e4e4e7" strokeWidth={1} />
              <text x={M.esq - 6} y={y(v) + 3} fontSize="10" textAnchor="end" fill="#71717a">
                {v}
              </text>
            </g>
          ))}
          {marcasX.map((f) => (
            <text key={f} x={x(f)} y={A - 8} fontSize="10" textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} fill="#71717a">
              {rotuloX(f)}
            </text>
          ))}
          <polygon points={area} fill="#0a8452" opacity={0.12} />
          <polyline points={linha} fill="none" stroke="#0a8452" strokeWidth={2} strokeLinejoin="round" />
        </svg>
        <p className="mt-1 text-xs text-texto-3">
          {audiencia.modo === "fixo"
            ? "Audiência fixa: o mesmo número do começo ao fim."
            : "Sobe até o máximo no começo, fica no topo até a metade do vídeo e cai até o mínimo no fim. Na sala o número oscila um pouco em volta da curva."}
        </p>
      </figure>
    </div>
  );
}
