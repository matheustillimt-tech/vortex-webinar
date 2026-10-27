import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import Link from "next/link";
import { DateTime } from "luxon";
import { CalendarDays, ChartNoAxesColumn, Clock, Earth, Filter, MonitorSmartphone, ShoppingCart, Table2, UserRound, Users, Wallet } from "lucide-react";
import { agendaDeLinha, proximasSessoes as sessoesDaAgenda, type LinhaAgenda } from "@/src/lib/regras/agenda";
import { ordenarPorFaturamento, proximasSessoesGerais, receitaPorParticipante, type WebinarComAgenda } from "@/src/lib/regras/dashboard";
import { formatarSessao } from "@/src/lib/regras/fuso";
import { formatarReais, formatarTempoMedio, montarFunil, periodoDe, type ResultadoPeriodo } from "@/src/lib/regras/metricas";
import { dbUsuario, membroAtual } from "@/src/lib/supabase/usuario";
import { GraficoPorDia, ListaPaises } from "./_componentes/graficos";
import { BotaoLink, Cartao, estiloCelula, Numero, Pagina, Tabela } from "./_componentes/ui";
import { CalendarioEventos, DonutDispositivos, FunilConversao } from "./_dashboard/graficos";
import { BotaoOcultarValores } from "./_dashboard/ocultar";
import { PeriodoUrl } from "./_componentes/filtros-url";

export const metadata: Metadata = { title: `Dashboard · ${NOME_SISTEMA}` };

const FUSO = "America/Sao_Paulo";
const PROXIMAS_SESSOES_N = 5;
/** Quantas sessões de cada webinar entram no calendário do mês (31 dias × 2 por dia, com folga). */
const SESSOES_CALENDARIO_N = 62;
/** Etapas do funil do Dashboard geral (5: visitas, acessou, pitch, clicou, comprou). */
const ETAPAS_DASHBOARD = ["cadastros", "acessou_sala", "pitch", "clicou_oferta", "comprou"];

type DashboardGeral = {
  cadastros: number;
  eventos: Record<string, number>;
  porDia: { dia: string; aoVivo: number; replay: number }[];
  dispositivos: { desktop: number; mobile: number };
  paises: { pais: string; total: number }[];
  retencao: { minuto: number; visualizacoes: number }[];
  vendas: { total: number; faturamentoCentavos: number };
  tempoMedioSeg: number;
  porWebinar: { id: string; nome: string; cadastros: number; acessos: number; vendas: number; faturamentoCentavos: number }[];
};

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function paraDataInput(d: Date): string {
  return DateTime.fromJSDate(d, { zone: FUSO }).toFormat("yyyy-MM-dd");
}

const ESTILO_ALERTA = "rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro";

