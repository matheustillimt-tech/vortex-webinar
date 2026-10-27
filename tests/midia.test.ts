import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  caminhoMidia,
  idValido,
  LIMITE_SOMA_IMAGENS_BYTES,
  urlImagemChatValida,
  validarImagem,
  validarImagensDoFormulario,
} from "../src/lib/regras/midia";

const TRES_MB = 3 * 1024 * 1024;

describe("validarImagem", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("%s com tamanho ok → sem erro", (tipo) => {
    expect(validarImagem(tipo, 1000)).toBeNull();
  });

  it("gif → recusado", () => {
    expect(validarImagem("image/gif", 1000)).toBe("Use uma imagem JPG, PNG ou WEBP.");
  });

  it("0 bytes → recusado", () => {
    expect(validarImagem("image/jpeg", 0)).toBe("A imagem precisa ter até 3 MB.");
  });

  it("3 MB + 1 byte → recusado", () => {
    expect(validarImagem("image/jpeg", TRES_MB + 1)).toBe("A imagem precisa ter até 3 MB.");
  });

  it("3 MB exatos → ok", () => {
    expect(validarImagem("image/jpeg", TRES_MB)).toBeNull();
  });
});

describe("validarImagensDoFormulario", () => {
  it("nenhum arquivo → sem erro", () => {
    expect(validarImagensDoFormulario([])).toBeNull();
  });

  it("um arquivo até 3 MB → sem erro", () => {
    expect(validarImagensDoFormulario([TRES_MB])).toBeNull();
  });

  it("um arquivo acima de 3 MB → recusado", () => {
    expect(validarImagensDoFormulario([TRES_MB + 1])).toBe("A imagem precisa ter até 3 MB.");
  });

  it("dois arquivos, cada um ok, mas a soma passa de 3,8 MB → recusado", () => {
    const r = validarImagensDoFormulario([2 * 1024 * 1024, 2 * 1024 * 1024]);
    expect(r).toBe("As imagens juntas passam de 3,8 MB. Envie uma de cada vez.");
  });

  it("dois arquivos cuja soma dá exatamente 3,8 MB → ok", () => {
    const meio = LIMITE_SOMA_IMAGENS_BYTES / 2;
    expect(validarImagensDoFormulario([meio, meio])).toBeNull();
  });

  it("um arquivo acima de 3 MB tem prioridade sobre a mensagem de soma", () => {
    const r = validarImagensDoFormulario([TRES_MB + 1, TRES_MB + 1]);
    expect(r).toBe("A imagem precisa ter até 3 MB.");
  });
});

describe("caminhoMidia", () => {
  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ])("%s → extensão %s", (tipo, ext) => {
    expect(caminhoMidia("webinar-1", tipo, "id-1")).toBe(`webinars/webinar-1/id-1.${ext}`);
  });
});

describe("caminhoMidia com pasta", () => {
  it("com pasta → webinars/<id>/<pasta>/<id>.<ext>", () => {
    expect(caminhoMidia("webinar-1", "image/jpeg", "id-1", "chat")).toBe("webinars/webinar-1/chat/id-1.jpg");
  });
  it("sem pasta → caminho de sempre", () => {
    expect(caminhoMidia("webinar-1", "image/jpeg", "id-1")).toBe("webinars/webinar-1/id-1.jpg");
  });
});

