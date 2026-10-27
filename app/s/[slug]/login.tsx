"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { entrar, type ResultadoEntrada } from "./actions";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import type { SalaTelaLogin } from "@/src/lib/sala/dados";
import { BOTAO_SALA, CAMPO_SALA, CampoSala, LogoSala, SelosSeguranca, TelaCartao } from "./_ui/sala-ui";

type Props = {
  slug: string;
  webinarId: string;
  idioma: Idioma;
  tela: SalaTelaLogin;
  utms: Record<string, string>;
  replay: boolean;
  /** Link de teste do Pronto: o formulário vai por GET pro `/entrar` com o token (cria a sessão de teste com os
   *  dados digitados) em vez de cadastrar participante. */
  teste?: { acao: string; token: string; pular: string };
};

const ESTADO_INICIAL: ResultadoEntrada = {};

/** Sobe de `tela.barraValor` até 99%, 1 a 3 pontos a cada 2,5 s, lembrada em `sessionStorage` (sobrevive a um
 *  refresh sem reiniciar do zero). */
function useBarraDeVagas(webinarId: string, inicial: number, ligada: boolean): number {
  const chave = `vw_barra_${webinarId}`;
  const [valor, setValor] = useState(inicial);

  useEffect(() => {
    if (!ligada) return;
    let v = inicial;
    try {
      const salvo = Number(sessionStorage.getItem(chave));
      if (Number.isFinite(salvo) && salvo > v) v = salvo;
    } catch {
      /* sessionStorage indisponível (modo privado etc.): segue sem lembrar. */
    }
    setValor(v);

    const id = setInterval(() => {
      v = Math.min(99, v + 1 + Math.floor(Math.random() * 3));
      setValor(v);
      try {
        sessionStorage.setItem(chave, String(v));
      } catch {
        /* idem */
      }
      if (v >= 99) clearInterval(id);
    }, 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, ligada]);

  return valor;
}

/** Barra de vagas: pílula alta (32 px) com o texto dentro, nas cores do passo Login. */
function BarraVagas({ valor, cor, corTexto, idioma }: { valor: number; cor: string; corTexto: string; idioma: Idioma }) {
  return (
    <div
      className="relative h-8 w-full overflow-hidden rounded-full bg-[#E5E7EB]"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={valor}
    >
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${valor}%`, backgroundColor: cor }} />
      <span
        className="absolute inset-0 flex items-center justify-center px-3 text-sm font-semibold whitespace-nowrap"
        style={{ color: corTexto }}
      >
        {t(idioma, "vagas", { n: valor })}
      </span>
    </div>
  );
}

export default function Login({ slug, webinarId, idioma, tela, utms, replay, teste }: Props) {
  const [estado, acao, pendente] = useActionState(entrar.bind(null, slug), ESTADO_INICIAL);
  const barra = useBarraDeVagas(webinarId, tela.barraValor, tela.barraLigada);
  // Mesmo objeto entre renders: a barra re-renderiza a cada 2,5 s e um `{ __html }` novo faria o React reescrever o
  // `innerHTML` do título toda vez (ver `app/s/_paginas/montador.tsx`).
  const tituloHtml = useMemo(() => (tela.tituloHtml ? { __html: tela.tituloHtml } : null), [tela.tituloHtml]);

  return (
    <TelaCartao>
      {tela.logoUrl && (
        <LogoSala url={tela.logoUrl} larguraTotal={tela.logoLarguraTotal} alinhamento={tela.logoAlinhamento} />
      )}

      {tela.barraLigada && <BarraVagas valor={barra} cor={tela.barraCor} corTexto={tela.barraCorTexto} idioma={idioma} />}

      {tituloHtml && <div className="vw-titulo-login w-full text-center text-2xl leading-snug font-bold text-titulo" dangerouslySetInnerHTML={tituloHtml} />}

      {teste && (
        <p className="w-full rounded-lg bg-[#FEF3C7] px-3 py-2 text-center text-sm text-[#92400E]">
          Modo teste: o que você preencher vai pros webhooks, sem contar nas métricas.{" "}
          <a href={teste.pular} className="font-semibold underline">
            Entrar sem preencher
          </a>
        </p>
      )}

      <form {...(teste ? { method: "get", action: teste.acao } : { action: acao })} className="flex w-full flex-col gap-4">
        {teste ? (
          <>
            <input type="hidden" name="teste" value={teste.token} />
            {Object.entries(utms).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          </>
        ) : (
          <>
            <input type="hidden" name="replay" value={replay ? "1" : "0"} />
            <input type="hidden" name="utms" value={JSON.stringify(utms)} />
          </>
        )}

        <CampoSala rotulo={t(idioma, "nome")}>
          <input name="nome" placeholder={tela.placeholderNome} defaultValue={estado.valores?.nome ?? ""} autoComplete="name" className={CAMPO_SALA} />
        </CampoSala>
        {tela.pedeEmail && (
          <CampoSala rotulo={t(idioma, "email")}>
            <input
              name="email"
              type="email"
              inputMode="email"
              placeholder={tela.placeholderEmail}
              defaultValue={estado.valores?.email ?? ""}
              required={tela.emailObrigatorio}
              autoComplete="email"
              className={CAMPO_SALA}
            />
          </CampoSala>
        )}
        {tela.pedeTelefone && (
          <CampoSala rotulo={t(idioma, "telefone")}>
            <input
              name="telefone"
              type="tel"
              inputMode="tel"
              placeholder={tela.placeholderTelefone}
              defaultValue={estado.valores?.telefone ?? ""}
              required={tela.telefoneObrigatorio}
              autoComplete="tel"
              className={CAMPO_SALA}
            />
          </CampoSala>
        )}

        {estado.erro && (
          <p role="alert" className="text-sm font-medium text-erro">
            {estado.erro}
          </p>
        )}

        <button
          type="submit"
          disabled={pendente}
          className={`mt-2 ${BOTAO_SALA}`}
          style={{ backgroundColor: tela.botaoCor, color: tela.botaoCorTexto }}
        >
          {pendente ? (
            t(idioma, "enviando")
          ) : (
            <>
              {tela.botaoTexto}
              <ArrowRight aria-hidden size={20} />
            </>
          )}
        </button>
      </form>

      <SelosSeguranca idioma={idioma} />
    </TelaCartao>
  );
}
