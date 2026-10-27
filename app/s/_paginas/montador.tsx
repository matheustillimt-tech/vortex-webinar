"use client";
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Idioma } from "@/src/lib/regras/textos-sala";
import Contagem from "../[slug]/espera/contagem";
import HorarioPorExtenso from "../[slug]/_jit/horario";
import { CamposInscricao, ListaHorarios, useHorariosJit, type HorariosJit, type PropsInscricao } from "../[slug]/lp/inscricao";

/** O que os blocos dinâmicos precisam, por lugar (serializável: vem do servidor). */
export type BlocosCliente =
  | {
      lugar: "registro";
      inscricao: PropsInscricao;
      /** `false` quando a página tem o bloco `horarios`: o formulário não repete a lista. */
      mostrarHorarios: boolean;
    }
  | {
      lugar: "espera";
      idioma: Idioma;
      inicioMs: number;
      agoraServidor: number;
      /** JIT: a data por extenso sai no fuso aplicado (no navegador, se "participante"). Sessão única: já veio pronta
       *  no HTML, então `null`. */
      dataSessao: { iso: string; fuso: string } | null;
    };

/** Horário escolhido, compartilhado entre os blocos `formulario`, `horarios`, `data-sessao` e `contagem` da `/lp`. */
export const CtxRegistro = createContext<{ p: PropsInscricao; h: HorariosJit; mostrarHorarios: boolean } | null>(null);

function ProvedorRegistro({ p, mostrarHorarios, children }: { p: PropsInscricao; mostrarHorarios: boolean; children: React.ReactNode }) {
  const h = useHorariosJit(p);
  return <CtxRegistro.Provider value={{ p, h, mostrarHorarios }}>{children}</CtxRegistro.Provider>;
}

/** Horário que os blocos `data-sessao` e `contagem` mostram: o mesmo que o formulário vai enviar (o escolhido na
 *  lista, ou o primeiro quando a configuração entra direto). */
export function horarioDosBlocos(h: Pick<HorariosJit, "opcoes" | "horarioEnviado">): string | null {
  return (h.horarioEnviado && h.opcoes.includes(h.horarioEnviado) ? h.horarioEnviado : h.opcoes[0]) ?? null;
}

export function BlocoRegistro({ bloco }: { bloco: string }) {
  const ctx = useContext(CtxRegistro);
  if (!ctx) return null;
  const { p, h, mostrarHorarios } = ctx;
  const horario = horarioDosBlocos(h);
  switch (bloco) {
    case "formulario":
      return (
        <div className="mx-auto w-full max-w-sm">
          <CamposInscricao p={p} h={h} mostrarHorarios={mostrarHorarios} />
        </div>
      );
    case "horarios":
      return (
        <div className="mx-auto w-full max-w-sm">
          <ListaHorarios h={h} idioma={p.idioma} />
        </div>
      );
    case "data-sessao":
      return horario ? <span className="first-letter:uppercase">{h.rotulo(horario)}</span> : null;
    case "contagem":
      // Na `/lp` a contagem só conta: nada "abre" ao zerar, e a lista de horários se recalcula sozinha.
      return horario ? <Contagem inicioMs={Date.parse(horario)} idioma={p.idioma} agoraServidor={p.agoraServidor} atualizar={false} /> : null;
    default:
      return null;
  }
}

function BlocoEspera({ bloco, b }: { bloco: string; b: Extract<BlocosCliente, { lugar: "espera" }> }) {
  switch (bloco) {
    case "contagem":
      // Mesma contagem da tela padrão: ao zerar (e a cada 15 s) atualiza a página, que abre a sala na hora.
      return <Contagem inicioMs={b.inicioMs} idioma={b.idioma} agoraServidor={b.agoraServidor} />;
    case "data-sessao":
      return b.dataSessao ? <HorarioPorExtenso iso={b.dataSessao.iso} fuso={b.dataSessao.fuso} idioma={b.idioma} /> : null;
    default:
      return null;
  }
}

/** Contêiner `.vw-pagina` com o HTML já limpo (uma string só) e os componentes da sala montados com `createPortal`
 *  nos pontos `<span data-vw-montar="bloco">`.
 *
 *  O objeto `{ __html }` PRECISA ser o mesmo entre renders (`useMemo`): o React que o Next 15 embute
 *  (`next/dist/compiled/react-dom`, 19.2 canary) compara a prop `dangerouslySetInnerHTML` por identidade, não pelo
 *  `__html`, e reescreve o `innerHTML` a cada render em que o objeto muda. Com um objeto novo por render, o
 *  `setPontos` do efeito causava um segundo render que recriava todos os nós; os portais iam para os pontos antigos,
 *  já fora do documento, e o formulário nunca aparecia (sem erro nenhum no console).
 *
 *  Os pontos são procurados num `useLayoutEffect` (depois da troca do `innerHTML`, antes da pintura) e de novo
 *  sempre que o conteúdo do contêiner for trocado por fora do React (`MutationObserver` só nos filhos diretos: o que
 *  os portais montam lá dentro não dispara). */
export default function MontadorPagina({ html, blocos }: { html: string; blocos: BlocosCliente }) {
  const ref = useRef<HTMLDivElement>(null);
  const htmlPagina = useMemo(() => ({ __html: html }), [html]);
  const [pontos, setPontos] = useState<{ el: Element; bloco: string }[]>([]);

  useLayoutEffect(() => {
    const raiz = ref.current;
    if (!raiz) return;
    const procurar = () =>
      setPontos(
        Array.from(raiz.querySelectorAll("[data-vw-montar]")).map((el) => ({ el, bloco: el.getAttribute("data-vw-montar") ?? "" })),
      );
    procurar();
    const obs = new MutationObserver(procurar);
    obs.observe(raiz, { childList: true });
    return () => obs.disconnect();
  }, [htmlPagina]);

  const portais = pontos.map(({ el, bloco }, i) =>
    createPortal(
      blocos.lugar === "registro" ? <BlocoRegistro bloco={bloco} /> : <BlocoEspera bloco={bloco} b={blocos} />,
      el,
      `${bloco}-${i}`,
    ),
  );

  const conteudo = (
    <>
      <div ref={ref} className="vw-pagina" style={{ minHeight: "100vh" }} dangerouslySetInnerHTML={htmlPagina} />
      {portais}
    </>
  );

  return blocos.lugar === "registro" ? (
    <ProvedorRegistro p={blocos.inscricao} mostrarHorarios={blocos.mostrarHorarios}>
      {conteudo}
    </ProvedorRegistro>
  ) : (
    conteudo
  );
}
