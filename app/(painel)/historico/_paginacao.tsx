import type { FiltrosHistorico } from "@/src/lib/regras/auditoria";
import { ITENS_POR_PAGINA_HISTORICO } from "@/src/lib/regras/auditoria";
import { Paginacao as PaginacaoComum } from "../_componentes/paginacao";

function hrefPagina(base: string, filtros: FiltrosHistorico, pagina: number): string {
  const p = new URLSearchParams();
  if (filtros.busca) p.set("busca", filtros.busca);
  if (filtros.acao !== "todas") p.set("acao", filtros.acao);
  if (filtros.de) p.set("de", filtros.de);
  if (filtros.ate) p.set("ate", filtros.ate);
  if (pagina > 1) p.set("pagina", String(pagina));
  const query = p.toString();
  return query ? `${base}?${query}` : base;
}

/** Paginação do Histórico (geral e por webinar), no rodapé comum das tabelas. */
export function Paginacao({ base, filtros, total }: { base: string; filtros: FiltrosHistorico; total: number }) {
  return (
    <PaginacaoComum
      total={total}
      pagina={filtros.pagina}
      porPagina={ITENS_POR_PAGINA_HISTORICO}
      href={(pagina) => hrefPagina(base, filtros, pagina)}
    />
  );
}
