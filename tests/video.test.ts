import { describe, expect, it } from "vitest";
import {
  duracaoDaPlaylist,
  formatarDuracao,
  formatarTamanho,
  lerDuracao,
  podeBaixarBunny,
  podeBaixarExterno,
  primeiraVariante,
  statusDoBunny,
  validarUrlVideo,
} from "@/src/lib/regras/video";

describe("statusDoBunny", () => {
  it.each([[0, "enviando"], [1, "enviando"], [2, "processando"], [3, "processando"], [7, "processando"], [8, "processando"], [4, "pronto"], [5, "erro"], [6, "erro"], [99, "erro"]])(
    "%s → %s",
    (c, s) => expect(statusDoBunny(c)).toBe(s),
  );
});

describe("validarUrlVideo", () => {
  it("HLS", () => expect(validarUrlVideo("https://cdn.x.com/a/playlist.m3u8")).toEqual({ tipo: "hls" }));
  it("MP4 com query", () => expect(validarUrlVideo("https://cdn.x.com/a.mp4?token=1")).toEqual({ tipo: "mp4" }));
  it("recusa http", () => expect(validarUrlVideo("http://cdn.x.com/a.mp4")).toEqual({ erro: "Use um link https." }));
  it("recusa outro formato", () => expect(validarUrlVideo("https://youtube.com/watch?v=1")).toEqual({ erro: "O link precisa terminar em .m3u8 ou .mp4." }));
  it("recusa texto", () => expect(validarUrlVideo("abc")).toEqual({ erro: "Link inválido." }));
});

describe("playlist HLS", () => {
  const variante = "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.000,\na.ts\n#EXTINF:4.000,\nb.ts\n#EXTINF:2.5,\nc.ts\n#EXT-X-ENDLIST\n";
  it("soma as durações", () => expect(duracaoDaPlaylist(variante)).toBe(10));
  it("sem segmentos: 0", () => expect(duracaoDaPlaylist("#EXTM3U\n")).toBe(0));
  it("acha a primeira variante da master", () => {
    const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n480p/video.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\n720p/video.m3u8\n";
    expect(primeiraVariante(master, "https://cdn.x.com/abc/playlist.m3u8")).toBe("https://cdn.x.com/abc/480p/video.m3u8");
  });
  it("playlist que não é master: null", () => expect(primeiraVariante(variante, "https://cdn.x.com/abc/playlist.m3u8")).toBeNull());
});

describe("podeBaixarBunny", () => {
  it.each([["pronto", true], ["processando", true], ["enviando", false], ["erro", false]])(
    "%s → %s",
    (s, esperado) => expect(podeBaixarBunny(s as never)).toBe(esperado),
  );
});

describe("podeBaixarExterno", () => {
  it("mp4 → true", () => expect(podeBaixarExterno("https://cdn.x.com/a.mp4")).toBe(true));
  it("mp4 com query → true", () => expect(podeBaixarExterno("https://cdn.x.com/a.mp4?token=1")).toBe(true));
  it("m3u8 → false", () => expect(podeBaixarExterno("https://cdn.x.com/a/playlist.m3u8")).toBe(false));
  it("null → false", () => expect(podeBaixarExterno(null)).toBe(false));
});

describe("duração digitada", () => {
  it.each([["1:02:03", 3723], ["12:05", 725], ["0:45", 45], ["abc", null], ["1:75", null], ["", null]])("%s → %s", (t, s) => expect(lerDuracao(t)).toBe(s));
  it("formata", () => {
    expect(formatarDuracao(3723)).toBe("1:02:03");
    expect(formatarDuracao(725)).toBe("12:05");
    expect(formatarDuracao(45)).toBe("0:45");
  });
});

describe("formatarTamanho", () => {
  it("mostra MB abaixo de 1 GB e GB com uma casa a partir daí", () => {
    expect(formatarTamanho(null)).toBeNull();
    expect(formatarTamanho(0)).toBeNull();
    expect(formatarTamanho(5 * 1024 ** 2)).toBe("5 MB");
    expect(formatarTamanho(1.5 * 1024 ** 3)).toBe("1,5 GB");
  });
});
