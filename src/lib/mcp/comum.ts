import "server-only";
import { registrarAuditoria, type AcaoAuditoria } from "../auditoria";
import { env } from "../env";
import type { ChaveAutenticada } from "./auth";

/** Peças comuns das ferramentas do MCP. Cada ferramenta reaproveita as MESMAS validações do painel
 *  (`src/lib/regras/*`) e grava com a service role, deixando a alteração no Histórico de ações. */

export type ResultadoFerramenta = { content: { type: "text"; text: string }[]; isError?: boolean };

export type Ferramenta = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  /** Altera alguma coisa (configuração, mensagem pra participante): exige chave com permissão `escrita`. */
  escrita: boolean;
  executar: (chave: ChaveAutenticada, args: Record<string, unknown>) => Promise<ResultadoFerramenta>;
};

export const SEM_PERMISSAO_ESCRITA = "Esta chave só tem permissão de leitura.";

export const texto = (dados: unknown): ResultadoFerramenta => ({ content: [{ type: "text", text: JSON.stringify(dados, null, 2) }] });
export const erro = (mensagem: string): ResultadoFerramenta => ({ content: [{ type: "text", text: mensagem }], isError: true });

export const UUID = { type: "string", format: "uuid" } as const;
export const WEBINAR = { type: "string", format: "uuid", description: "Id do webinar (veja listar_webinars)." } as const;
export const PERIODO = {
  de: { type: "string", description: "Data inicial AAAA-MM-DD (horário de Brasília). Sem de/até: últimos 7 dias." },
  ate: { type: "string", description: "Data final AAAA-MM-DD, inclusive (horário de Brasília)." },
} as const;

export const SO_LEITURA = { readOnlyHint: true, openWorldHint: false } as const;
export const ALTERA = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
export const CRIA = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
export const APAGA = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Argumentos do MCP → campos de formulário (`Record<string, string>`), do jeito que os validadores do painel
 *  (`validarOferta`, `validarAgente`…) esperam: booleano vira "on"/"" (checkbox), número vira texto, nulo some. */
export function camposDeArgs(args: Record<string, unknown>, ignorar: string[] = []): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) {
    if (ignorar.includes(k) || v === undefined || v === null) continue;
    if (typeof v === "boolean") {
      if (v) campos[k] = "on";
    } else if (typeof v === "string" || typeof v === "number") campos[k] = String(v);
  }
  return campos;
}

/** Grava a alteração no Histórico de ações no nome de quem criou a chave, com "(MCP)" na descrição. */
export async function auditar(
  chave: ChaveAutenticada,
  p: { webinarId?: string | null; acao: AcaoAuditoria; descricao: string; antes?: Record<string, unknown> | null; depois?: Record<string, unknown> | null },
): Promise<void> {
  if (!chave.usuarioId) return;
  await registrarAuditoria({ usuarioId: chave.usuarioId, ...p, descricao: `${p.descricao} (MCP)` });
}

/** Link do passo do webinar no painel, pra quem quiser conferir lá. */
export const linkPainel = (caminho: string) => `${env("NEXT_PUBLIC_PAINEL_URL").replace(/\/$/, "")}${caminho}`;
export const linkSala = (caminho: string) => `${env("NEXT_PUBLIC_SALA_URL").replace(/\/$/, "")}${caminho}`;

/** Inteiro entre `min` e `max` (padrão quando ausente ou inválido). */
export function inteiro(v: unknown, padrao: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
}
