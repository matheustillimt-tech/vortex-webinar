// Barra de filtros das listas: tudo numa linha (busca e filtros à esquerda; à direita o botão
// de criar ou, na lista de webinars, os filtros); até 900 px tudo empilha e ocupa a largura toda.
import Link from "next/link";
import { estiloSegmento, estiloSegmentos } from "./ui";

export function BarraFiltros({ children, acao }: { children: React.ReactNode; /** Grupo à direita (ex.: "Criar novo", ou os filtros da lista de webinars). */ acao?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 max-tela-md:flex-col max-tela-md:items-stretch">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 max-tela-md:flex-col max-tela-md:items-stretch max-tela-md:[&>*]:w-full">{children}</div>
      {acao && <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 max-tela-md:ml-0 max-tela-md:flex-col max-tela-md:items-stretch max-tela-md:[&>*]:w-full">{acao}</div>}
    </div>
  );
}

/** Abas segmentadas que filtram pela URL (server component: cada aba é um link). */
export function SegmentosLink({ opcoes, rotulo }: { opcoes: { href: string; rotulo: string; ativo: boolean }[]; rotulo: string }) {
  return (
    <nav aria-label={rotulo} className={`${estiloSegmentos} max-tela-md:w-full`}>
      {opcoes.map((o) => (
        <Link key={o.href + o.rotulo} href={o.href} aria-current={o.ativo ? "page" : undefined} className={`${estiloSegmento(o.ativo)} max-tela-md:flex-1`}>
          {o.rotulo}
        </Link>
      ))}
    </nav>
  );
}
