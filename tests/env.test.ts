import { afterEach, describe, expect, it } from "vitest";
import { bunnyConfig, emailConfig, env, envOpcional, iaConfig } from "@/src/lib/env";

describe("env", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("lê a variável quando existe", () => {
    process.env.CRON_SECRET = "abc";
    expect(env("CRON_SECRET")).toBe("abc");
  });

  it("falha com o nome da variável quando falta", () => {
    expect(() => env("CRON_SECRET")).toThrow("Variável de ambiente ausente: CRON_SECRET");
  });

  it("opcional devolve undefined para vazio", () => {
    process.env.CRON_SECRET = "";
    expect(envOpcional("CRON_SECRET")).toBeUndefined();
  });
});

describe("bunnyConfig", () => {
  afterEach(() => {
    delete process.env.BUNNY_STREAM_LIBRARY_ID;
    delete process.env.BUNNY_STREAM_API_KEY;
    delete process.env.BUNNY_STREAM_CDN_HOST;
  });

  it("com as três definidas devolve o objeto", () => {
    process.env.BUNNY_STREAM_LIBRARY_ID = "123";
    process.env.BUNNY_STREAM_API_KEY = "chave";
    process.env.BUNNY_STREAM_CDN_HOST = "vz-abc.b-cdn.net";
    expect(bunnyConfig()).toEqual({ libraryId: "123", apiKey: "chave", cdnHost: "vz-abc.b-cdn.net" });
  });

  it("faltando uma devolve null", () => {
    process.env.BUNNY_STREAM_LIBRARY_ID = "123";
    process.env.BUNNY_STREAM_API_KEY = "chave";
    expect(bunnyConfig()).toBeNull();
  });
});

describe("iaConfig", () => {
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_TEXT_MODEL;
    delete process.env.ELEVENLABS_API_KEY;
  });

  it("com OpenRouter e ElevenLabs definidos devolve os três", () => {
    process.env.OPENROUTER_API_KEY = "chave-or";
    process.env.OPENROUTER_TEXT_MODEL = "openrouter/modelo-x";
    process.env.ELEVENLABS_API_KEY = "chave-el";
    expect(iaConfig()).toEqual({ openrouterKey: "chave-or", modelo: "openrouter/modelo-x", elevenlabsKey: "chave-el" });
  });

  it("sem ElevenLabs devolve com elevenlabsKey null (só a transcrição fica indisponível)", () => {
    process.env.OPENROUTER_API_KEY = "chave-or";
    process.env.OPENROUTER_TEXT_MODEL = "openrouter/modelo-x";
    expect(iaConfig()).toEqual({ openrouterKey: "chave-or", modelo: "openrouter/modelo-x", elevenlabsKey: null });
  });

  it("sem a chave ou o modelo do OpenRouter devolve null", () => {
    process.env.OPENROUTER_API_KEY = "chave-or";
    expect(iaConfig()).toBeNull();
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_TEXT_MODEL = "openrouter/modelo-x";
    expect(iaConfig()).toBeNull();
  });
});

describe("emailConfig", () => {
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it("com as duas definidas devolve { resendKey, de }", () => {
    process.env.RESEND_API_KEY = "re_x";
    process.env.EMAIL_FROM = "aulas@exemplo.com.br";
    expect(emailConfig()).toEqual({ resendKey: "re_x", de: "aulas@exemplo.com.br" });
  });

  it("faltando uma devolve null", () => {
    process.env.RESEND_API_KEY = "re_x";
    expect(emailConfig()).toBeNull();
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM = "aulas@exemplo.com.br";
    expect(emailConfig()).toBeNull();
  });
});
