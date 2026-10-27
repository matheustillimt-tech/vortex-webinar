import { afterEach, describe, expect, it, vi } from "vitest";
import { completarJson } from "@/src/lib/ia/openrouter";
import { transcrever } from "@/src/lib/ia/elevenlabs";

const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

describe("completarJson (OpenRouter)", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_PAINEL_URL;
  });

  it("manda os headers certos e devolve o JSON já parseado", async () => {
    process.env.NEXT_PUBLIC_PAINEL_URL = "https://painel.exemplo.com";
    const f = vi.fn(async () => resposta({ choices: [{ message: { content: '{"mensagens":[]}' } }] }));
    const cfg = { openrouterKey: "chave-or", modelo: "openrouter/modelo-x" };

    const d = await completarJson({ sistema: "sis", usuario: "usu", maxTokens: 500, temperatura: 0.8 }, cfg, f as unknown as typeof fetch);

    expect(d).toEqual({ mensagens: [] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer chave-or");
    expect(headers["HTTP-Referer"]).toBe("https://painel.exemplo.com");
    expect(headers["X-Title"]).toBe("Vórtex Webinar");
    const corpo = JSON.parse(String(init.body));
    expect(corpo.model).toBe("openrouter/modelo-x");
    expect(corpo.response_format).toEqual({ type: "json_object" });
    expect(corpo.messages).toEqual([
      { role: "system", content: "sis" },
      { role: "user", content: "usu" },
    ]);
  });

  it("erro HTTP vira 'A IA não respondeu.' sem vazar a chave", async () => {
    process.env.NEXT_PUBLIC_PAINEL_URL = "https://painel.exemplo.com";
    const f = vi.fn(async () => resposta({ error: "unauthorized" }, 401));
    const e = await completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "chave-secreta", modelo: "m" }, f as unknown as typeof fetch).catch(
      (x: Error) => x,
    );
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe("A IA não respondeu.");
    expect((e as Error).message).not.toContain("chave-secreta");
  });

  it("conteúdo com cerca ```json ao redor: pega o JSON mesmo assim", async () => {
    process.env.NEXT_PUBLIC_PAINEL_URL = "https://painel.exemplo.com";
    const f = vi.fn(async () => resposta({ choices: [{ message: { content: '```json\n{"mensagens":[1,2]}\n```' } }] }));
    const d = await completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "k", modelo: "m" }, f as unknown as typeof fetch);
    expect(d).toEqual({ mensagens: [1, 2] });
  });

  it("conteúdo com texto solto antes do JSON: pega só o primeiro {...} balanceado", async () => {
    process.env.NEXT_PUBLIC_PAINEL_URL = "https://painel.exemplo.com";
    const f = vi.fn(async () =>
      resposta({ choices: [{ message: { content: 'Aqui está: {"responder":true,"resposta":"oi {entre chaves}"} — pronto.' } }] }),
    );
    const d = await completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "k", modelo: "m" }, f as unknown as typeof fetch);
    expect(d).toEqual({ responder: true, resposta: "oi {entre chaves}" });
  });

  it("JSON inválido no conteúdo da resposta vira o mesmo erro amigável", async () => {
    process.env.NEXT_PUBLIC_PAINEL_URL = "https://painel.exemplo.com";
    const f = vi.fn(async () => resposta({ choices: [{ message: { content: "isso não é json" } }] }));
    const e = await completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "k", modelo: "m" }, f as unknown as typeof fetch).catch(
      (x: Error) => x,
    );
    expect((e as Error).message).toBe("A IA não respondeu.");
  });

  it("timeout (fetch rejeitado por abort) também vira o erro amigável", async () => {
    process.env.NEXT_PUBLIC_PAINEL_URL = "https://painel.exemplo.com";
    const f = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const e = await completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "k", modelo: "m" }, f as unknown as typeof fetch).catch(
      (x: Error) => x,
    );
    expect((e as Error).message).toBe("A IA não respondeu.");
  });
  it("modelo principal falha (HTTP, JSON inválido) → tenta o reserva, na ordem da lista", async () => {
    process.env.NEXT_PUBLIC_PAINEL_URL = "https://painel.exemplo.com";
    const f = vi
      .fn()
      .mockResolvedValueOnce(resposta({ erro: "x" }, 502))
      .mockResolvedValueOnce(resposta({ choices: [{ message: { content: "não é json" } }] }))
      .mockResolvedValueOnce(resposta({ choices: [{ message: { content: '{"responder":true}' } }] }));
    const d = await completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "k", modelo: "a/um, b/dois ,c/tres" }, f as unknown as typeof fetch);
    expect(d).toEqual({ responder: true });
    expect(f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).model)).toEqual(["a/um", "b/dois", "c/tres"]);
  });

  it("principal deu certo → não chama o reserva; todos falham → erro amigável", async () => {
    process.env.NEXT_PUBLIC_PAINEL_URL = "https://painel.exemplo.com";
    const ok = vi.fn(async () => resposta({ choices: [{ message: { content: "{}" } }] }));
    await completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "k", modelo: "a,b" }, ok as unknown as typeof fetch);
    expect(ok).toHaveBeenCalledTimes(1);
    const falha = vi.fn(async () => resposta({}, 500));
    await expect(completarJson({ sistema: "s", usuario: "u" }, { openrouterKey: "k", modelo: "a,b" }, falha as unknown as typeof fetch)).rejects.toThrow("A IA não respondeu.");
    expect(falha).toHaveBeenCalledTimes(2);
  });
});

describe("transcrever (ElevenLabs Scribe)", () => {
  it("manda o multipart certo e devolve só as palavras com início/fim", async () => {
    const f = vi.fn(async () =>
      resposta({
        words: [
          { type: "word", text: "Olá", start: 0, end: 0.4 },
          { type: "spacing", text: " ", start: 0.4, end: 0.5 },
          { type: "word", text: "mundo", start: 0.5, end: 1.1 },
        ],
      }),
    );

    const d = await transcrever("https://cdn.exemplo.com/g1/original", "pt", { elevenlabsKey: "chave-el" }, f as unknown as typeof fetch);

    expect(d.palavras).toEqual([
      { texto: "Olá", inicio: 0, fim: 0.4 },
      { texto: "mundo", inicio: 0.5, fim: 1.1 },
    ]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("chave-el");
    const corpo = init.body as FormData;
    expect(corpo.get("model_id")).toBe("scribe_v1");
    expect(corpo.get("cloud_storage_url")).toBe("https://cdn.exemplo.com/g1/original");
    expect(corpo.get("language_code")).toBe("pt");
    expect(corpo.get("timestamps_granularity")).toBe("word");
  });

  it("erro HTTP vira erro amigável sem vazar a chave", async () => {
    const f = vi.fn(async () => resposta({ detail: "forbidden" }, 403));
    const e = await transcrever("https://x.mp4", "pt", { elevenlabsKey: "chave-secreta" }, f as unknown as typeof fetch).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).not.toContain("chave-secreta");
  });

  it("timeout (fetch rejeitado por abort) vira erro amigável", async () => {
    const f = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const e = await transcrever("https://x.mp4", "pt", { elevenlabsKey: "k" }, f as unknown as typeof fetch).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
  });
});
