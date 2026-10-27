import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { estiloBotao } from "./ui";

/**
 * Rodapé de tabela: "Total de registros: N registros" à esquerda e "Página X de Y" + Anterior/Próximo
 * (botões de 36 px, 12 px) à direita. Sem diretiva: funciona em server component (com `href`) e dentro de
 * componente cliente (com `aoMudar`).
 */
export function Paginacao({ total, pagina, porPagina, href, aoMudar, rotuloTotal = "registros" }: {
  total: number;
  /** Começa em 1. */
  pagina: number;
  porPagina: number;
  /** Link de cada página (server component). */
  href?: (pagina: number) => string;
  /** Troca de página no cliente. */
  aoMudar?: (pagina: number) => void;
  /** Palavra depois do número (ex.: "ações"). */
  rotuloTotal?: string;
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const atual = Math.min(Math.max(1, pagina), totalPaginas);
  const estilo = `${estiloBotao("secundario", "pequeno")} h-9`;
  const desligado = `${estilo} pointer-events-none opacity-50`;

  function botao(destino: number, rotulo: string, icone: React.ReactNode, depois = false) {
    const conteudo = depois ? <>{rotulo}{icone}</> : <>{icone}{rotulo}</>;
    const fora = destino < 1 || destino > totalPaginas;
    if (fora) return <span aria-disabled className={desligado}>{conteudo}</span>;
    if (href) return <Link href={href(destino)} className={estilo}>{conteudo}</Link>;
    return <button type="button" onClick={() => aoMudar?.(destino)} className={estilo}>{conteudo}</button>;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-texto-4">
      <p>
        Total de registros: <span className="font-medium text-texto">{total}</span> {rotuloTotal}
      </p>
      <div className="flex items-center gap-2">
        <span className="mr-1 text-xs font-medium text-texto">
          Página {atual} de {totalPaginas}
        </span>
        {botao(atual - 1, "Anterior", <ChevronLeft aria-hidden />)}
        {botao(atual + 1, "Próximo", <ChevronRight aria-hidden />, true)}
      </div>
    </div>
  );
}
