import "server-only";
import { env } from "../env";

export type CfgOpenRouter = { openrouterKey: string; modelo: string };
export type PedidoJson = { sistema: string; usuario: string; maxTokens?: number; temperatura?: number };

const API = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 30_000;
const TIMEOUT_RESERVA_MS = 20_000;

/** Modelos em ordem de preferência: `OPENROUTER_TEXT_MODEL` aceita um só ou vários separados por vírgula
 *  ("deepseek/deepseek-v4.1-flash,mistralai/mistral-small-3.2-24b-instruct"); o primeiro é o principal, os outros
 *  são reserva. */
export function modelosDe(cfg: CfgOpenRouter): string[] {
  return cfg.modelo.split(",").map((m) => m.trim()).filter(Boolean);
}

/** Pede uma resposta em JSON ao OpenRouter (Chat Completions, `response_format: json_object`) e devolve o objeto já
 *  parseado. Se o modelo principal falhar (HTTP, timeout, JSON inválido na resposta), a mesma pergunta vai pro
 *  próximo modelo da lista. Com um só modelo, o timeout é de 30 s; com reserva, 20 s por tentativa (o agente roda
 *  dentro dos 60 s da função). Nada deu certo → o mesmo erro amigável, sem detalhe da chave nem do motivo. */
export async function completarJson(pedido: PedidoJson, cfg: CfgOpenRouter, f: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const modelos = modelosDe(cfg);
  const timeout = modelos.length > 1 ? TIMEOUT_RESERVA_MS : TIMEOUT_MS;
  for (const modelo of modelos) {
    try {
      return await tentar(pedido, cfg.openrouterKey, modelo, timeout, f);
    } catch {
      // Tenta o próximo modelo da lista.
    }
  }
  throw new Error("A IA não respondeu.");
}

async function tentar(pedido: PedidoJson, chave: string, modelo: string, timeoutMs: number, f: typeof fetch): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await f(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chave}`,
        "content-type": "application/json",
        "HTTP-Referer": env("NEXT_PUBLIC_PAINEL_URL"),
        "X-Title": "Vórtex Webinar",
      },
      body: JSON.stringify({
        model: modelo,
        response_format: { type: "json_object" },
        max_tokens: pedido.maxTokens,
        temperature: pedido.temperatura,
        messages: [
          { role: "system", content: pedido.sistema },
          { role: "user", content: pedido.usuario },
        ],
      }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const conteudo = d.choices?.[0]?.message?.content;
    if (!conteudo) throw new Error("sem conteúdo");
    return extrairJson(conteudo);
  } finally {
    clearTimeout(timer);
  }
}

/** Alguns modelos devolvem o JSON com cerca ```json ... ``` ao redor, ou com um texto solto antes (mesmo pedindo
 *  `response_format: json_object`) — tenta o parse direto e, se falhar, pega só o primeiro `{...}` balanceado do
 *  texto (da primeira `{` até a `}` que fecha ela) e tenta de novo. */
function extrairJson(conteudo: string): Record<string, unknown> {
  try {
    return JSON.parse(conteudo) as Record<string, unknown>;
  } catch {
    const inicio = conteudo.indexOf("{");
    if (inicio === -1) throw new Error("sem JSON");
    let profundidade = 0;
    for (let i = inicio; i < conteudo.length; i++) {
      if (conteudo[i] === "{") profundidade++;
      else if (conteudo[i] === "}") {
        profundidade--;
        if (profundidade === 0) return JSON.parse(conteudo.slice(inicio, i + 1)) as Record<string, unknown>;
      }
    }
    throw new Error("JSON incompleto");
  }
}
