"use client";
import { useMemo } from "react";
import { LogoSala, SelosSeguranca, TelaCartao } from "../_ui/sala-ui";
import { CamposInscricao, useHorariosJit, type PropsInscricao } from "./inscricao";

type Props = PropsInscricao & {
  titulo: string | null;
  apresentadorNome: string | null;
  apresentadorAvatarUrl: string | null;
};

/** Tela padrão da `/lp` (sem página do editor vinculada), no mesmo cartão branco do login: logo, título,
 *  apresentador e o formulário com a lista de horários. */
export default function Formulario(p: Props) {
  const h = useHorariosJit(p);
  // Mesmo objeto entre renders (a lista de horários se recalcula a cada 30 s): ver `app/s/_paginas/montador.tsx`.
  const tituloHtml = useMemo(() => (p.tela.tituloHtml ? { __html: p.tela.tituloHtml } : null), [p.tela.tituloHtml]);

  return (
    <TelaCartao>
      {p.tela.logoUrl && <LogoSala url={p.tela.logoUrl} larguraTotal={p.tela.logoLarguraTotal} alinhamento={p.tela.logoAlinhamento} />}

      {tituloHtml ? (
        <div className="w-full text-center text-2xl leading-snug font-bold text-titulo" dangerouslySetInnerHTML={tituloHtml} />
      ) : (
        p.titulo && <h1 className="w-full text-center text-2xl leading-snug font-bold text-titulo">{p.titulo}</h1>
      )}

      {p.apresentadorNome && (
        <div className="flex w-full items-center justify-center gap-3">
          {p.apresentadorAvatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.apresentadorAvatarUrl} alt={p.apresentadorNome} className="h-10 w-10 rounded-full object-cover" />
          )}
          <p className="text-sm font-medium text-texto-2">{p.apresentadorNome}</p>
        </div>
      )}

      <CamposInscricao p={p} h={h} mostrarHorarios rotulos />

      <SelosSeguranca idioma={p.idioma} />
    </TelaCartao>
  );
}
