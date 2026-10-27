import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { formatarReais, formatarTempoMedio, montarFunil, periodoDe, type ResultadoPeriodo } from "@/src/lib/regras/metricas";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { ChartLine, ChartNoAxesColumn, Clock, Earth, Filter, MonitorSmartphone, Radio, ShoppingCart, UserCheck, Wallet } from "lucide-react";
import { GraficoPorDia, GraficoRetencao, ListaPaises } from "../../../_componentes/graficos";
import { BotaoLink, Cartao, Numero, Pagina } from "../../../_componentes/ui";
import { DonutDispositivos, FunilConversao } from "../../../_dashboard/graficos";
import { PeriodoUrl } from "../../../_componentes/filtros-url";
import { ExportarMetricas } from "./exportar";

export const metadata: Metadata = { title: `Métricas · ${NOME_SISTEMA}` };

const FUSO = "America/Sao_Paulo";

const ESTILO_ALERTA = "rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro";

/** Cartões de evento da coluna da direita na ordem do funil. */
const ROTULOS_EVENTOS: { tipo: string; rotulo: string }[] = [
  { tipo: "acessou_sala", rotulo: "Acessou a sala" },
  { tipo: "clicou_video", rotulo: "Clicou no vídeo" },
  { tipo: "min_15", rotulo: "Assistiu 15 min" },
  { tipo: "min_30", rotulo: "Assistiu 30 min" },
  { tipo: "min_45", rotulo: "Assistiu 45 min" },
  { tipo: "min_60", rotulo: "Assistiu 60 min" },
  { tipo: "pitch", rotulo: "Estava no pitch" },
  { tipo: "oferta", rotulo: "Estava na oferta" },
  { tipo: "clicou_oferta", rotulo: "Clicou na oferta" },
  { tipo: "mensagem_chat", rotulo: "Interagiu no chat" },
  { tipo: "mensagem_atendente", rotulo: "Mensagem ao atendente" },
  { tipo: "comprou", rotulo: "Comprou" },
];

type Metricas = {
  cadastros: number;
  eventos: Record<string, number>;
  porDia: { dia: string; aoVivo: number; replay: number }[];
  dispositivos: { desktop: number; mobile: number };
  paises: { pais: string; total: number }[];
  retencao: { minuto: number; visualizacoes: number }[];
  vendas: { total: number; faturamentoCentavos: number };
  tempoMedioSeg: number;
};

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function paraDataInput(d: Date): string {
  return DateTime.fromJSDate(d, { zone: FUSO }).toFormat("yyyy-MM-dd");
}

