import { SegmentosLink } from "../../_componentes/barra-filtros";

export const ABAS = [
  { valor: "nativas", rotulo: "Integrações nativas" },
  { valor: "webinar", rotulo: "Integrações do webinar" },
  { valor: "mcp", rotulo: "Integrações MCP" },
] as const;

export type Aba = (typeof ABAS)[number]["valor"];

/** Título "Integrações" e as abas das Configurações. A aba "Integrações do webinar" também fica ativa dentro de
 *  `/configuracoes/integracoes/[id]` (as integrações de um webinar escolhido). */
export function AbasIntegracoes({ aba }: { aba: Aba }) {
  return (
    <>
      <h2 className="text-lg font-semibold text-texto">Integrações</h2>
      <SegmentosLink
        rotulo="Tipo de integração"
        opcoes={ABAS.map((a) => ({ href: a.valor === "nativas" ? "/configuracoes" : `/configuracoes?aba=${a.valor}`, rotulo: a.rotulo, ativo: a.valor === aba }))}
      />
    </>
  );
}
