import "server-only";
import { escaparIlike } from "./regras/lista-webinars";
import type { FiltrosHistorico } from "./regras/auditoria";
import { ITENS_POR_PAGINA_HISTORICO } from "./regras/auditoria";
import { periodoOpcionalDe } from "./regras/metricas";
import type { dbUsuario } from "./supabase/usuario";
import type { LinhaHistorico } from "../../app/(painel)/historico/_tabela";

type DB = Awaited<ReturnType<typeof dbUsuario>>;

type LinhaBanco = {
  id: string;
  criado_em: string;
  acao: "criou" | "editou" | "excluiu";
  descricao: string;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  usuarios: { nome: string } | null;
  webinars: { nome: string } | null;
};

const ERRO_CONSULTA = "Não deu para carregar o histórico. Tente de novo.";

/** Busca a página do histórico (geral quando `webinarId` é omitido) já com os filtros aplicados e o total de
 *  linhas (pra paginação). 50 por página, mais recente primeiro. O período (`filtros.de`/`filtros.ate`) usa a
 *  mesma regra de bordas das telas de métricas (fuso de Brasília, `de` = começo do dia escolhido, `ate`
 *  exclusivo = começo do dia seguinte) em vez de comparar a data digitada direto com `created_at` (que compara
 *  no fuso do banco, não no de Brasília); data inválida devolve `erro` em vez de uma tabela vazia. Um erro na
 *  consulta em si (rede, RLS) também vira `erro` — nunca cai silenciosamente numa lista vazia. */
export async function buscarHistorico(
  db: DB,
  filtros: FiltrosHistorico,
  webinarId?: string,
): Promise<{ linhas: LinhaHistorico[]; total: number; erro?: string }> {
  const periodo = periodoOpcionalDe(filtros.de, filtros.ate);
  if ("erro" in periodo) return { linhas: [], total: 0, erro: periodo.erro };

  let consulta = db
    .from("auditoria")
    .select("id, criado_em:created_at, acao, descricao, antes, depois, usuarios(nome), webinars(nome)", { count: "exact" })
    .order("created_at", { ascending: false });

  if (webinarId) consulta = consulta.eq("webinar_id", webinarId);
  if (filtros.acao !== "todas") consulta = consulta.eq("acao", filtros.acao);
  if (filtros.busca) consulta = consulta.ilike("descricao", `%${escaparIlike(filtros.busca)}%`);
  if (periodo.de) consulta = consulta.gte("created_at", periodo.de.toISOString());
  if (periodo.ate) consulta = consulta.lt("created_at", periodo.ate.toISOString());

  const desde = (filtros.pagina - 1) * ITENS_POR_PAGINA_HISTORICO;
  const { data, error, count } = await consulta.range(desde, desde + ITENS_POR_PAGINA_HISTORICO - 1);
  if (error) return { linhas: [], total: 0, erro: ERRO_CONSULTA };

  const linhas = ((data ?? []) as unknown as LinhaBanco[]).map((l) => ({
    id: l.id,
    criado_em: l.criado_em,
    acao: l.acao,
    descricao: l.descricao,
    antes: l.antes,
    depois: l.depois,
    usuario_nome: l.usuarios?.nome ?? null,
    webinar_nome: l.webinars?.nome ?? null,
  }));

  return { linhas, total: count ?? 0 };
}
