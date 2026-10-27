import { redirect } from "next/navigation";

/** Endereço antigo das chaves do MCP: agora é a aba MCP de Configurações → Integrações. */
export default function Mcp() {
  redirect("/configuracoes?aba=mcp");
}
