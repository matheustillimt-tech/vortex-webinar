import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import type { SalaOferta } from "@/src/lib/sala/dados";
import { corBotaoOferta } from "./Oferta";

type Props = {
  idioma: Idioma;
  oferta: SalaOferta;
  onClicarOferta: () => void;
};

/** Tela de fim: cobre o vídeo (pausado) com "Transmissão encerrada / Aproveite a oferta agora mesmo" + o card da
 *  oferta, se estiver ligada. No celular o vídeo é baixo (16:9 na largura da tela): o card fica sem o banner e a
 *  tela rola se precisar (a aba Oferta, aberta junto, mostra tudo). */
export default function Fim({ idioma, oferta, onClicarOferta }: Props) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-black/85 px-4 py-4 text-center text-white">
      <div className="flex flex-col items-center gap-1">
        <p className="text-xl font-bold max-[950px]:text-lg">{t(idioma, "encerrada")}</p>
        {oferta?.ligada && <p className="text-sm text-white/80">{t(idioma, "aproveite")}</p>}
      </div>

      {oferta?.ligada && (
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl bg-white p-4 text-texto shadow-lg max-[950px]:max-w-xs max-[950px]:gap-2 max-[950px]:p-3">
          {oferta.bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={oferta.bannerUrl} alt="" className="w-full rounded-lg object-cover max-[950px]:hidden" />
          )}
          {oferta.titulo && <p className="text-base leading-snug font-bold text-titulo">{oferta.titulo}</p>}
          {(oferta.precoOriginal || oferta.precoOferta) && (
            <div className="flex items-baseline gap-2">
              {oferta.precoOriginal && <span className="text-sm text-texto-4 line-through">{oferta.precoOriginal}</span>}
              {oferta.precoOferta && <span className="text-lg font-extrabold text-titulo">{oferta.precoOferta}</span>}
            </div>
          )}
          <button
            type="button"
            onClick={onClicarOferta}
            className="flex min-h-11 w-full items-center justify-center rounded-md px-4 py-2 text-base font-bold text-white shadow-sm transition-[filter] hover:brightness-95"
            style={{ backgroundColor: corBotaoOferta(oferta) }}
          >
            {oferta.botaoTexto}
          </button>
        </div>
      )}
    </div>
  );
}
