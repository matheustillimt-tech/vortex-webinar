import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { filtrosHistorico, type SearchParamsEntrada } from "@/src/lib/regras/auditoria";
import { buscarHistorico } from "@/src/lib/historico";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Cartao, Pagina } from "../../../_componentes/ui";
import { FiltrosHistoricoForm } from "../../../historico/_filtros";
import { Paginacao } from "../../../historico/_paginacao";
import { TabelaHistorico } from "../../../historico/_tabela";

export const metadata: Metadata = { title: `Histórico do webinar · ${NOME_SISTEMA}` };

export default async function HistoricoWebinar({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsEntrada>;
}) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();

  const { data: webinar } = await db.from("webinars").select("id, nome").eq("id", id).maybeSingle();
  if (!webinar) notFound();

  const filtros = filtrosHistorico(await searchParams);
  const { linhas, total, erro } = await buscarHistorico(db, filtros, id);

  return (
    <Pagina titulo="Histórico" subtitulo={`Ações feitas em "${(webinar as { nome: string }).nome}".`}>
      <Cartao titulo="Filtros">
        <FiltrosHistoricoForm filtros={filtros} />
        {erro && <p className="mt-2 text-sm text-vg-erro">{erro}</p>}
      </Cartao>

      <Cartao titulo="Ações">
        <div className="space-y-3">
          <TabelaHistorico linhas={linhas} comWebinar={false} />
          <Paginacao base={`/webinars/${id}/historico`} filtros={filtros} total={total} />
        </div>
      </Cartao>
    </Pagina>
  );
}
