import { redirect } from "next/navigation";

/** O chatbot por palavra-chave foi descontinuado: quem responde na sala é só o agente de IA. */
export default async function ChatbotAntigo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/webinars/${id}/agente`);
}