export default async function Inicio({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const membro = await membroAtual();
  const db = await dbUsuario();

  if (membro?.papel !== "admin") {
    return (
      <Pagina titulo="Dashboard">
        <Cartao titulo="Salas de Atendimento" icone={Users}>
          <p className="mb-4 text-sm text-texto-3">Abra a sala de um webinar para responder quem escreve no suporte.</p>
          <BotaoLink href="/atendimento">Ir para as salas</BotaoLink>
        </Cartao>
      </Pagina>
    );
  }

  const sp = await searchParams;
  const usp = new URLSearchParams();
  if (primeiro(sp.de)) usp.set("de", primeiro(sp.de));
  if (primeiro(sp.ate)) usp.set("ate", primeiro(sp.ate));

  const resultado: ResultadoPeriodo = periodoDe(usp, "mes");
  const erroPeriodo = "erro" in resultado ? resultado.erro : null;
  const { de, ate } = "erro" in resultado ? (periodoDe(new URLSearchParams(), "mes") as { de: Date; ate: Date }) : resultado;

  const [{ data: dashboardData, error: erroDashboard }, { data: webinarsAtivos }, { data: checkoutsLigados }] = await Promise.all([
    db.rpc("dashboard_geral", { p_de: de.toISOString(), p_ate: ate.toISOString() }),
    db.from("webinars").select("id, nome, slug").eq("status", "ativo").limit(1000),
    db.from("checkouts").select("plataforma").eq("ligado", true).limit(1),
  ]);

  const d = (dashboardData ?? {}) as DashboardGeral;
  const erroCarregar = erroDashboard ? "Não deu para carregar o dashboard. Tente de novo." : null;
  const funil = montarFunil(d.cadastros ?? 0, d.eventos ?? {}).filter((e) => ETAPAS_DASHBOARD.includes(e.etapa));
  const porWebinar = ordenarPorFaturamento(d.porWebinar ?? []);
  const receita = receitaPorParticipante(d.vendas?.faturamentoCentavos ?? 0, porWebinar.reduce((soma, w) => soma + w.acessos, 0));
  const semCheckout = (checkoutsLigados ?? []).length === 0;
  const notaCheckout = semCheckout ? "Conecte um checkout em Configurações para ver as vendas." : undefined;

  const webinars = (webinarsAtivos ?? []) as { id: string; nome: string; slug: string }[];
  const ids = webinars.map((w) => w.id);
  const { data: agendasData } = ids.length
    ? await db.from("agendas").select("webinar_id, fuso, inicio, fim, repeticao, dia_semana, hora_inicio, hora_fim, vigencia_fim").in("webinar_id", ids)
    : { data: [] as (LinhaAgenda & { webinar_id: string })[] };
  const agendaPorWebinar = new Map(((agendasData ?? []) as (LinhaAgenda & { webinar_id: string })[]).map((a) => [a.webinar_id, a]));

  const webinarsComAgenda: WebinarComAgenda[] = webinars
    .filter((w) => agendaPorWebinar.has(w.id))
    .map((w) => ({ id: w.id, nome: w.nome, slug: w.slug, agenda: agendaDeLinha(agendaPorWebinar.get(w.id)!) }));

  const agora = new Date();
  const proximasSessoes = proximasSessoesGerais(webinarsComAgenda, agora, PROXIMAS_SESSOES_N);

  // Calendário do mês corrente (fuso de Brasília): sessões de hoje em diante, contadas por dia.
  const agoraZ = DateTime.fromJSDate(agora, { zone: FUSO });
  const fimMes = agoraZ.endOf("month");
  const contagem: Record<number, number> = {};
  for (const w of webinarsComAgenda) {
    for (const janela of sessoesDaAgenda(w.agenda, agora, SESSOES_CALENDARIO_N)) {
      const dia = DateTime.fromJSDate(janela.inicio, { zone: FUSO });
      if (dia > fimMes) break;
      if (dia.hasSame(agoraZ, "month")) contagem[dia.day] = (contagem[dia.day] ?? 0) + 1;
    }
  }

  const deStr = paraDataInput(de);
  const ateStr = paraDataInput(DateTime.fromJSDate(ate, { zone: FUSO }).minus({ days: 1 }).toJSDate());

  return (
    <Pagina
      titulo="Dashboard geral"
      acoes={
        <>
          <BotaoOcultarValores alvo="dashboard-valores" />
          <PeriodoUrl de={deStr} ate={ateStr} alinhar="direita" />
        </>
      }
    >
      <div id="dashboard-valores" className="space-y-6 [&[data-ocultar]_.text-valor]:blur-md [&[data-ocultar]_.text-valor]:select-none [&[data-ocultar]_td]:blur-sm">
        {erroPeriodo && <p role="alert" className={ESTILO_ALERTA}>{erroPeriodo}</p>}
        {!erroPeriodo && erroCarregar && <p role="alert" className={ESTILO_ALERTA}>{erroCarregar}</p>}

        <div className="grid grid-cols-4 gap-6 max-tela-lg:grid-cols-2 max-tela-md:grid-cols-1">
          <Numero
            rotulo="Faturamento"
            valor={formatarReais(d.vendas?.faturamentoCentavos ?? 0)}
            icone={Wallet}
            ajuda="Soma das vendas confirmadas no período (sem reembolso nem cancelamento), recebidas pelos checkouts."
            nota={notaCheckout}
          />
          <Numero rotulo="Total de vendas" valor={d.vendas?.total ?? 0} icone={ShoppingCart} ajuda="Quantidade de vendas confirmadas no período." nota={notaCheckout} />
          <Numero rotulo="Receita por usuário" valor={formatarReais(receita)} icone={UserRound} ajuda="Faturamento dividido por quem acessou a sala no período." />
          <Numero rotulo="Tempo médio por sessão" valor={formatarTempoMedio(d.tempoMedioSeg ?? 0)} icone={Clock} ajuda="Quanto tempo, em média, cada participante ficou assistindo." />
        </div>

        <Cartao titulo="Funil de conversão" icone={Filter} ajuda="De quem se cadastrou até quem comprou, somando todos os webinars no período. O % é sobre os cadastros.">
          <FunilConversao etapas={funil} />
        </Cartao>

        <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-6 max-tela-slg:grid-cols-1">
          <Cartao titulo="Participantes" icone={ChartNoAxesColumn} ajuda="Participantes por dia: ao vivo (verde escuro) e replay (verde claro).">
            <GraficoPorDia porDia={d.porDia ?? []} />
          </Cartao>
          <Cartao titulo="Dispositivos" icone={MonitorSmartphone} ajuda="De onde os participantes assistiram. Celular inclui tablet.">
            <DonutDispositivos desktop={d.dispositivos?.desktop ?? 0} celular={d.dispositivos?.mobile ?? 0} />
          </Cartao>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-6 max-tela-slg:grid-cols-1">
          <Cartao titulo="Leads por Região" icone={Earth} ajuda="Participantes por país no período.">
            <ListaPaises paises={d.paises ?? []} />
          </Cartao>
          <Cartao titulo="Eventos agendados" icone={CalendarDays} ajuda="Sessões dos webinars ativos neste mês, de hoje em diante.">
            <CalendarioEventos
              titulo={agoraZ.setLocale("pt-BR").toFormat("LLLL 'de' yyyy")}
              diasNoMes={agoraZ.daysInMonth ?? 30}
              primeiroDiaSemana={agoraZ.startOf("month").weekday % 7}
              hoje={agoraZ.day}
              contagem={contagem}
            />
            <div className="mt-4 border-t border-linha pt-3">
              <p className="mb-1 text-xs font-medium text-texto-4">Próximas sessões</p>
              {proximasSessoes.length === 0 ? (
                <p className="text-sm text-texto-3">Nenhuma sessão marcada nos webinars ativos.</p>
              ) : (
                <ul className="divide-y divide-linha">
                  {proximasSessoes.map((s, i) => {
                    const fuso = agendaPorWebinar.get(s.webinarId)?.fuso ?? FUSO;
                    return (
                      <li key={`${s.webinarId}-${i}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <Link href={`/webinars/${s.webinarId}/pronto`} className="min-w-0 truncate font-medium text-texto hover:text-marca hover:underline">
                          {s.nome}
                        </Link>
                        <span className="shrink-0 text-xs text-texto-3">{formatarSessao(s.janela.inicio, fuso)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Cartao>
        </div>

        <Cartao titulo="Por webinar" icone={Table2} ajuda="Números de cada webinar no período, de quem mais faturou para quem menos faturou.">
          <Tabela semBorda colunas={["Webinar", "Cadastros", "Acessos", "Vendas", "Faturamento"]} vazio={porWebinar.length === 0 ? "Sem resultados." : undefined}>
            {porWebinar.map((w) => (
              <tr key={w.id}>
                <td className={estiloCelula}>
                  <Link href={`/webinars/${w.id}/metricas`} className="font-medium text-texto hover:text-marca hover:underline">
                    {w.nome}
                  </Link>
                </td>
                <td className={`${estiloCelula} tabular-nums`}>{w.cadastros}</td>
                <td className={`${estiloCelula} tabular-nums`}>{w.acessos}</td>
                <td className={`${estiloCelula} tabular-nums`}>{w.vendas}</td>
                <td className={`${estiloCelula} tabular-nums`}>{formatarReais(w.faturamentoCentavos)}</td>
              </tr>
            ))}
          </Tabela>
        </Cartao>
      </div>
    </Pagina>
  );
}
