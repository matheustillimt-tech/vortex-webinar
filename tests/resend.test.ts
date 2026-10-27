import { afterEach, describe, expect, it, vi } from "vitest";
import { enviarEmail } from "@/src/lib/email/resend";

const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const cfg = { resendKey: "re_chave_secreta", de: "aulas@exemplo.com.br" };
const msg = { de: "Vórtex <aulas@exemplo.com.br>", para: "ana@x.com", assunto: "Oi", html: "<p>Oi</p>", texto: "Oi" };

describe("enviarEmail (Resend)", () => {
  afterEach(() => vi.useRealTimers());

  it("POST na API com Bearer e o corpo certo; devolve o id", async () => {
    const f = vi.fn(async () => resposta({ id: "email-123" }));
    expect(await enviarEmail(cfg, msg, f as unknown as typeof fetch)).toEqual({ id: "email-123" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_chave_secreta");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "Vórtex <aulas@exemplo.com.br>",
      to: ["ana@x.com"],
      subject: "Oi",
      html: "<p>Oi</p>",
      text: "Oi",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("erro HTTP vira mensagem amigável com o status e o motivo do Resend, sem a chave", async () => {
    const f = vi.fn(async () => resposta({ name: "validation_error", message: "The domain is not verified. re_chave_secreta" }, 403));
    const e = (await enviarEmail(cfg, msg, f as unknown as typeof fetch).catch((x: Error) => x)) as Error;
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain("HTTP 403");
    expect(e.message).toContain("The domain is not verified.");
    expect(e.message).not.toContain("re_chave_secreta");
  });

  it("resposta sem id é erro", async () => {
    const f = vi.fn(async () => resposta({}));
    await expect(enviarEmail(cfg, msg, f as unknown as typeof fetch)).rejects.toThrow("O Resend não confirmou o envio.");
  });

  it("falha de rede/timeout vira 'O Resend não respondeu.'", async () => {
    const f = vi.fn(async () => {
      throw new Error("fetch failed re_chave_secreta");
    });
    const e = (await enviarEmail(cfg, msg, f as unknown as typeof fetch).catch((x: Error) => x)) as Error;
    expect(e.message).toBe("O Resend não respondeu.");
  });

  it("aborta depois de 15 s", async () => {
    vi.useFakeTimers();
    const f = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("abortado", "AbortError")))),
    );
    const p = enviarEmail(cfg, msg, f as unknown as typeof fetch).catch((x: Error) => x);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(f).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(((await p) as Error).message).toBe("O Resend não respondeu.");
  });
});
