import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alvoPublico } from "@/src/lib/regras/publico";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { estiloBotao } from "../../../_componentes/ui";
import { PreviaSala } from "../../_componentes/previa-sala";
import { FORM_PASSO, TelaPasso, TituloSecao } from "../_passos";
import { FormularioVideo } from "./formulario";
import { TarjasAviso, type ItemTarja } from "./tarjas";

export const metadata: Metadata = { title: `Vídeo · ${NOME_SISTEMA}` };

export default async function VideoWebinar({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();

  const { data: webinar } = await db.from("webinars").select("id, nome, titulo").eq("id", id).maybeSingle();
  if (!webinar) notFound();

  const [{ data: atual }, { data: videosData }, { data: mensagensData }, { data: audienciaData }, { data: tarjasData }] = await Promise.all([
    db.from("webinar_video").select("video_id, autoplay, tela_cheia, orientacao").eq("webinar_id", id).maybeSingle(),
    db.from("videos").select("id, nome, duracao_seg, thumb_url").eq("status", "pronto").order("created_at", { ascending: false }),
    db.from("mensagens_simuladas").select("id, nome, texto, suporte").eq("webinar_id", id).order("segundo", { ascending: true }).limit(4),
    db.from("audiencias").select("modo, minimo, maximo, selo_ao_vivo").eq("webinar_id", id).maybeSingle(),
    db
      .from("tarjas_aviso")
      .select("id, texto, aparece_seg, duracao_seg, posicao, cor, ligada")
      .eq("webinar_id", id)
      .order("aparece_seg", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);
  const tarjas = (tarjasData ?? []) as ItemTarja[];
  const videos = (videosData ?? []) as { id: string; nome: string; duracao_seg: number | null; thumb_url: string | null }[];
  const mensagens = (mensagensData ?? []) as { id: string; nome: string; texto: string; suporte: boolean }[];
  const audiencia = audienciaData as { modo: "oculto" | "fixo" | "dinamico"; minimo: number | null; maximo: number | null; selo_ao_vivo: boolean } | null;
  // Público do contador na prévia: o pico configurado na seção Audiência (ou um número de exemplo).
  const publico = audiencia ? alvoPublico({ modo: audiencia.modo, minimo: audiencia.minimo ?? 0, maximo: audiencia.maximo ?? 0 }, 0.25) : 152;

  const atualTipado = atual as { video_id: string; autoplay: boolean; tela_cheia: boolean; orientacao: "horizontal" | "vertical" } | null;
  const nome = webinar.nome as string;
  const titulo = (webinar.titulo as string | null) ?? nome;
  // Duração do vídeo salvo no passo: o "Aparece em" da tarja tem que cair dentro dele.
  const duracaoVideoSeg = videos.find((v) => v.id === atualTipado?.video_id)?.duracao_seg ?? null;

  return (
    <TelaPasso webinarId={id} nome={nome} atual="video" formulario={videos.length > 0 ? FORM_PASSO : undefined}>
      {videos.length === 0 ? (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 tela-slg:grid-cols-[minmax(0,1fr)_468px]">
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-borda p-8 text-center">
            <p className="text-sm font-medium text-texto">Nenhum vídeo pronto na biblioteca.</p>
            <p className="max-w-sm text-sm text-texto-3">Envie o vídeo do webinar (ou use um link) em Vídeos e volte aqui para escolher.</p>
            <Link href="/videos" className={estiloBotao("principal")}>
              Enviar novo vídeo
            </Link>
          </div>
          <div>
            <TituloSecao titulo="Prévia da sala" />
            <PreviaSala orientacao={atualTipado?.orientacao ?? "horizontal"} capa={null} mensagens={mensagens} publico={publico} titulo={titulo} />
          </div>
        </div>
      ) : (
        <FormularioVideo
          idFormulario={FORM_PASSO}
          webinarId={id}
          titulo={titulo}
          mensagens={mensagens}
          publico={publico}
          videos={videos.map((v) => ({ id: v.id, nome: v.nome, duracaoSeg: v.duracao_seg, capa: v.thumb_url }))}
          valores={{
            videoId: atualTipado?.video_id ?? "",
            autoplay: atualTipado?.autoplay ?? true,
            telaCheia: atualTipado?.tela_cheia ?? false,
            orientacao: atualTipado?.orientacao ?? "horizontal",
          }}
          depois={<TarjasAviso webinarId={id} itens={tarjas} duracaoVideoSeg={duracaoVideoSeg} />}
          duracaoVideoSeg={duracaoVideoSeg}
          // Sem linha ainda: os defaults da tabela `audiencias`.
          audiencia={{
            modo: audiencia?.modo ?? "oculto",
            minimo: audiencia?.minimo != null ? String(audiencia.minimo) : "",
            maximo: audiencia?.maximo != null ? String(audiencia.maximo) : "",
            seloAoVivo: audiencia?.selo_ao_vivo ?? true,
          }}
        />
      )}
    </TelaPasso>
  );
}

