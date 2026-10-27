import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assinaturaTus, criarVideoBunny, excluirVideoBunny, obterVideoBunny, renomearVideoBunny, urlsBunny } from "@/src/lib/bunny/cliente";

const cfg = { libraryId: "123", apiKey: "chave-teste", cdnHost: "vz-abc.b-cdn.net" };
const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

describe("cliente do Bunny", () => {
  it("cria vídeo com a chave no cabeçalho", async () => {
    const f = vi.fn(async () => resposta({ guid: "g1" }));
    await expect(criarVideoBunny(cfg, "Aula 1", f as unknown as typeof fetch)).resolves.toEqual({ guid: "g1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://video.bunnycdn.com/library/123/videos");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).AccessKey).toBe("chave-teste");
    expect(JSON.parse(String(init.body))).toEqual({ title: "Aula 1" });
  });

  it("lê o vídeo", async () => {
    const f = vi.fn(async () => resposta({ guid: "g1", status: 4, length: 3600, thumbnailFileName: "thumbnail.jpg", storageSize: 10, encodeProgress: 100, title: "x" }));
    const v = await obterVideoBunny(cfg, "g1", f as unknown as typeof fetch);
    expect(v).toEqual({ guid: "g1", status: 4, length: 3600, thumbnailFileName: "thumbnail.jpg", storageSize: 10, encodeProgress: 100 });
  });

  it("erro da API vira exceção sem vazar a chave", async () => {
    const f = vi.fn(async () => resposta({ Message: "Unauthorized" }, 401));
    const e = await obterVideoBunny(cfg, "g1", f as unknown as typeof fetch).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect(String((e as Error).message)).toContain("401");
    expect(String((e as Error).message)).not.toContain("chave-teste");
  });

  it("renomeia e exclui", async () => {
    const f = vi.fn(async () => resposta({ success: true }));
    await renomearVideoBunny(cfg, "g1", "Novo", f as unknown as typeof fetch);
    await excluirVideoBunny(cfg, "g1", f as unknown as typeof fetch);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("POST");
    expect((f.mock.calls[1] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("excluir vídeo que já não existe (404) não é erro", async () => {
    const f = vi.fn(async () => resposta({}, 404));
    await expect(excluirVideoBunny(cfg, "g1", f as unknown as typeof fetch)).resolves.toBeUndefined();
  });

  it("assinatura TUS", () => {
    const a = assinaturaTus(cfg, "g1", 1790000000);
    expect(a).toEqual({
      endpoint: "https://video.bunnycdn.com/tusupload",
      assinatura: createHash("sha256").update("123chave-teste1790000000g1").digest("hex"),
      expira: 1790000000,
      libraryId: "123",
      videoId: "g1",
    });
  });

  it("URLs do CDN", () => {
    expect(urlsBunny(cfg, "g1", "thumbnail.jpg")).toEqual({
      hls: "https://vz-abc.b-cdn.net/g1/playlist.m3u8",
      miniatura: "https://vz-abc.b-cdn.net/g1/thumbnail.jpg",
      original: "https://vz-abc.b-cdn.net/g1/original",
      audio: "https://vz-abc.b-cdn.net/g1/play_360p.mp4",
    });
    expect(urlsBunny(cfg, "g1", null).miniatura).toBeNull();
  });
});
