"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { validarAudiencia } from "@/src/lib/regras/passos";
import { LIMITE_TARJAS, validarTarja, type DadosTarja } from "@/src/lib/regras/tarjas";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { seguirParaProximo } from "../_proximo";

/** `erroAudiencia`: erro da seção Audiência (mostrado embaixo dela, longe do topo do formulário). */
export type Resultado = { erro?: string; erroAudiencia?: string; ok?: boolean; valores?: Record<string, string> };

export async function salvarVideoWebinar(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const videoId = String(form.get("video_id") ?? "").trim();
  const autoplay = form.get("autoplay") === "on";
  const telaCheia = form.get("tela_cheia") === "on";
  const orientacao = String(form.get("orientacao") ?? "horizontal");
  // Campos da seção Audiência (atributo `form` apontando pra este formulário). Sem `modo` (ex.: formulário antigo),
  // a audiência fica como está.
  const comAudiencia = form.has("modo");
  const camposAudiencia: Record<string, string> = comAudiencia
    ? { modo: String(form.get("modo") ?? ""), minimo: String(form.get("minimo") ?? ""), maximo: String(form.get("maximo") ?? ""), selo_ao_vivo: form.get("selo_ao_vivo") === "on" ? "on" : "" }
    : {};
  const valores: Record<string, string> = { video_id: videoId, autoplay: autoplay ? "on" : "", tela_cheia: telaCheia ? "on" : "", orientacao, ...camposAudiencia };

  if (orientacao !== "horizontal" && orientacao !== "vertical") {
    return { erro: "Escolha o formato do vídeo.", valores };
  }

  const db = await dbUsuario();
  const { data: video } = await db.from("videos").select("status").eq("id", videoId).maybeSingle();
  if (!video || (video as { status: string }).status !== "pronto") {
    return { erro: "Escolha um vídeo pronto.", valores };
  }

  // Valida a audiência antes de gravar qualquer coisa (nada salvo pela metade).
  const audiencia = comAudiencia ? validarAudiencia(camposAudiencia) : null;
  if (audiencia && "erro" in audiencia) return { erroAudiencia: audiencia.erro, valores };

  const { data: atual } = await db
    .from("webinar_video")
    .select("video_id, autoplay, tela_cheia, orientacao")
    .eq("webinar_id", webinarId)
    .maybeSingle();

  const depois = { webinar_id: webinarId, video_id: videoId, autoplay, tela_cheia: telaCheia, orientacao };
  const { error } = await db.from("webinar_video").upsert(depois, { onConflict: "webinar_id" });
  if (error) return { erro: "Não deu para salvar o vídeo.", valores };

  if (audiencia) {
    const d = audiencia.dados;
    const { data: audienciaAtual } = await db.from("audiencias").select("modo, minimo, maximo, selo_ao_vivo").eq("webinar_id", webinarId).maybeSingle();
    const audienciaDepois = { webinar_id: webinarId, modo: d.modo, minimo: d.minimo, maximo: d.maximo, selo_ao_vivo: d.seloAoVivo };
    const { error: erroAudiencia } = await db.from("audiencias").upsert(audienciaDepois, { onConflict: "webinar_id" });
    if (erroAudiencia) return { erroAudiencia: "Não deu para salvar a audiência.", valores };
    const a = audienciaAtual as { modo: string; minimo: number | null; maximo: number | null; selo_ao_vivo: boolean } | null;
    const mudou = !a || a.modo !== d.modo || a.minimo !== d.minimo || a.maximo !== d.maximo || a.selo_ao_vivo !== d.seloAoVivo;
    if (mudou) await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: "Editou a audiência", antes: audienciaAtual, depois: audienciaDepois });
  }

  revalidatePath(`/webinars/${webinarId}/video`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: "Editou o vídeo do webinar", antes: atual, depois });
  seguirParaProximo(form, webinarId);
  return { ok: true, valores };
}

// ---------------------------------------------------------------------------------------------------------------
// Tarjas de aviso: cada ação salva na hora (não depende do "Continuar" do passo).
// ---------------------------------------------------------------------------------------------------------------

type DB = Awaited<ReturnType<typeof dbUsuario>>;

const CAMPOS_TARJA = "texto, aparece_seg, duracao_seg, posicao, cor, ligada";

function camposDoForm(form: FormData): Record<string, string> {
  return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]));
}

