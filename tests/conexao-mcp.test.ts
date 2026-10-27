import { describe, expect, it } from "vitest";
import { instrucaoConexao } from "@/src/lib/regras/conexao-mcp";

const URL_MCP = "https://painel.x.com/api/mcp";

describe("instrucaoConexao", () => {
  it("Claude Code: comando claude mcp add com a chave no cabeçalho", () => {
    expect(instrucaoConexao("claude_code", URL_MCP, "vw_abc")).toBe(
      'claude mcp add --scope user --transport http vortex-webinar https://painel.x.com/api/mcp --header "Authorization: Bearer vw_abc"',
    );
  });

  it("Claude Desktop: JSON válido com mcp-remote e a chave numa variável (sem espaço no argumento)", () => {
    const cfg = JSON.parse(instrucaoConexao("claude_desktop", URL_MCP, "vw_abc"));
    const s = cfg.mcpServers["vortex-webinar"];
    expect(s.command).toBe("npx");
    expect(s.args).toEqual(["-y", "mcp-remote", URL_MCP, "--header", "Authorization:${AUTH}"]);
    expect(s.env).toEqual({ AUTH: "Bearer vw_abc" });
  });

  it("outro cliente: endereço e cabeçalho", () => {
    expect(instrucaoConexao("outro", URL_MCP, "vw_abc")).toContain("Authorization: Bearer vw_abc");
  });
});
