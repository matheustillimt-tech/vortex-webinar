"use client";
import { usePathname } from "next/navigation";
import type { FiltrosHistorico } from "@/src/lib/regras/auditoria";
import { hrefCom } from "@/src/lib/regras/filtros-lista";
import { BarraFiltros, SegmentosLink } from "../_componentes/barra-filtros";
import { BuscaUrl, PeriodoUrl } from "../_componentes/filtros-url";

const ACOES: { valor: FiltrosHistorico["acao"]; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todos" },
  { valor: "criou", rotulo: "Criou" },
  { valor: "editou", rotulo: "Editou" },
  { valor: "excluiu", rotulo: "Deletou" },
];

/** Barra do Histórico de ações: busca, filtro segmentado Todos / Criou / Editou / Deletou e o período
 *  num botão só. Tudo pela URL (serve para o histórico geral e o de cada webinar). */
export function FiltrosHistoricoForm({ filtros }: { filtros: FiltrosHistorico }) {
  const base = usePathname();
  const atuais = { busca: filtros.busca, acao: filtros.acao === "todas" ? "" : filtros.acao, de: filtros.de, ate: filtros.ate };
  return (
    <BarraFiltros>
      <BuscaUrl valor={filtros.busca} placeholder="Pesquise na descrição" />
      <SegmentosLink
        rotulo="Ação"
        opcoes={ACOES.map((a) => ({ rotulo: a.rotulo, ativo: filtros.acao === a.valor, href: hrefCom(base, atuais, { acao: a.valor === "todas" ? null : a.valor }) }))}
      />
      <PeriodoUrl de={filtros.de} ate={filtros.ate} />
    </BarraFiltros>
  );
}
