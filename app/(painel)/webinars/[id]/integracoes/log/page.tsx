import { redirect } from "next/navigation";

/** Endereço antigo dos logs de integrações (agora em Configurações). */
export default async function LogIntegracoesAntigo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/configuracoes/integracoes/${id}/log`);
}
