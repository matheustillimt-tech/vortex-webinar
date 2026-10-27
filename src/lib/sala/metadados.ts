import type { Metadata } from "next";
import type { Sala } from "./dados";

/** Open Graph da sala pública (link de WhatsApp/redes): título e descrição da prévia configurada em
 *  Integrações → Compartilhamento, com o título do webinar como padrão quando não configurado. Sem imagem
 *  configurada, não manda `og:image` (nunca inventa uma). Nunca inclui nada privado — só esses três campos. */
export function metadadosCompartilhamento(sala: Sala): Metadata {
  const titulo = sala.webinar.compartilharTitulo || sala.webinar.titulo || "Aula";
  const descricao = sala.webinar.compartilharDescricao || undefined;
  const imagem = sala.webinar.compartilharImagemUrl || undefined;

  return {
    title: titulo,
    description: descricao,
    openGraph: {
      title: titulo,
      description: descricao,
      images: imagem ? [{ url: imagem, width: 1200, height: 630 }] : undefined,
    },
  };
}
