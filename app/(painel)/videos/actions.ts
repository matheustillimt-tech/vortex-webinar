"use server";
import { excluirVideoBunny, renomearVideoBunny, criarVideoBunny, assinaturaTus } from "@/src/lib/bunny/cliente";
import { bunnyConfig } from "@/src/lib/env";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { lerDuracao, validarUrlVideo } from "@/src/lib/regras/video";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { atualizarDoBunny, duracaoExterna } from "@/src/lib/videos";

const SEIS_HORAS_EM_SEGUNDOS = 6 * 3600;
const ERRO_BUNNY = "O Bunny não respondeu. Tente de novo.";

export async function iniciarEnvio(
  nomeBruto: string,
  bytes: number,
): Promise<{ erro: string } | { videoId: string; tus: ReturnType<typeof assinaturaTus> }> {
  const eu = await exigirAdmin();
  const nome = nomeBruto.trim();
  if (!nome) return { erro: "Dê um nome ao vídeo." };
  // Sem teto de tamanho: o envio é TUS direto pro Bunny (retoma se cair), que aceita arquivo grande.
  if (!Number.isFinite(bytes) || bytes <= 0) return { erro: "Arquivo de vídeo inválido." };

  const cfg = bunnyConfig();
  if (!cfg) return { erro: "Envio de vídeo desligado: configure o Bunny Stream." };

  let guid: string;
  try {
    ({ guid } = await criarVideoBunny(cfg, nome));
  } catch {
    return { erro: ERRO_BUNNY };
  }

  const db = await dbUsuario();
  const { data, error } = await db
    .from("videos")
    .insert({ origem: "bunny", status: "enviando", nome, nome_original: nome, bytes, bunny_guid: guid })
    .select("id")
    .single();
  if (error || !data) {
    try {
      await excluirVideoBunny(cfg, guid);
    } catch {
      // Órfão no Bunny é recuperável; o que importa é não deixar a pessoa sem poder tentar de novo.
    }
    return { erro: "Não deu para registrar o vídeo." };
  }

  const videoId = (data as { id: string }).id;
  await registrarAuditoria({ usuarioId: eu.id, acao: "criou", descricao: `Começou o envio do vídeo "${nome}"` });

  const expiraEm = Math.floor(Date.now() / 1000) + SEIS_HORAS_EM_SEGUNDOS;
  return { videoId, tus: assinaturaTus(cfg, guid, expiraEm) };
}

/** Chamado pelo navegador quando o envio via TUS termina. */
export async function marcarEnviado(videoId: string): Promise<{ erro?: string }> {
  await exigirAdmin();
  try {
    await atualizarDoBunny(videoId);
    return {};
  } catch {
    return { erro: ERRO_BUNNY };
  }
}

export async function atualizarStatus(videoId: string): Promise<{ erro?: string }> {
  await exigirAdmin();
  try {
    await atualizarDoBunny(videoId);
    return {};
  } catch {
    return { erro: "Não deu para atualizar o vídeo." };
  }
}

export type ResultadoExterno = { erro?: string; ok?: boolean; valores?: Record<string, string> };

export async function adicionarExterno(_prev: ResultadoExterno, form: FormData): Promise<ResultadoExterno> {
  const eu = await exigirAdmin();
  const nome = String(form.get("nome") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  const duracaoDigitada = String(form.get("duracao") ?? "").trim();
  const valores = { nome, url, duracao: duracaoDigitada };

  if (!nome) return { erro: "Dê um nome ao vídeo.", valores };

  const validado = validarUrlVideo(url);
  if ("erro" in validado) return { erro: validado.erro, valores };

  let duracaoSeg: number | null;
  if (validado.tipo === "hls") {
    duracaoSeg = await duracaoExterna(url, "hls");
    if (!duracaoSeg) duracaoSeg = duracaoDigitada ? lerDuracao(duracaoDigitada) : null;
    if (!duracaoSeg) return { erro: "Não deu para ler a duração do link. Informe a duração (hh:mm:ss).", valores };
  } else {
    duracaoSeg = lerDuracao(duracaoDigitada);
    if (!duracaoSeg) return { erro: "Informe a duração do vídeo (hh:mm:ss).", valores };
  }

  const db = await dbUsuario();
  const { error } = await db
    .from("videos")
    .insert({ origem: "externo", status: "pronto", nome, nome_original: nome, hls_url: url, duracao_seg: duracaoSeg });
  if (error) return { erro: "Não deu para adicionar o vídeo.", valores };

  await registrarAuditoria({ usuarioId: eu.id, acao: "criou", descricao: `Adicionou o vídeo "${nome}"` });
  return { ok: true };
}

export async function renomearVideo(videoId: string, nomeBruto: string): Promise<{ erro?: string }> {
  const eu = await exigirAdmin();
  const nome = nomeBruto.trim();
  if (!nome) return { erro: "Dê um nome ao vídeo." };

  const db = await dbUsuario();
  const { data: video } = await db.from("videos").select("nome, origem, bunny_guid").eq("id", videoId).single();
  if (!video) return { erro: "Vídeo não encontrado." };
  const nomeAntigo = (video as { nome: string }).nome;

  const v = video as { origem: string; bunny_guid: string | null };
  if (v.origem === "bunny" && v.bunny_guid) {
    const cfg = bunnyConfig();
    if (cfg) {
      try {
        await renomearVideoBunny(cfg, v.bunny_guid, nome);
      } catch {
        return { erro: ERRO_BUNNY };
      }
    }
  }

  const { error } = await db.from("videos").update({ nome }).eq("id", videoId);
  if (error) return { erro: "Não deu para renomear o vídeo." };
  await registrarAuditoria({
    usuarioId: eu.id,
    acao: "editou",
    descricao: `Renomeou o vídeo "${nomeAntigo}" para "${nome}"`,
    antes: { nome: nomeAntigo },
    depois: { nome },
  });
  return {};
}

export async function excluirVideo(videoId: string): Promise<{ erro?: string }> {
  const eu = await exigirAdmin();
  const db = await dbUsuario();

  const { count } = await db.from("webinar_video").select("id", { count: "exact", head: true }).eq("video_id", videoId);
  if (count && count > 0) {
    return { erro: `Este vídeo está em ${count} webinar(s). Troque o vídeo deles antes de excluir.` };
  }

  const { data: video } = await db.from("videos").select("nome, origem, bunny_guid").eq("id", videoId).single();
  const v = video as { nome: string; origem: string; bunny_guid: string | null } | null;

  // Apaga o registro primeiro: uma linha apontando pra um guid já excluído no Bunny não tem conserto; um vídeo
  // órfão no Bunny (registro já apagado, exclusão lá falhou) é recuperável depois.
  const { error } = await db.from("videos").delete().eq("id", videoId);
  if (error) return { erro: "Não deu para excluir o vídeo." };

  if (v?.origem === "bunny" && v.bunny_guid) {
    const cfg = bunnyConfig();
    if (cfg) {
      try {
        await excluirVideoBunny(cfg, v.bunny_guid);
      } catch {
        // Best effort: o registro já foi removido, então isso não é um erro pra quem chamou.
      }
    }
  }

  await registrarAuditoria({ usuarioId: eu.id, acao: "excluiu", descricao: `Excluiu o vídeo "${v?.nome ?? videoId}"` });
  return {};
}
