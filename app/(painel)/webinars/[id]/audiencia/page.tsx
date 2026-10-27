import { redirect } from "next/navigation";

/** A audiência agora fica no passo Vídeo (embaixo das tarjas de aviso); o endereço antigo leva pra lá. */
export default async function AudienciaAntiga({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/webinars/${id}/video`);
}