/** Duração do vídeo escolhido no passo (null sem vídeo ou sem duração conhecida). */
async function duracaoDoVideo(db: DB, webinarId: string): Promise<number | null> {
  const { data: wv } = await db.from("webinar_video").select("video_id").eq("webinar_id", webinarId).maybeSingle();
  const videoId = (wv as { video_id: string } | null)?.video_id;
  if (!videoId) return null;
  const { data: v } = await db.from("videos").select("duracao_seg").eq("id", videoId).maybeSingle();
  return (v as { duracao_seg: number | null } | null)?.duracao_seg ?? null;
}

function linhaDaTarja(d: DadosTarja) {
  return { texto: d.texto, aparece_seg: d.apareceSeg, duracao_seg: d.duracaoSeg, posicao: d.posicao, cor: d.cor, ligada: d.ligada };
}

export async function adicionarTarja(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = camposDoForm(form);
  const db = await dbUsuario();

  const r = validarTarja(campos, await duracaoDoVideo(db, webinarId));
  if ("erro" in r) return { erro: r.erro, valores: campos };

  const { count, error: erroContagem } = await db.from("tarjas_aviso").select("id", { count: "exact", head: true }).eq("webinar_id", webinarId);
  if (erroContagem) return { erro: "Não deu para adicionar a tarja.", valores: campos };
  if ((count ?? 0) >= LIMITE_TARJAS) return { erro: `Cada webinar pode ter até ${LIMITE_TARJAS} tarjas.`, valores: campos };

  const depois = { webinar_id: webinarId, ...linhaDaTarja(r.dados) };
  const { error } = await db.from("tarjas_aviso").insert(depois);
  if (error) return { erro: "Não deu para adicionar a tarja.", valores: campos };

  revalidatePath(`/webinars/${webinarId}/video`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "criou", descricao: `Adicionou a tarja de aviso "${r.dados.texto}"`, depois });
  return { ok: true };
}

export async function editarTarja(webinarId: string, tarjaId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = camposDoForm(form);
  const db = await dbUsuario();

  const r = validarTarja(campos, await duracaoDoVideo(db, webinarId));
  if ("erro" in r) return { erro: r.erro, valores: campos };

  const { data: antes } = await db.from("tarjas_aviso").select(CAMPOS_TARJA).eq("id", tarjaId).eq("webinar_id", webinarId).maybeSingle();
  if (!antes) return { erro: "Essa tarja não existe mais.", valores: campos };

  const depois = linhaDaTarja(r.dados);
  const { error } = await db.from("tarjas_aviso").update(depois).eq("id", tarjaId).eq("webinar_id", webinarId);
  if (error) return { erro: "Não deu para salvar a tarja.", valores: campos };

  revalidatePath(`/webinars/${webinarId}/video`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: `Editou a tarja de aviso "${r.dados.texto}"`, antes, depois });
  return { ok: true };
}

/** Liga/desliga. `ligada` no form é o estado atual ("1" ligada): grava o contrário. */
export async function alternarTarja(webinarId: string, form: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const ligada = form.get("ligada") === "1";

  const db = await dbUsuario();
  const { data } = await db.from("tarjas_aviso").select("texto").eq("id", id).eq("webinar_id", webinarId).maybeSingle();
  if (!data) return;
  const { error } = await db.from("tarjas_aviso").update({ ligada: !ligada }).eq("id", id).eq("webinar_id", webinarId);
  if (error) return;

  revalidatePath(`/webinars/${webinarId}/video`);
  await registrarAuditoria({
    usuarioId: eu.id,
    webinarId,
    acao: "editou",
    descricao: `${ligada ? "Desligou" : "Ligou"} a tarja de aviso "${(data as { texto: string }).texto}"`,
    antes: { ligada },
    depois: { ligada: !ligada },
  });
}

export async function excluirTarja(webinarId: string, form: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const id = String(form.get("id") ?? "");
  if (!id) return;

  const db = await dbUsuario();
  const { data: antes } = await db.from("tarjas_aviso").select(CAMPOS_TARJA).eq("id", id).eq("webinar_id", webinarId).maybeSingle();
  if (!antes) return;
  const { error } = await db.from("tarjas_aviso").delete().eq("id", id).eq("webinar_id", webinarId);
  if (error) return;

  revalidatePath(`/webinars/${webinarId}/video`);
  await registrarAuditoria({
    usuarioId: eu.id,
    webinarId,
    acao: "excluiu",
    descricao: `Excluiu a tarja de aviso "${(antes as { texto: string }).texto}"`,
    antes,
  });
}
