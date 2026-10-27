import "server-only";
import type { ChaveAutenticada } from "../auth";
import { erro, SEM_PERMISSAO_ESCRITA, type Ferramenta, type ResultadoFerramenta } from "../comum";
import { FERRAMENTAS_ANALISE } from "./analise";
import { FERRAMENTAS_ATENDIMENTO } from "./atendimento";
import { FERRAMENTAS_CONTEUDO } from "./conteudo";
import { FERRAMENTAS_INTEGRACOES } from "./integracoes";
import { FERRAMENTAS_WEBINARS } from "./webinars";

/** Todas as ferramentas do MCP, na ordem em que aparecem no `tools/list`. */
export const FERRAMENTAS: Ferramenta[] = [...FERRAMENTAS_WEBINARS, ...FERRAMENTAS_CONTEUDO, ...FERRAMENTAS_INTEGRACOES, ...FERRAMENTAS_ATENDIMENTO, ...FERRAMENTAS_ANALISE];

/** Lista pública de `tools/list` (sem os campos internos). */
export function listaDeFerramentas() {
  return FERRAMENTAS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
}

export function acharFerramenta(nome: string): Ferramenta | undefined {
  return FERRAMENTAS.find((f) => f.name === nome);
}

/** Roda a ferramenta conferindo a permissão: chave de leitura numa ferramenta de escrita volta `isError`. */
export async function chamarFerramenta(f: Ferramenta, chave: ChaveAutenticada, args: Record<string, unknown>): Promise<ResultadoFerramenta> {
  if (f.escrita && chave.permissao !== "escrita") return erro(SEM_PERMISSAO_ESCRITA);
  return f.executar(chave, args);
}
