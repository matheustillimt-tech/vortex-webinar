"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { enviarImagem } from "@/src/lib/midias";
import { validarOferta } from "@/src/lib/regras/passos";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { seguirParaProximo } from "../_proximo";

export type Resultado = { erro?: string; ok?: boolean; valores?: Record<string, string> };

export async function salvarOferta(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]),
  );

  const db = await dbUsuario();
  const { data: videoRow } = await db
    .from("webinar_video")
    .select("videos(duracao_seg)")
    .eq("webinar_id", webinarId)
    .maybeSingle();
  const duracaoVideoSeg =
    (videoRow as { videos?: { duracao_seg: number | null } | null } | null)?.videos?.duracao_seg ?? null;

  const r = validarOferta(campos, duracaoVideoSeg);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const { data: atualData } = await db
    .from("ofertas")
    .select(
      "ligada, nome, titulo, preco_original, preco_oferta, botao_texto, botao_cor, banner_url, banner_mobile_url, link, repassar_utms, aparece_seg, some_seg, pitch_seg, contagem_seg, contagem_layout, sorteio_ligado, sorteio_seg, sorteio_numero",
    )
    .eq("webinar_id", webinarId)
    .maybeSingle();
  const atual = atualData as { banner_url: string | null; banner_mobile_url: string | null } | null;

  let bannerUrl = atual?.banner_url ?? null;
  const banner = form.get("banner");
  if (banner instanceof File && banner.size > 0) {
    const envio = await enviarImagem(webinarId, banner);
    if ("erro" in envio) return { erro: envio.erro, valores: campos };
    bannerUrl = envio.url;
  }

  let bannerMobileUrl = atual?.banner_mobile_url ?? null;
  const bannerMobile = form.get("banner_mobile");
  if (bannerMobile instanceof File && bannerMobile.size > 0) {
    const envio = await enviarImagem(webinarId, bannerMobile);
    if ("erro" in envio) return { erro: envio.erro, valores: campos };
    bannerMobileUrl = envio.url;
  }

  const depois = {
    webinar_id: webinarId,
    ligada: d.ligada,
    // `nome`/`titulo` são NOT NULL: com a oferta desligada, salva vazio em vez de null.
    nome: d.nome ?? "",
    titulo: d.titulo ?? "",
    preco_original: d.precoOriginal,
    preco_oferta: d.precoOferta,
    botao_texto: d.botaoTexto ?? "Quero aproveitar",
    botao_cor: d.botaoCor,
    banner_url: bannerUrl,
    banner_mobile_url: bannerMobileUrl,
    link: d.link,
    repassar_utms: d.repassarUtms,
    aparece_seg: d.apareceSeg,
    some_seg: d.someSeg,
    pitch_seg: d.pitchSeg,
    contagem_seg: d.contagemSeg,
    contagem_layout: d.contagemLayout,
    sorteio_ligado: d.sorteioLigado,
    sorteio_seg: d.sorteioSeg,
    sorteio_numero: d.sorteioNumero,
  };

  const { error } = await db.from("ofertas").upsert(depois, { onConflict: "webinar_id" });
  if (error) return { erro: "Não deu para salvar a oferta.", valores: campos };

  revalidatePath(`/webinars/${webinarId}/oferta`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: "Editou a oferta", antes: atual, depois });
  seguirParaProximo(form, webinarId);
  return { ok: true, valores: campos };
}