export default async function MetricasWebinar({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();

  const { data: webinar } = await db.from("webinars").select("id, nome, slug").eq("id", id).maybeSingle();
  if (!webinar) notFound();

  const sp = await searchParams;
  const usp = new URLSearchParams();
  if (primeiro(sp.de)) usp.set("de", primeiro(sp.de));
  if (primeiro(sp.ate)) usp.set("ate", primeiro(sp.ate));

  const resultado: ResultadoPeriodo = periodoDe(usp, "7d");
  const erroPeriodo = "erro" in resultado ? resultado.erro : null;
  // Com erro no período pedido (datas inválidas, mais de 1 ano…), mostra a tela com o padrão de 7 dias em vez de
  // quebrar — a mensagem de erro já avisa pra corrigir.
  const { de, ate } = "erro" in resultado ? (periodoDe(new URLSearchParams(), "7d") as { de: Date; ate: Date }) : resultado;

  const { data, error: erroMetricas } = await db.rpc("metricas_webinar", { p_webinar: id, p_de: de.toISOString(), p_ate: ate.toISOString() });
  const m = (data ?? {}) as Metricas;
  const erroCarregar = erroMetricas ? "Não deu para carregar as métricas. Tente de novo." : null;

  const funil = montarFunil(m.cadastros ?? 0, m.eventos ?? {});
  const deStr = paraDataInput(de);
  const ateStr = paraDataInput(DateTime.fromJSDate(ate, { zone: FUSO }).minus({ days: 1 }).toJSDate());
  const query = `de=${deStr}&ate=${ateStr}`;

  return (
    <Pagina
      titulo={webinar.nome}
      acoes={
        <>
          <ExportarMetricas webinarId={id} query={query} eventos={ROTULOS_EVENTOS} />
          <BotaoLink href={`/webinars/${id}/ao-vivo`} variante="secundario" icone={<Radio aria-hidden />}>
            Tempo real
          </BotaoLink>
          <PeriodoUrl de={deStr} ate={ateStr} alinhar="direita" />
        </>
      }
    >
      {erroPeriodo && <p role="alert" className={ESTILO_ALERTA}>{erroPeriodo}</p>}
      {!erroPeriodo && erroCarregar && <p role="alert" className={ESTILO_ALERTA}>{erroCarregar}</p>}

      <div className="grid grid-cols-4 gap-6 max-tela-lg:grid-cols-2 max-tela-md:grid-cols-1">
        <Numero rotulo="Faturamento" valor={formatarReais(m.vendas?.faturamentoCentavos ?? 0)} icone={Wallet} ajuda="Soma das vendas confirmadas deste webinar no período." />
        <Numero rotulo="Total de vendas" valor={m.vendas?.total ?? 0} icone={ShoppingCart} ajuda="Quantidade de vendas confirmadas no período." />
        <Numero rotulo="Tempo médio por sessão" valor={formatarTempoMedio(m.tempoMedioSeg ?? 0)} icone={Clock} ajuda="Quanto tempo, em média, cada participante ficou assistindo." />
        <Numero rotulo="Cadastros" valor={m.cadastros ?? 0} icone={UserCheck} ajuda="Pessoas que se inscreveram no período." />
      </div>

      <Cartao titulo="Métricas do vídeo" icone={ChartLine} ajuda="Quantas pessoas estavam assistindo em cada minuto do vídeo.">
        <GraficoRetencao retencao={m.retencao ?? []} />
      </Cartao>

      <Cartao titulo="Tráfego e conversão de página" icone={Filter} ajuda="Do cadastro até a compra. O % é sobre os cadastros.">
        <FunilConversao etapas={funil} />
      </Cartao>

      <div className="grid grid-cols-[minmax(0,1fr)_350px] gap-6 max-tela-slg:grid-cols-1">
        <div className="min-w-0 space-y-6">
          <Cartao titulo="Participantes" icone={ChartNoAxesColumn} ajuda="Participantes por dia: ao vivo (verde escuro) e replay (verde claro).">
            <GraficoPorDia porDia={m.porDia ?? []} />
          </Cartao>
          <Cartao titulo="Dispositivos" icone={MonitorSmartphone} ajuda="De onde os participantes assistiram. Celular inclui tablet.">
            <DonutDispositivos desktop={m.dispositivos?.desktop ?? 0} celular={m.dispositivos?.mobile ?? 0} />
          </Cartao>
          <Cartao titulo="Leads por Região" icone={Earth} ajuda="Participantes por país no período.">
            <ListaPaises paises={m.paises ?? []} />
          </Cartao>
        </div>
        <ul className="grid content-start gap-3 max-tela-slg:grid-cols-2 max-tela-sm:grid-cols-1" aria-label="Eventos">
          {ROTULOS_EVENTOS.map((e) => (
            <li key={e.tipo} className="flex min-h-[66px] items-center justify-between gap-3 rounded-lg border border-borda bg-superficie px-4 py-3">
              <span className="min-w-0 text-sm font-medium text-texto-2">{e.rotulo}</span>
              <span className="text-valor font-bold tabular-nums text-texto">{m.eventos?.[e.tipo] ?? 0}</span>
            </li>
          ))}
        </ul>
      </div>
    </Pagina>
  );
}
