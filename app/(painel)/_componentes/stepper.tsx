import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { estiloBotao } from "./ui";

export type PassoStepper = {
  chave: string;
  rotulo: string;
  icone: LucideIcon;
  /** Sem `href`, o passo aparece mas não é clicável. */
  href?: string;
};

/**
 * Stepper do assistente: colunas de 88 px (12 passos = 1056 px), cada uma com ícone lucide de 20 px,
 * rótulo 12/700 (na cor de marca quando ativo) e círculo numerado de 28 px (atual #14532D com número branco, demais
 * #D1D5DB), ligados por uma linha. Centralizado; no celular rola na horizontal.
 */
export function Stepper({ passos, atual, rotulo = "Passos" }: { passos: PassoStepper[]; atual: string; rotulo?: string }) {
  return (
    <nav aria-label={rotulo} className="-mx-1 overflow-x-auto px-1 pb-1">
      <ol className="mx-auto flex w-max">
        {passos.map((p, i) => {
          const ativo = p.chave === atual;
          const conteudo = (
            <>
              <p.icone size={20} aria-hidden className={ativo ? "text-marca" : "text-texto-3"} />
              <span className={`text-xs font-bold leading-4 whitespace-nowrap ${ativo ? "text-marca" : "text-texto-3"}`}>{p.rotulo}</span>
              <span
                className={`relative z-10 grid size-7 place-items-center rounded-full text-xs font-semibold ${ativo ? "bg-principal text-white" : "bg-passo text-texto-2"}`}
              >
                {i + 1}
              </span>
            </>
          );
          const classe = `flex w-[88px] flex-col items-center gap-2 rounded-md py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40`;
          return (
            <li
              key={p.chave}
              className={`relative ${i < passos.length - 1 ? "after:absolute after:left-1/2 after:top-[66px] after:h-0.5 after:w-full after:bg-passo after:content-['']" : ""}`}
            >
              {p.href ? (
                <Link href={p.href} aria-current={ativo ? "step" : undefined} className={`${classe} hover:bg-suave`}>
                  {conteudo}
                </Link>
              ) : (
                <span aria-current={ativo ? "step" : undefined} className={classe}>
                  {conteudo}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Rodapé do cartão do assistente: "Voltar" à esquerda e, à direita, o que vier em `children` (o "Continuar"
 *  do passo, normalmente `<Botao variante="contorno" className="min-w-[114px]">Continuar</Botao>`). */
export function RodapeAssistente({ voltar, children }: { voltar?: string; children?: React.ReactNode }) {
  return (
    <div className="mt-8 flex items-center justify-between gap-3 border-t border-linha pt-6">
      {voltar ? (
        <Link href={voltar} className={`${estiloBotao("secundario")} min-w-[114px]`}>
          Voltar
        </Link>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
