/** Como conectar o MCP do Vórtex Webinar em cada Claude (Configurações → Integrações → MCP). Puro: o painel mostra o
 *  texto com a chave recém-criada (ou `CHAVE_EXEMPLO` no lugar dela, antes de criar). */

export const CHAVE_EXEMPLO = "vw_SUA_CHAVE";

export type ClienteMcp = "claude_code" | "claude_desktop" | "outro";

export const CLIENTES_MCP: { valor: ClienteMcp; rotulo: string; passo: string }[] = [
  { valor: "claude_code", rotulo: "Claude Code", passo: "Cole no Terminal e abra uma sessão nova do Claude Code." },
  {
    valor: "claude_desktop",
    rotulo: "Claude Desktop",
    passo: "No app Claude: Configurações → Desenvolvedor → Editar configuração. Junte este trecho em \"mcpServers\" do arquivo claude_desktop_config.json e reinicie o app (precisa do Node instalado).",
  },
  { valor: "outro", rotulo: "Outro cliente MCP", passo: "Qualquer cliente que aceite servidor MCP remoto (HTTP) com cabeçalho de autorização." },
];

/** Texto pronto pra copiar de cada cliente. */
export function instrucaoConexao(cliente: ClienteMcp, urlMcp: string, chave: string): string {
  if (cliente === "claude_code") return `claude mcp add --scope user --transport http vortex-webinar ${urlMcp} --header "Authorization: Bearer ${chave}"`;
  if (cliente === "claude_desktop") {
    // O Claude Desktop só abre servidor local: o `mcp-remote` faz a ponte pro endereço HTTP. A chave vai numa
    // variável (`AUTH`) porque o app quebra argumento com espaço.
    return JSON.stringify(
      { mcpServers: { "vortex-webinar": { command: "npx", args: ["-y", "mcp-remote", urlMcp, "--header", "Authorization:${AUTH}"], env: { AUTH: `Bearer ${chave}` } } } },
      null,
      2,
    );
  }
  return `Endereço (Streamable HTTP): ${urlMcp}\nCabeçalho: Authorization: Bearer ${chave}`;
}
