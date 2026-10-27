import "server-only";

export type CfgElevenLabs = { elevenlabsKey: string };
export type PalavraTranscrita = { texto: string; inicio: number; fim: number };

const API = "https://api.elevenlabs.io/v1/speech-to-text";
const TIMEOUT_MS = 240_000;

/** Transcreve o áudio/vídeo em `url` com o ElevenLabs Scribe e devolve as palavras com `inicio`/`fim` em segundos
 *  (ignora qualquer item que não seja `type: "word"`, como pontuação ou espaço). Timeout de 240 s; qualquer
 *  problema (HTTP, timeout, resposta sem o formato esperado) vira o mesmo erro amigável. */
export async function transcrever(
  url: string,
  idioma: string,
  cfg: CfgElevenLabs,
  f: typeof fetch = fetch,
): Promise<{ palavras: PalavraTranscrita[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const corpo = new FormData();
    corpo.set("model_id", "scribe_v1");
    corpo.set("cloud_storage_url", url);
    corpo.set("language_code", idioma);
    corpo.set("timestamps_granularity", "word");
    const r = await f(API, { method: "POST", headers: { "xi-api-key": cfg.elevenlabsKey }, body: corpo, signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = (await r.json()) as { words?: Array<{ type: string; text: string; start: number; end: number }> };
    const palavras = (d.words ?? [])
      .filter((w) => w.type === "word")
      .map((w) => ({ texto: w.text, inicio: w.start, fim: w.end }));
    return { palavras };
  } catch {
    throw new Error("A transcrição não respondeu.");
  } finally {
    clearTimeout(timer);
  }
}
