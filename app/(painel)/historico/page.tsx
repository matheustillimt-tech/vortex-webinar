import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { filtrosHistorico, type SearchParamsEntrada } from "@/src/lib/regras/auditoria";
import { buscarHistorico } from "@/src/lib/historico";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { AjudaInfo, estiloCartao, Pagina } from "../_componentes/ui";
import { FiltrosHistoricoForm } from "./_filtros";
import { Paginacao } from "./_paginacao";
import { TabelaHistorico } from "./_tabela";

export const metadata: Metadata = { title: `Histórico de ações · ${NOME_SISTEMA}` };

export default async function Historico({ searchParams }: { searchParams: Promise<SearchParamsEntrada> }) {
  await exigirAdmin();
  const filtros = filtrosHistorico(await searchParams);
  const db = await dbUsuario();
  const { linhas, total, erro } = await buscarHistorico(db, filtros);

  return (
    <Pagina titulo="Histórico de ações" infoTitulo={<AjudaInfo texto="Toda ação feita no painel: quem, quando, o quê e em qual webinar." lado="baixo" />}>
      <FiltrosHistoricoForm filtros={filtros} />
      {erro && <p role="alert" className="rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro">{erro}</p>}

      <div className={estiloCartao}>
        <TabelaHistorico linhas={linhas} />
        <div className="border-t border-linha px-4 py-3">
          <Paginacao base="/historico" filtros={filtros} total={total} />
        </div>
      </div>
    </Pagina>
  );
}
