import { redirect } from "next/navigation";

/** As integrações saíram do assistente do webinar e foram pra Configurações (endereço antigo continua valendo). */
export default async function IntegracoesAntigo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/configuracoes/integracoes/${id}`);
}
