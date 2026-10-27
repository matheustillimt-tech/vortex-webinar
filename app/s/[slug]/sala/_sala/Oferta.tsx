import { Clock } from "lucide-react";
import { formatarRestante } from "@/src/lib/regras/oferta-contagem";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import type { SalaOferta } from "@/src/lib/sala/dados";
import { corOuPadrao } from "../../_ui/sala-ui";

type OfertaLigada = NonNullable<SalaOferta>;

type Props = {
  idioma: Idioma;
  oferta: OfertaLigada;
  restante: number;
  mobile: boolean;
  onClicar: () => void;
};

/** Botão da oferta sem cor válida: o verde padrão (`#02890B`). */
export const COR_BOTAO_OFERTA_PADRAO = "#02890B";

export function corBotaoOferta(oferta: OfertaLigada): string {
  return corOuPadrao(oferta.botaoCor, COR_BOTAO_OFERTA_PADRAO);
}

function partesTempo(seg: number) {
  const s = Math.max(0, Math.floor(seg));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const dois = (n: number) => String(n).padStart(2, "0");

/** Contagem da oferta nos 3 layouts (classic / labels / urgent). Some ao zerar. */
function Contagem({ idioma, oferta, restante }: { idioma: Idioma; oferta: OfertaLigada; restante: number }) {
  if (restante <= 0) return null;

  if (oferta.contagemLayout === "urgente") {
    return (
      <div className="flex animate-pulse items-center justify-center gap-2 rounded-md bg-erro px-3 py-2.5 text-white">
        <Clock aria-hidden size={18} />
        <span className="text-sm font-semibold">{t(idioma, "restam")}</span>
        <span className="text-xl font-bold tabular-nums">{formatarRestante(restante)}</span>
      </div>
    );
  }

  if (oferta.contagemLayout === "rotulos") {
    const { h, m, s } = partesTempo(restante);
    const blocos = [...(h > 0 ? [[h, t(idioma, "horas")] as const] : []), [m, t(idioma, "minutos")] as const, [s, t(idioma, "segundos")] as const];
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-xs font-semibold tracking-wide text-texto-4 uppercase">{t(idioma, "acabaEm")}</p>
        <div className="flex items-start justify-center gap-2">
          {blocos.map(([valor, rotulo]) => (
            <div key={rotulo} className="flex min-w-16 flex-col items-center rounded-md border border-linha bg-suave px-2 py-1.5">
              <span className="text-2xl leading-8 font-bold text-titulo tabular-nums">{dois(valor)}</span>
              <span className="text-[11px] text-texto-4">{rotulo}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-2 rounded-md border border-linha bg-suave px-3 py-2.5">
      <Clock aria-hidden size={18} className="text-erro" />
      <span className="text-sm font-medium text-texto-3">{t(idioma, "restam")}</span>
      <span className="text-xl font-bold text-erro tabular-nums">{formatarRestante(restante)}</span>
    </div>
  );
}

/** Aba Oferta: banner (mobile/desktop), "De" riscado, "Por" em destaque, "Por tempo
 *  limitado / Oferta só hoje", contagem e o botão na cor configurada (verde #02890B se não houver uma válida). */
export default function Oferta({ idioma, oferta, restante, mobile, onClicar }: Props) {
  const banner = (mobile ? oferta.bannerMobileUrl : oferta.bannerUrl) ?? oferta.bannerUrl;

  return (
    <div className="flex flex-col gap-4 p-4">
      {banner && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner} alt="" className="w-full rounded-lg object-cover" />
      )}
      {oferta.titulo && <p className="text-lg leading-snug font-bold text-titulo">{oferta.titulo}</p>}
      {(oferta.precoOriginal || oferta.precoOferta) && (
        <div className="flex flex-col">
          {oferta.precoOriginal && (
            <span className="text-sm text-texto-4 line-through">
              {t(idioma, "de")} {oferta.precoOriginal}
            </span>
          )}
          {oferta.precoOferta && (
            <span className="text-2xl leading-8 font-extrabold text-titulo">
              {t(idioma, "por")} {oferta.precoOferta}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col items-center gap-0.5 rounded-md bg-marca-linha px-3 py-2 text-center">
        <span className="text-sm font-semibold text-marca">{t(idioma, "porTempoLimitado")}</span>
        <span className="text-xs font-medium text-texto-3">{t(idioma, "ofertaSoHoje")}</span>
      </div>
      <Contagem idioma={idioma} oferta={oferta} restante={restante} />
      <button
        type="button"
        onClick={onClicar}
        className="flex min-h-12 w-full items-center justify-center rounded-md px-4 py-2 text-lg font-bold text-white shadow-sm transition-[filter] hover:brightness-95"
        style={{ backgroundColor: corBotaoOferta(oferta) }}
      >
        {oferta.botaoTexto}
      </button>
    </div>
  );
}

type BarraProps = {
  idioma: Idioma;
  oferta: OfertaLigada;
  restante: number;
  onClicar: () => void;
  /** `painel`: barra fixa acima do campo de mensagem (celular, em todas as abas); `faixa`: faixa sob o vídeo
   *  (computador); `live`: barra translúcida da sala vertical. */
  variante?: "painel" | "faixa" | "live";
  className?: string;
};

/** Barra da oferta enquanto ela estiver ativa: preço + "Restam mm:ss" + botão, bem mais compacta que a aba. */
export function BarraOferta({ idioma, oferta, restante, onClicar, variante = "painel", className = "" }: BarraProps) {
  const cor = corBotaoOferta(oferta);
  const restam =
    restante > 0 ? (
      <span className="tabular-nums">
        {t(idioma, "restam")} {formatarRestante(restante)}
      </span>
    ) : null;

  if (variante === "faixa") {
    return (
      <div className={`flex items-center gap-4 rounded-xl border border-linha bg-white p-4 ${className}`}>
        {oferta.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={oferta.bannerUrl} alt="" className="hidden h-16 w-28 shrink-0 rounded-md object-cover min-[1180px]:block" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-titulo">{oferta.titulo}</p>
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            {oferta.precoOriginal && <span className="text-texto-4 line-through">{oferta.precoOriginal}</span>}
            {oferta.precoOferta && <span className="font-bold text-texto">{oferta.precoOferta}</span>}
            {restam && <span className="font-semibold text-erro">{restam}</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={onClicar}
          className="flex h-12 shrink-0 items-center justify-center rounded-md px-6 text-base font-bold text-white shadow-sm transition-[filter] hover:brightness-95"
          style={{ backgroundColor: cor }}
        >
          {oferta.botaoTexto}
        </button>
      </div>
    );
  }

  const live = variante === "live";
  return (
    <div
      className={`flex shrink-0 items-center justify-between gap-3 px-3 py-2 ${live ? "bg-black/45 text-white backdrop-blur-sm" : "border-t border-linha bg-white"} ${className}`}
    >
      <div className="min-w-0">
        <p className={`truncate text-sm font-bold ${live ? "text-white" : "text-texto"}`}>{oferta.precoOferta ?? oferta.titulo}</p>
        {restam && <p className={`text-xs font-semibold ${live ? "text-white/85" : "text-erro"}`}>{restam}</p>}
      </div>
      <button
        type="button"
        onClick={onClicar}
        className="flex h-10 max-w-[60%] shrink-0 items-center justify-center truncate rounded-md px-4 text-sm font-bold text-white shadow-sm"
        style={{ backgroundColor: cor }}
      >
        <span className="truncate">{oferta.botaoTexto}</span>
      </button>
    </div>
  );
}
