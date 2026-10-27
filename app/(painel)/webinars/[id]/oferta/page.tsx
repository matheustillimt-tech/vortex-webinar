import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatarDuracao } from "@/src/lib/regras/video";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { FORM_PASSO, TelaPasso } from "../_passos";
import { FormularioOferta } from "./formulario";

export const metadata: Metadata = { title: `Oferta · ${NOME_SISTEMA}` };

type LinhaOferta = {
  ligada: boolean;
  nome: string;
  titulo: string;
  preco_original: string | null;
  preco_oferta: string | null;
  botao_texto: string;
  botao_cor: string;
  banner_url: string | null;
  banner_mobile_url: string | null;
  link: string | null;
  repassar_utms: boolean;
  aparece_seg: number;
  some_seg: number;
  pitch_seg: number | null;
  contagem_seg: number;
  contagem_layout: "classico" | "rotulos" | "urgente";
  sorteio_ligado: boolean;
  sorteio_seg: number | null;
  sorteio_numero: string | null;
};

// Os defaults da tabela `ofertas`, usados quando a linha ainda não existe.
const PADROES: LinhaOferta = {
  ligada: true,
  nome: "",
  titulo: "",
  preco_original: null,
  preco_oferta: null,
  botao_texto: "Quero aproveitar",
  botao_cor: "#02890b",
  banner_url: null,
  banner_mobile_url: null,
  link: null,
  repassar_utms: false,
  aparece_seg: 60,
  some_seg: 0,
  pitch_seg: null,
  contagem_seg: 300,
  contagem_layout: "classico",
  sorteio_ligado: false,
  sorteio_seg: null,
  sorteio_numero: null,
};

export default async function OfertaWebinar({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();

  const { data: webinar } = await db.from("webinars").select("id, nome, slug").eq("id", id).maybeSingle();
  if (!webinar) notFound();

  const { data: linha } = await db
    .from("ofertas")
    .select(
      "ligada, nome, titulo, preco_original, preco_oferta, botao_texto, botao_cor, banner_url, banner_mobile_url, link, repassar_utms, aparece_seg, some_seg, pitch_seg, contagem_seg, contagem_layout, sorteio_ligado, sorteio_seg, sorteio_numero",
    )
    .eq("webinar_id", id)
    .maybeSingle();
  const oferta = (linha as LinhaOferta | null) ?? PADROES;

  const { data: videoRow } = await db.from("webinar_video").select("videos(duracao_seg)").eq("webinar_id", id).maybeSingle();
  const duracaoVideoSeg = (videoRow as { videos?: { duracao_seg: number | null } | null } | null)?.videos?.duracao_seg ?? null;

  return (
    <TelaPasso webinarId={id} nome={webinar.nome} atual="oferta" formulario={FORM_PASSO}>
      <FormularioOferta
        idFormulario={FORM_PASSO}
        duracaoVideo={duracaoVideoSeg !== null ? formatarDuracao(duracaoVideoSeg) : null}
        webinarId={id}
        valores={{
          ligada: oferta.ligada,
          nome: oferta.nome,
          titulo: oferta.titulo,
          precoOriginal: oferta.preco_original ?? "",
          precoOferta: oferta.preco_oferta ?? "",
          botaoTexto: oferta.botao_texto,
          botaoCor: oferta.botao_cor,
          bannerUrl: oferta.banner_url,
          bannerMobileUrl: oferta.banner_mobile_url,
          link: oferta.link ?? "",
          repassarUtms: oferta.repassar_utms,
          aparece: formatarDuracao(oferta.aparece_seg),
          some: oferta.some_seg === 0 ? "" : formatarDuracao(oferta.some_seg),
          pitch: oferta.pitch_seg !== null ? formatarDuracao(oferta.pitch_seg) : "",
          contagem: formatarDuracao(oferta.contagem_seg),
          contagemLayout: oferta.contagem_layout,
          sorteioLigado: oferta.sorteio_ligado,
          sorteioMomento: oferta.sorteio_seg !== null ? formatarDuracao(oferta.sorteio_seg) : "",
          sorteioNumero: oferta.sorteio_numero ?? "",
        }}
      />
    </TelaPasso>
  );
}
