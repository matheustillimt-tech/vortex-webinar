import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartLine, CircleAlert, CircleCheck, Globe, History, Zap } from "lucide-react";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { estiloBotao } from "../../../_componentes/ui";
import { linksDaSala } from "@/src/lib/regras/links-sala";
import { CaixaLink } from "../../../_componentes/copiar";
import { TelaPasso, TituloSecao } from "../_passos";
import { tokenTeste } from "@/src/lib/sala/sessao";
import { agendaConfigurada } from "@/src/lib/regras/jit-painel";

export const metadata: Metadata = { title: `Pronto para divulgar · ${NOME_SISTEMA}` };

export default async function ProntoWebinar({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();

  const { data: webinar } = await db.from("webinars").select("id, nome, slug, tipo_agenda").eq("id", id).maybeSingle();
  if (!webinar) notFound();

  const [{ data: agenda }, { data: video }, { data: telaLogin }, { data: oferta }, { count: horariosJit }] = await Promise.all([
    db.from("agendas").select("inicio, hora_inicio").eq("webinar_id", id).maybeSingle(),
    db.from("webinar_video").select("video_id").eq("webinar_id", id).maybeSingle(),
    db.from("telas_login").select("id").eq("webinar_id", id).maybeSingle(),
    db.from("ofertas").select("ligada").eq("webinar_id", id).maybeSingle(),
    db.from("jit_horarios").select("id", { count: "exact", head: true }).eq("webinar_id", id),
  ]);

  const agendaLinha = agenda as { inicio: string | null; hora_inicio: string | null } | null;
  const jit = webinar.tipo_agenda === "jit";
  const agendaSalva = agendaConfigurada({
    tipoAgenda: webinar.tipo_agenda as string,
    inicio: agendaLinha?.inicio ?? null,
    horaInicio: agendaLinha?.hora_inicio ?? null,
    horariosJit: horariosJit ?? 0,
  });
  const temVideo = video !== null;
  const temTelaLoginPersonalizada = telaLogin !== null;
  const ofertaLinha = oferta as { ligada: boolean } | null;
  const temOferta = ofertaLinha !== null && ofertaLinha.ligada;

  const salaUrl = (process.env.NEXT_PUBLIC_SALA_URL ?? "").replace(/\/+$/, "");
  const base = `${salaUrl}/${webinar.slug}`;

  const teste = tokenTeste(id, new Date());

  const links = [
    ...linksDaSala(salaUrl, webinar.slug as string, jit),
    { rotulo: "Sala teste", url: `${base}?teste=${teste}`, descricao: "Abre com os controles do vídeo liberados e sem contar métricas. Abre a tela de login em modo teste: preencha nome e telefone pra testar os webhooks com dados (ou clique em \"Entrar sem preencher\"). Os webhooks da oferta (viu e clicou) disparam. Vale por 24 horas." },
  ];

  const pendencias = [
    !agendaSalva &&
      (jit
        ? { texto: "Nenhum horário do just in time", href: `/webinars/${id}/agenda/jit` }
        : { texto: "Nenhuma agenda salva", href: `/webinars/${id}/agenda` }),
    !temVideo && { texto: "Nenhum vídeo escolhido", href: `/webinars/${id}/video` },
    !temTelaLoginPersonalizada && { texto: "Tela de login padrão (ainda não personalizada)", href: `/webinars/${id}/login` },
    !temOferta && { texto: "Nenhuma oferta ligada", href: `/webinars/${id}/oferta` },
  ].filter((p): p is { texto: string; href: string } => Boolean(p));

  return (
    <TelaPasso webinarId={id} nome={webinar.nome} atual="pronto">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 tela-slg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-6">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold text-titulo">
              <Zap size={24} aria-hidden className="text-marca" /> Seu webinar está vivo!
            </h2>
            <p className="mt-1 text-sm text-texto-3">Copie os links abaixo para divulgar. Quem entrar pelo link da sala cai na tela de login e depois no webinar.</p>
          </div>
          <div className="space-y-5">
            {links.map((l) => (
              <CaixaLink key={l.rotulo} link={l} />
            ))}
          </div>
        </section>

        <aside className="min-w-0 space-y-6">
          <section className="rounded-lg border border-borda p-4">
            <TituloSecao titulo="Agora" />
            <div className="flex flex-col gap-2">
              <Link href={`/webinars/${id}/ao-vivo`} className={`${estiloBotao("secundario")} justify-start`}>
                <Globe aria-hidden /> Métricas em tempo real
              </Link>
              <Link href={`/webinars/${id}/metricas`} className={`${estiloBotao("secundario")} justify-start`}>
                <ChartLine aria-hidden /> Métricas
              </Link>
              <Link href={`/webinars/${id}/historico`} className={`${estiloBotao("secundario")} justify-start`}>
                <History aria-hidden /> Histórico de ações
              </Link>
            </div>
          </section>

          <section className="rounded-lg border border-borda p-4">
            <TituloSecao titulo="O que falta" />
            {pendencias.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-ok">
                <CircleCheck size={16} aria-hidden /> Tudo configurado.
              </p>
            ) : (
              <ul className="space-y-2">
                {pendencias.map((p) => (
                  <li key={p.texto} className="flex items-start gap-2 text-sm text-texto-2">
                    <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-aviso" />
                    <span>
                      {p.texto} ·{" "}
                      <Link href={p.href} className="font-medium text-marca hover:underline">
                        resolver
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </TelaPasso>
  );
}