describe("urlImagemChatValida", () => {
  const SUPABASE_URL = "https://proj.supabase.co";
  const WEBINAR_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

  it("url certa (bucket, webinar e pasta chat) → válida", () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/midias/webinars/${WEBINAR_ID}/chat/abc-123.jpg`;
    expect(urlImagemChatValida(url, WEBINAR_ID, SUPABASE_URL)).toBe(true);
  });

  it("outro host → inválida", () => {
    const url = `https://outro.com/storage/v1/object/public/midias/webinars/${WEBINAR_ID}/chat/abc.jpg`;
    expect(urlImagemChatValida(url, WEBINAR_ID, SUPABASE_URL)).toBe(false);
  });

  it("outro webinar → inválida", () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/midias/webinars/00000000-0000-0000-0000-000000000000/chat/abc.jpg`;
    expect(urlImagemChatValida(url, WEBINAR_ID, SUPABASE_URL)).toBe(false);
  });

  it("fora da pasta chat (ex.: raiz do webinar) → inválida", () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/midias/webinars/${WEBINAR_ID}/abc.jpg`;
    expect(urlImagemChatValida(url, WEBINAR_ID, SUPABASE_URL)).toBe(false);
  });

  it("subpasta extra (path traversal) → inválida", () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/midias/webinars/${WEBINAR_ID}/chat/sub/abc.jpg`;
    expect(urlImagemChatValida(url, WEBINAR_ID, SUPABASE_URL)).toBe(false);
  });

  it("extensão não permitida → inválida", () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/midias/webinars/${WEBINAR_ID}/chat/abc.gif`;
    expect(urlImagemChatValida(url, WEBINAR_ID, SUPABASE_URL)).toBe(false);
  });
});

describe("idValido", () => {
  it("UUID v4 → válido", () => {
    expect(idValido("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe(true);
  });

  it("UUID maiúsculo → válido", () => {
    expect(idValido("3FA85F64-5717-4562-B3FC-2C963F66AFA6")).toBe(true);
  });

  it("slug comum → inválido", () => {
    expect(idValido("webinar-1")).toBe(false);
  });

  it("string vazia → inválido", () => {
    expect(idValido("")).toBe(false);
  });

  it("quase um UUID (um caractere curto) → inválido", () => {
    expect(idValido("3fa85f64-5717-4562-b3fc-2c963f66afa")).toBe(false);
  });
});

const dbAdmin = vi.fn();
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));

const WEBINAR_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function arquivoFalso(tipo: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], "foto", { type: tipo });
}

describe("enviarImagem", () => {
  beforeEach(() => {
    dbAdmin.mockReset();
  });

  it("webinarId inválido (não é UUID) → erro sem chamar o storage", async () => {
    const from = vi.fn();
    dbAdmin.mockReturnValue({ storage: { from } });

    const { enviarImagem } = await import("../src/lib/midias");
    const r = await enviarImagem("webinar-1", arquivoFalso("image/jpeg", 1000));

    expect(r).toEqual({ erro: "Webinar inválido." });
    expect(from).not.toHaveBeenCalled();
  });

  it("tipo inválido → erro sem chamar o storage", async () => {
    const from = vi.fn();
    dbAdmin.mockReturnValue({ storage: { from } });

    const { enviarImagem } = await import("../src/lib/midias");
    const r = await enviarImagem(WEBINAR_ID, arquivoFalso("image/gif", 1000));

    expect(r).toEqual({ erro: "Use uma imagem JPG, PNG ou WEBP." });
    expect(from).not.toHaveBeenCalled();
  });

  it("upload ok → devolve a URL pública", async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: "x" }, error: null });
    const getPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: `https://cdn.x/midias/webinars/${WEBINAR_ID}/id.jpg` } });
    const from = vi.fn().mockReturnValue({ upload, getPublicUrl });
    dbAdmin.mockReturnValue({ storage: { from } });

    const { enviarImagem } = await import("../src/lib/midias");
    const r = await enviarImagem(WEBINAR_ID, arquivoFalso("image/jpeg", 1000));

    expect(from).toHaveBeenCalledWith("midias");
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^webinars/${WEBINAR_ID}/.+\\.jpg$`)),
      expect.anything(),
      { contentType: "image/jpeg", upsert: false },
    );
    expect(r).toEqual({ url: `https://cdn.x/midias/webinars/${WEBINAR_ID}/id.jpg` });
  });

  it("upload com erro → erro amigável", async () => {
    const upload = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const getPublicUrl = vi.fn();
    const from = vi.fn().mockReturnValue({ upload, getPublicUrl });
    dbAdmin.mockReturnValue({ storage: { from } });

    const { enviarImagem } = await import("../src/lib/midias");
    const r = await enviarImagem(WEBINAR_ID, arquivoFalso("image/png", 1000));

    expect(r).toEqual({ erro: "Não deu para enviar a imagem." });
    expect(getPublicUrl).not.toHaveBeenCalled();
  });
});
