import "server-only";
import { randomUUID } from "node:crypto";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { caminhoMidia, idValido, validarImagem } from "@/src/lib/regras/midia";

/** Envia uma imagem (logo, avatar, banner, imagem de chatbot, imagem da aba Suporte/Chat) pro bucket `midias`.
 *  Quem chama já deve ter garantido que o arquivo não está vazio (arquivo vazio = "não trocou", não chama isto).
 *  `pasta` opcional muda o caminho pra `webinars/<webinarId>/<pasta>/<id>.<ext>` (ex.: "chat"). */
export async function enviarImagem(webinarId: string, arquivo: File, pasta?: string): Promise<{ url: string } | { erro: string }> {
  if (!idValido(webinarId)) return { erro: "Webinar inválido." };

  const erro = validarImagem(arquivo.type, arquivo.size);
  if (erro) return { erro };

  const caminho = caminhoMidia(webinarId, arquivo.type, randomUUID(), pasta);
  const storage = dbAdmin().storage.from("midias");
  const { error } = await storage.upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) return { erro: "Não deu para enviar a imagem." };

  const { data } = storage.getPublicUrl(caminho);
  return { url: data.publicUrl };
}
