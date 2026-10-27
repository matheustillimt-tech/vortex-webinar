import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { agendaDeLinha, proximasSessoes, type LinhaAgenda } from "@/src/lib/regras/agenda";
import { formatarSessao } from "@/src/lib/regras/fuso";
import {
  escaparIlike,
  faixaDaPagina,
  filtrosDaLista,
  hrefDaLista,
  navegacaoDaLista,
  periodoEmUtc,
  POR_PAGINA_WEBINARS,
  type SearchParamsEntrada,
} from "@/src/lib/regras/lista-webinars";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { BotaoLink, Pagina, Tabela } from "../_componentes/ui";
import { Paginacao } from "../_componentes/paginacao";
import { BarraFiltros } from "../_componentes/barra-filtros";
import { BuscaUrl, FiltroUrl, PeriodoUrl } from "../_componentes/filtros-url";
import { LinhaWebinar, type WebinarLinha } from "./linha";
import { tokenTeste } from "@/src/lib/sala/sessao";
import { NovoWebinar } from "./novo";

export const metadata: Metadata = { title: `Webinars · ${NOME_SISTEMA}` };

const ORDEM = [
  { valor: "recentes", rotulo: "Data decrescente" },
  { valor: "antigos", rotulo: "Data crescente" },
];
const STATUS = [
  { valor: "ativos", rotulo: "Ativos" },
  { valor: "arquivados", rotulo: "Arquivados" },
  { valor: "todos", rotulo: "Todos os status" },
];
const TIPOS = [
  { valor: "todos", rotulo: "Todos os tipos" },
  { valor: "unica", rotulo: "Único" },
  { valor: "recorrente", rotulo: "Recorrente" },
  { valor: "jit", rotulo: "Just in time" },
];

export default async function Webinars({ searchParams }: { searchParams: Promise<SearchParamsEntrada> }) {
  await exigirAdmin();
  const sp = await searchParams;
  const filtros = filtrosDaLista(sp);
  const nav = navegacaoDaLista(sp);
  const db = await dbUsuario();

  const [inicio, fim] = faixaDaPagina(nav.pagina);
  const { desde, ateAntes } = periodoEmUtc(nav.de, nav.ate);
  let consulta = db
    .from("webinars")
    .select("id, nome, slug, status, tipo_agenda", { count: "exact" })
    .order("created_at", { ascending: nav.ordem === "antigos" })
    .order("id", { ascending: true });
  if (filtros.status !== "todos") consulta = consulta.eq("status", filtros.status === "ativos" ? "ativo" : "arquivado");
  if (filtros.tipo !== "todos") consulta = consulta.eq("tipo_agenda", filtros.tipo);
  if (filtros.busca) consulta = consulta.ilike("nome", `%${escaparIlike(filtros.busca)}%`);
  if (desde) consulta = consulta.gte("created_at", desde);
  if (ateAntes) consulta = consulta.lt("created_at", ateAntes);

  const { data, count } = await consulta.range(inicio, fim);
  const webinars = (data ?? []) as WebinarLinha[];
  const total = count ?? 0;

  const ids = webinars.map((w) => w.id);
  const [agendasData, videosData] = ids.length
    ? await Promise.all([
        db.from("agendas").select("webinar_id, fuso, inicio, fim, repeticao, dia_semana, hora_inicio, hora_fim, vigencia_fim").in("webinar_id", ids).then((r) => r.data ?? []),
        db.from("webinar_video").select("webinar_id, videos(thumb_url)").in("webinar_id", ids).then((r) => r.data ?? []),
      ])
    : [[], []];
  const agendaPorWebinar = new Map((agendasData as (LinhaAgenda & { webinar_id: string })[]).map((a) => [a.webinar_id, a]));
  const capaPorWebinar = new Map(
    (videosData as unknown as { webinar_id: string; videos: { thumb_url: string | null } | null }[]).map((v) => [v.webinar_id, v.videos?.thumb_url ?? null]),
  );

  const agora = new Date();
  function proximaSessaoTexto(w: WebinarLinha): string {
    if (w.tipo_agenda === "jit") return "Just in time: a pessoa escolhe o horário";
    const linha = agendaPorWebinar.get(w.id);
    if (!linha) return "Sem sessão marcada";
    const agenda = agendaDeLinha(linha);
    const [proxima] = proximasSessoes(agenda, agora, 1);
    if (!proxima) return "Sem sessão marcada";
    return `Próxima: ${formatarSessao(proxima.inicio, agenda.fuso)}`;
  }

  const salaUrl = process.env.NEXT_PUBLIC_SALA_URL ?? "";
  const filtrando = !!filtros.busca || filtros.status !== "ativos" || filtros.tipo !== "todos" || !!nav.de || !!nav.ate;

  return (
    <Pagina titulo="Webinars" acoes={<NovoWebinar />}>
      <BarraFiltros
        acao={
          <>
            <FiltroUrl parametro="ordem" rotulo="Ordenar" valor={nav.ordem} padrao="recentes" opcoes={ORDEM} />
            <FiltroUrl parametro="status" rotulo="Status" valor={filtros.status} padrao="ativos" opcoes={STATUS} />
            <FiltroUrl parametro="tipo" rotulo="Tipo do evento" valor={filtros.tipo} padrao="todos" opcoes={TIPOS} />
            <PeriodoUrl de={nav.de} ate={nav.ate} alinhar="direita" nota="Webinars criados no período." />
          </>
        }
      >
        <BuscaUrl valor={filtros.busca} />
      </BarraFiltros>

      <Tabela
        colunas={["Webinar", "Status", "Tipo", <span key="d" className="block text-right">Detalhes</span>]}
        vazio={webinars.length === 0 ? (filtrando ? "Sem resultados." : "Nenhum webinar ainda.") : undefined}
        vazioDetalhe={webinars.length === 0 ? (filtrando ? "Nenhum webinar bate com esses filtros." : "Clique em “Criar novo” para criar o primeiro.") : undefined}
        rodape={<Paginacao total={total} pagina={nav.pagina} porPagina={POR_PAGINA_WEBINARS} href={(p) => hrefDaLista(filtros, nav, { pagina: p })} />}
      >
        {webinars.map((w) => (
          <LinhaWebinar key={w.id} webinar={w} proximaSessao={proximaSessaoTexto(w)} miniatura={capaPorWebinar.get(w.id) ?? null} salaUrl={salaUrl} tokenTeste={tokenTeste(w.id, agora)} />
        ))}
      </Tabela>
      {webinars.length === 0 && filtrando && (
        <div className="flex justify-center">
          <BotaoLink href="/webinars" variante="secundario">
            Limpar filtros
          </BotaoLink>
        </div>
      )}
    </Pagina>
  );
}
