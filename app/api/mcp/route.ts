import { metodoNaoPermitido, tratarPostMcp } from "@/src/lib/mcp/servidor";

export const dynamic = "force-dynamic";
/** Algumas ferramentas (testar o agente, gerar chat com IA) chamam o modelo: dá tempo de responder. */
export const maxDuration = 60;

/** POST /api/mcp — servidor MCP do Vórtex Webinar (Streamable HTTP sem estado, respostas JSON). */
export async function POST(req: Request) {
  return tratarPostMcp(req);
}

/** GET (SSE) e DELETE (sessão) não existem neste servidor sem estado → 405. */
export function GET() {
  return metodoNaoPermitido();
}

export function DELETE() {
  return metodoNaoPermitido();
}
