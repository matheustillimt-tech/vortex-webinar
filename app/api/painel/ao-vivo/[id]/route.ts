import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { bucketsAcessos } from "@/src/lib/regras/atendimento";
import { ehFusoValido } from "@/src/lib/regras/fuso";
import { idValido } from "@/src/lib/regras/midia";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { lerTudo } from "@/src/lib/supabase/paginar";
import { membroApi } from "@/src/lib/supabase/usuario";

const LIMITE_PONTOS = 500;
const BUCKET_MINUTOS = 10;
const JANELA_ONLINE_MS = 60_000;
const FUSO_PADRAO = "America/Sao_Paulo";
/** Sessão de teste (link do produtor) nunca entra em métrica nenhuma. */
const MODOS_REAIS = ["ao_vivo", "replay"];

type LinhaMetricas = { ao_vivo: number; replay: number; desktop: number; mobile: number };
type LinhaPonto = { lat: number; lon: number };
type LinhaEntrada = { entrou_em: string };

function erro500() {
  return NextResponse.json({ erro: "Não deu para carregar as métricas." }, { status: 500 });
}

/** `GET`: qualquer membro ativo (admin ou atendente) — 401 sem login. Números ao vivo/replay e desktop × celular
 *  (contagem real no banco, `public.metricas_ao_vivo`), até 500 pontos geográficos de sessões online
 *  (`ultimo_sinal_em` nos últimos 60 s) e a série de acessos do dia (buckets de 10 min, no fuso da agenda — fuso
 *  inválido cai no padrão). Teste nunca conta. Tudo recalculado a cada chamada — o cliente faz polling. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membro = await membroApi();
  if (!membro) return NextResponse.json({ erro: "Acesso negado." }, { status: 401 });

  const { id } = await params;
  if (!idValido(id)) return NextResponse.json({ erro: "Parâmetros inválidos." }, { status: 400 });
  const db = dbAdmin();

  const { data: agendaData, error: erroAgenda } = await db.from("agendas").select("fuso").eq("webinar_id", id).maybeSingle();
  if (erroAgenda) return erro500();
  const fusoAgenda = (agendaData as { fuso: string | null } | null)?.fuso ?? null;
  const fuso = fusoAgenda && ehFusoValido(fusoAgenda) ? fusoAgenda : FUSO_PADRAO;

  const agora = new Date();
  const desde = new Date(agora.getTime() - JANELA_ONLINE_MS).toISOString();
  const inicioDia = DateTime.fromJSDate(agora, { zone: fuso }).startOf("day").toJSDate();

  const [metricasR, pontosR, entradasR] = await Promise.all([
    db.rpc("metricas_ao_vivo", { p_webinar: id }),
    // Só pro mapa: no máximo 500 pontos (os números acima não dependem deste teto).
    db
      .from("sessoes")
      .select("lat, lon")
      .eq("webinar_id", id)
      .in("modo", MODOS_REAIS)
      .gte("ultimo_sinal_em", desde)
      .not("lat", "is", null)
      .not("lon", "is", null)
      .order("ultimo_sinal_em", { ascending: false })
      .limit(LIMITE_PONTOS),
    // Série do dia: só a coluna de entrada, paginada (pode passar de 1000 linhas num dia grande).
    lerTudo(() =>
      db
        .from("sessoes")
        .select("entrou_em, id")
        .eq("webinar_id", id)
        .in("modo", MODOS_REAIS)
        .gte("entrou_em", inicioDia.toISOString())
        .order("id", { ascending: true }),
    ),
  ]);
  if (metricasR.error || pontosR.error || entradasR.error) return erro500();

  const linhaMetricas = ((metricasR.data ?? []) as LinhaMetricas[])[0] ?? { ao_vivo: 0, replay: 0, desktop: 0, mobile: 0 };
  const pontos = ((pontosR.data ?? []) as LinhaPonto[]).map((s) => ({ lat: s.lat, lon: s.lon }));
  const entradas = (entradasR.data as LinhaEntrada[]).map((e) => new Date(e.entrou_em));
  const serie = bucketsAcessos(entradas, inicioDia, BUCKET_MINUTOS, agora);

  return NextResponse.json({
    aoVivo: linhaMetricas.ao_vivo,
    replay: linhaMetricas.replay,
    desktop: linhaMetricas.desktop,
    mobile: linhaMetricas.mobile,
    pontos,
    serie,
    fuso,
    atualizadoEm: agora.toISOString(),
  });
}
