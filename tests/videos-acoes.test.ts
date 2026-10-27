import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const dbAdmin = vi.fn();
const bunnyConfig = vi.fn();
const envOpcional = vi.fn();
const registrarAuditoria = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: (...a: unknown[]) => exigirAdmin(...a), dbUsuario: (...a: unknown[]) => dbUsuario(...a) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: (...a: unknown[]) => dbAdmin(...a) }));
vi.mock("@/src/lib/env", () => ({ bunnyConfig: (...a: unknown[]) => bunnyConfig(...a), envOpcional: (...a: unknown[]) => envOpcional(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));

const cfg = { libraryId: "123", apiKey: "chave-teste", cdnHost: "vz-abc.b-cdn.net" };

/** Fábrica de uma chain estilo Supabase que resolve pro `resultado` dado, aceitando qualquer método encadeado. */
function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "insert", "update", "delete", "single", "maybeSingle"]) p[m] = () => p;
  return p;
}

beforeEach(() => {
  vi.resetModules();
  exigirAdmin.mockReset();
  exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
  dbUsuario.mockReset();
  dbAdmin.mockReset();
  bunnyConfig.mockReset();
  envOpcional.mockReset();
  registrarAuditoria.mockReset();
});

describe("atualizarDoBunny", () => {
  it("grava status pronto, duração, bytes, hls_url e thumb_url a partir do obterVideoBunny falso", async () => {
    const resposta = { guid: "g1", status: 4, length: 3600, thumbnailFileName: "thumbnail.jpg", storageSize: 999, encodeProgress: 100, title: "x" };
    const f = vi.fn(async () => new Response(JSON.stringify(resposta), { status: 200, headers: { "content-type": "application/json" } }));

    const update = vi.fn().mockReturnValue(chain(undefined));
    const from = vi.fn().mockImplementation(() => {
      const c = chain({ data: { bunny_guid: "g1" } });
      c.update = update.mockReturnValue(chain(undefined));
      return c;
    });
    const db = { from } as any;

    const { atualizarDoBunny } = await import("../src/lib/videos");
    const status = await atualizarDoBunny("video-1", { db, cfg, f: f as unknown as typeof fetch });

    expect(status).toBe("pronto");
    expect(update).toHaveBeenCalledWith({
      status: "pronto",
      progresso: 100,
      duracao_seg: 3600,
      bytes: 999,
      hls_url: "https://vz-abc.b-cdn.net/g1/playlist.m3u8",
      thumb_url: "https://vz-abc.b-cdn.net/g1/thumbnail.jpg",
    });
  });

  it("storageSize 0 → não grava bytes", async () => {
    const resposta = { guid: "g1", status: 4, length: 3600, thumbnailFileName: "thumbnail.jpg", storageSize: 0, encodeProgress: 100, title: "x" };
    const f = vi.fn(async () => new Response(JSON.stringify(resposta), { status: 200, headers: { "content-type": "application/json" } }));

    const update = vi.fn().mockReturnValue(chain(undefined));
    const from = vi.fn().mockImplementation(() => {
      const c = chain({ data: { bunny_guid: "g1" } });
      c.update = update.mockReturnValue(chain(undefined));
      return c;
    });
    const db = { from } as any;

    const { atualizarDoBunny } = await import("../src/lib/videos");
    await atualizarDoBunny("video-1", { db, cfg, f: f as unknown as typeof fetch });

    expect(update).toHaveBeenCalledWith({
      status: "pronto",
      progresso: 100,
      duracao_seg: 3600,
      hls_url: "https://vz-abc.b-cdn.net/g1/playlist.m3u8",
      thumb_url: "https://vz-abc.b-cdn.net/g1/thumbnail.jpg",
    });
  });

  it("status já pronto → Bunny reportando 'processando' não volta o status, mas 'erro' sim", async () => {
    const resposta = { guid: "g1", status: 3, length: 3600, thumbnailFileName: null, storageSize: 100, encodeProgress: 80, title: "x" };
    const f = vi.fn(async () => new Response(JSON.stringify(resposta), { status: 200, headers: { "content-type": "application/json" } }));

    const update = vi.fn().mockReturnValue(chain(undefined));
    const from = vi.fn().mockImplementation(() => {
      const c = chain({ data: { bunny_guid: "g1", status: "pronto" } });
      c.update = update.mockReturnValue(chain(undefined));
      return c;
    });
    const db = { from } as any;

    const { atualizarDoBunny } = await import("../src/lib/videos");
    const status = await atualizarDoBunny("video-1", { db, cfg, f: f as unknown as typeof fetch });

    expect(status).toBe("pronto");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "pronto" }));
  });

  it("status já pronto → Bunny reportando erro (5/6) volta o status pra erro", async () => {
    const resposta = { guid: "g1", status: 5, length: 3600, thumbnailFileName: null, storageSize: 100, encodeProgress: 0, title: "x" };
    const f = vi.fn(async () => new Response(JSON.stringify(resposta), { status: 200, headers: { "content-type": "application/json" } }));

    const update = vi.fn().mockReturnValue(chain(undefined));
    const from = vi.fn().mockImplementation(() => {
      const c = chain({ data: { bunny_guid: "g1", status: "pronto" } });
      c.update = update.mockReturnValue(chain(undefined));
      return c;
    });
    const db = { from } as any;

    const { atualizarDoBunny } = await import("../src/lib/videos");
    const status = await atualizarDoBunny("video-1", { db, cfg, f: f as unknown as typeof fetch });

    expect(status).toBe("erro");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "erro" }));
  });
});

describe("duracaoExterna", () => {
  const variante = "#EXTM3U\n#EXTINF:4.000,\na.ts\n#EXTINF:6.000,\nb.ts\n#EXT-X-ENDLIST\n";
  const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n480p/video.m3u8\n";

  it("master → segue a variante → soma correta", async () => {
    const f = vi.fn(async (url: string) => {
      if (String(url).endsWith("playlist.m3u8")) return new Response(master, { status: 200 });
      return new Response(variante, { status: 200 });
    });
    const { duracaoExterna } = await import("../src/lib/videos");
    const d = await duracaoExterna("https://cdn.x.com/abc/playlist.m3u8", "hls", f as unknown as typeof fetch);
    expect(d).toBe(10);
  });

  it("MP4 → null", async () => {
    const f = vi.fn();
    const { duracaoExterna } = await import("../src/lib/videos");
    const d = await duracaoExterna("https://cdn.x.com/a.mp4", "mp4", f as unknown as typeof fetch);
    expect(d).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("fetch que falha → null", async () => {
    const f = vi.fn(async () => {
      throw new Error("rede fora");
    });
    const { duracaoExterna } = await import("../src/lib/videos");
    const d = await duracaoExterna("https://cdn.x.com/abc/playlist.m3u8", "hls", f as unknown as typeof fetch);
    expect(d).toBeNull();
  });

  it("playlist maior que 2 MB → null", async () => {
    const grande = "a".repeat(2 * 1024 * 1024 + 10);
    const f = vi.fn(async () => new Response(grande, { status: 200 }));
    const { duracaoExterna } = await import("../src/lib/videos");
    const d = await duracaoExterna("https://cdn.x.com/abc/playlist.m3u8", "hls", f as unknown as typeof fetch);
    expect(d).toBeNull();
  });

  it("busca com redirect manual: 3xx vira null e não segue o redirecionamento", async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "https://outro.com/x.m3u8" } });
    });
    const { duracaoExterna } = await import("../src/lib/videos");
    const d = await duracaoExterna("https://cdn.x.com/abc/playlist.m3u8", "hls", f as unknown as typeof fetch);
    expect(d).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("variante da master não-https → null, sem buscar a variante", async () => {
    const masterInsegura = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nhttp://cdn.x.com/480p/video.m3u8\n";
    const f = vi.fn(async (url: string) => {
      if (String(url).endsWith("playlist.m3u8")) return new Response(masterInsegura, { status: 200 });
      throw new Error("não devia buscar a variante insegura");
    });
    const { duracaoExterna } = await import("../src/lib/videos");
    const d = await duracaoExterna("https://cdn.x.com/abc/playlist.m3u8", "hls", f as unknown as typeof fetch);
    expect(d).toBeNull();
  });
});

describe("iniciarEnvio", () => {
  it("nome vazio (só espaços) → erro, sem chamar o Bunny", async () => {
    bunnyConfig.mockReturnValue(cfg);
    const originalFetch = global.fetch;
    global.fetch = vi.fn();

    const { iniciarEnvio } = await import("../app/(painel)/videos/actions");
    const r = await iniciarEnvio("   ", 1000);
    expect(r).toEqual({ erro: "Dê um nome ao vídeo." });
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = originalFetch;
  });

  it.each([[0, "0"], [-1, "negativo"], [Number.NaN, "NaN"]])(
    "bytes inválido (%s: %s) → erro, sem chamar o Bunny",
    async (bytes) => {
      bunnyConfig.mockReturnValue(cfg);
      const originalFetch = global.fetch;
      global.fetch = vi.fn();

      const { iniciarEnvio } = await import("../app/(painel)/videos/actions");
      const r = await iniciarEnvio("Aula 1", bytes);
      expect(r).toEqual({ erro: "Arquivo de vídeo inválido." });
      expect(global.fetch).not.toHaveBeenCalled();

      global.fetch = originalFetch;
    },
  );

  it("bytes exatamente 2 GiB → aceito", async () => {
    bunnyConfig.mockReturnValue(cfg);
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") return new Response(JSON.stringify({ guid: "g1" }), { status: 200 });
      throw new Error("método inesperado");
    }) as unknown as typeof fetch;

    const insert = vi.fn().mockReturnValue(chain({ data: { id: "video-1" }, error: null }));
    const from = vi.fn().mockReturnValue({ insert });
    dbUsuario.mockResolvedValue({ from });

    const { iniciarEnvio } = await import("../app/(painel)/videos/actions");
    const r = await iniciarEnvio("Aula 1", 2147483648);
    expect("erro" in r).toBe(false);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "criou", descricao: expect.stringContaining("Aula 1") }));

    global.fetch = originalFetch;
  });

  it("sem Bunny configurado → erro", async () => {
    bunnyConfig.mockReturnValue(null);
    const { iniciarEnvio } = await import("../app/(painel)/videos/actions");
    const r = await iniciarEnvio("Aula 1", 1000);
    expect(r).toEqual({ erro: "Envio de vídeo desligado: configure o Bunny Stream." });
  });

  it("Bunny não responde ao criar o vídeo → erro amigável, sem lançar", async () => {
    bunnyConfig.mockReturnValue(cfg);
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => {
      throw new Error("rede fora");
    }) as unknown as typeof fetch;

    const { iniciarEnvio } = await import("../app/(painel)/videos/actions");
    const r = await iniciarEnvio("Aula 1", 1000);
    expect(r).toEqual({ erro: "O Bunny não respondeu. Tente de novo." });

    global.fetch = originalFetch;
  });

  it("insert no banco falha depois de criar no Bunny → desfaz lá (best effort) e devolve erro", async () => {
    bunnyConfig.mockReturnValue(cfg);
    const chamadas: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      chamadas.push(String(init.method));
      if (init.method === "POST") return new Response(JSON.stringify({ guid: "g1" }), { status: 200 });
      if (init.method === "DELETE") return new Response(JSON.stringify({ success: true }), { status: 200 });
      throw new Error("método inesperado");
    }) as unknown as typeof fetch;

    const insert = vi.fn().mockReturnValue(chain({ data: null, error: { message: "boom" } }));
    const from = vi.fn().mockReturnValue({ insert });
    dbUsuario.mockResolvedValue({ from });

    const { iniciarEnvio } = await import("../app/(painel)/videos/actions");
    const r = await iniciarEnvio("Aula 1", 1000);

    expect(r).toEqual({ erro: "Não deu para registrar o vídeo." });
    expect(chamadas).toEqual(["POST", "DELETE"]);
    expect(registrarAuditoria).not.toHaveBeenCalled();

    global.fetch = originalFetch;
  });

  it("insert falha e a exclusão de limpeza no Bunny também falha → ainda devolve o erro do insert (sem lançar)", async () => {
    bunnyConfig.mockReturnValue(cfg);
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") return new Response(JSON.stringify({ guid: "g1" }), { status: 200 });
      throw new Error("rede fora na exclusão");
    }) as unknown as typeof fetch;

    const insert = vi.fn().mockReturnValue(chain({ data: null, error: { message: "boom" } }));
    const from = vi.fn().mockReturnValue({ insert });
    dbUsuario.mockResolvedValue({ from });

    const { iniciarEnvio } = await import("../app/(painel)/videos/actions");
    const r = await iniciarEnvio("Aula 1", 1000);
    expect(r).toEqual({ erro: "Não deu para registrar o vídeo." });

    global.fetch = originalFetch;
  });
});

describe("adicionarExterno", () => {
  function form(campos: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(campos)) f.set(k, v);
    return f;
  }

  it("MP4 sem duração → erro com os valores digitados", async () => {
    const { adicionarExterno } = await import("../app/(painel)/videos/actions");
    const campos = { nome: "Aula", url: "https://cdn.x.com/a.mp4", duracao: "" };
    const r = await adicionarExterno({}, form(campos));
    expect(r).toEqual({ erro: "Informe a duração do vídeo (hh:mm:ss).", valores: campos });
  });

  it("HLS com duração calculada → insere com duracao_seg", async () => {
    const playlist = "#EXTM3U\n#EXTINF:4.000,\na.ts\n#EXTINF:6.000,\nb.ts\n#EXT-X-ENDLIST\n";
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => new Response(playlist, { status: 200 })) as unknown as typeof fetch;

    const insert = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockReturnValue({ insert });
    dbUsuario.mockResolvedValue({ from });

    const { adicionarExterno } = await import("../app/(painel)/videos/actions");
    const campos = { nome: "Aula", url: "https://cdn.x.com/abc/playlist.m3u8", duracao: "" };
    const r = await adicionarExterno({}, form(campos));

    expect(r).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ origem: "externo", status: "pronto", hls_url: "https://cdn.x.com/abc/playlist.m3u8", duracao_seg: 10 }),
    );
    global.fetch = originalFetch;
  });

  it("HLS sem duração legível no link e sem duração digitada → erro, não insere", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => {
      throw new Error("rede fora");
    }) as unknown as typeof fetch;

    const insert = vi.fn();
    const from = vi.fn().mockReturnValue({ insert });
    dbUsuario.mockResolvedValue({ from });

    const { adicionarExterno } = await import("../app/(painel)/videos/actions");
    const campos = { nome: "Aula", url: "https://cdn.x.com/abc/playlist.m3u8", duracao: "" };
    const r = await adicionarExterno({}, form(campos));

    expect(r).toEqual({ erro: "Não deu para ler a duração do link. Informe a duração (hh:mm:ss).", valores: campos });
    expect(insert).not.toHaveBeenCalled();
    global.fetch = originalFetch;
  });

  it("HLS sem duração legível no link mas com duração digitada válida → insere com a digitada", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => {
      throw new Error("rede fora");
    }) as unknown as typeof fetch;

    const insert = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockReturnValue({ insert });
    dbUsuario.mockResolvedValue({ from });

    const { adicionarExterno } = await import("../app/(painel)/videos/actions");
    const campos = { nome: "Aula", url: "https://cdn.x.com/abc/playlist.m3u8", duracao: "0:45:00" };
    const r = await adicionarExterno({}, form(campos));

    expect(r).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ duracao_seg: 2700 }));
    global.fetch = originalFetch;
  });
});

describe("marcarEnviado", () => {
  it("Bunny não responde → erro amigável, sem lançar", async () => {
    bunnyConfig.mockReturnValue(cfg);
    dbAdmin.mockReturnValue({ from: vi.fn().mockReturnValue(chain({ data: { bunny_guid: "g1" } })) });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => {
      throw new Error("rede fora");
    }) as unknown as typeof fetch;

    const { marcarEnviado } = await import("../app/(painel)/videos/actions");
    const r = await marcarEnviado("video-1");
    expect(r).toEqual({ erro: "O Bunny não respondeu. Tente de novo." });

    global.fetch = originalFetch;
  });
});

describe("renomearVideo", () => {
  it("nome vazio (só espaços) → erro, sem tocar no banco nem no Bunny", async () => {
    const from = vi.fn();
    dbUsuario.mockResolvedValue({ from });
    const originalFetch = global.fetch;
    global.fetch = vi.fn();

    const { renomearVideo } = await import("../app/(painel)/videos/actions");
    const r = await renomearVideo("video-1", "   ");
    expect(r).toEqual({ erro: "Dê um nome ao vídeo." });
    expect(from).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = originalFetch;
  });

  it("Bunny não responde → erro amigável, sem lançar", async () => {
    bunnyConfig.mockReturnValue(cfg);
    const from = vi.fn().mockReturnValue(chain({ data: { origem: "bunny", bunny_guid: "g1" } }));
    dbUsuario.mockResolvedValue({ from });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => {
      throw new Error("rede fora");
    }) as unknown as typeof fetch;

    const { renomearVideo } = await import("../app/(painel)/videos/actions");
    const r = await renomearVideo("video-1", "Novo nome");
    expect(r).toEqual({ erro: "O Bunny não respondeu. Tente de novo." });

    global.fetch = originalFetch;
  });
});

describe("excluirVideo", () => {
  it("com vínculo → erro com a contagem", async () => {
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinar_video") {
        const c = chain({ count: 2, data: null, error: null });
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { excluirVideo } = await import("../app/(painel)/videos/actions");
    const r = await excluirVideo("video-1");
    expect(r).toEqual({ erro: "Este vídeo está em 2 webinar(s). Troque o vídeo deles antes de excluir." });
  });

  it("sem vínculo → apaga", async () => {
    const del = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinar_video") return chain({ count: 0, data: null, error: null });
      if (tabela === "videos") {
        const c = chain({ data: { origem: "externo", bunny_guid: null } });
        c.delete = del;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { excluirVideo } = await import("../app/(painel)/videos/actions");
    const r = await excluirVideo("video-1");
    expect(r).toEqual({});
    expect(del).toHaveBeenCalled();
  });

  it("apaga a linha primeiro; se o Bunny falhar ao excluir lá, ainda devolve sucesso", async () => {
    bunnyConfig.mockReturnValue(cfg);
    const del = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinar_video") return chain({ count: 0, data: null, error: null });
      if (tabela === "videos") {
        const c = chain({ data: { origem: "bunny", bunny_guid: "g1" } });
        c.delete = del;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => {
      throw new Error("rede fora");
    }) as unknown as typeof fetch;

    const { excluirVideo } = await import("../app/(painel)/videos/actions");
    const r = await excluirVideo("video-1");
    expect(r).toEqual({});
    expect(del).toHaveBeenCalled();

    global.fetch = originalFetch;
  });
});

describe("webhook do Bunny", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("token errado → 401", async () => {
    envOpcional.mockReturnValue("token-certo");
    const { POST } = await import("../app/api/bunny/webhook/[token]/route");
    const req = new Request("https://x.com/api/bunny/webhook/token-errado", { method: "POST", body: JSON.stringify({}) });
    const res = await POST(req, { params: Promise.resolve({ token: "token-errado" }) });
    expect(res.status).toBe(401);
  });

  it("sem BUNNY_WEBHOOK_TOKEN → 404", async () => {
    envOpcional.mockReturnValue(undefined);
    const { POST } = await import("../app/api/bunny/webhook/[token]/route");
    const req = new Request("https://x.com/api/bunny/webhook/qualquer", { method: "POST", body: JSON.stringify({}) });
    const res = await POST(req, { params: Promise.resolve({ token: "qualquer" }) });
    expect(res.status).toBe(404);
  });

  it("corpo malformado (JSON inválido) → 200, ignorado", async () => {
    envOpcional.mockReturnValue("token-certo");
    const { POST } = await import("../app/api/bunny/webhook/[token]/route");
    const req = new Request("https://x.com/api/bunny/webhook/token-certo", { method: "POST", body: "{isso não é json" });
    const res = await POST(req, { params: Promise.resolve({ token: "token-certo" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("corpo `null` → 200, ignorado", async () => {
    envOpcional.mockReturnValue("token-certo");
    const { POST } = await import("../app/api/bunny/webhook/[token]/route");
    const req = new Request("https://x.com/api/bunny/webhook/token-certo", { method: "POST", body: "null" });
    const res = await POST(req, { params: Promise.resolve({ token: "token-certo" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("guid desconhecido → 200 e não atualiza nada", async () => {
    envOpcional.mockReturnValue("token-certo");
    const update = vi.fn();
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "videos") return chain({ data: null });
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const { POST } = await import("../app/api/bunny/webhook/[token]/route");
    const req = new Request("https://x.com/api/bunny/webhook/token-certo", {
      method: "POST",
      body: JSON.stringify({ VideoGuid: "guid-desconhecido" }),
    });
    const res = await POST(req, { params: Promise.resolve({ token: "token-certo" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(update).not.toHaveBeenCalled();
  });

  it("Bunny falha ao atualizar (erro transitório) → 502, pra o Bunny tentar de novo", async () => {
    envOpcional.mockReturnValue("token-certo");
    bunnyConfig.mockReturnValue(cfg);
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "videos") return chain({ data: { id: "video-1", bunny_guid: "g1" } });
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => {
      throw new Error("rede fora");
    }) as unknown as typeof fetch;

    const { POST } = await import("../app/api/bunny/webhook/[token]/route");
    const req = new Request("https://x.com/api/bunny/webhook/token-certo", {
      method: "POST",
      body: JSON.stringify({ VideoGuid: "g1" }),
    });
    const res = await POST(req, { params: Promise.resolve({ token: "token-certo" }) });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false });

    global.fetch = originalFetch;
  });

  it("token certo e guid conhecido → chama a atualização e responde 200", async () => {
    envOpcional.mockReturnValue("token-certo");
    const update = vi.fn().mockReturnValue(chain(undefined));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "videos") {
        const c = chain({ data: { id: "video-1", bunny_guid: "g1" } });
        c.update = update.mockReturnValue(chain(undefined));
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbAdmin.mockReturnValue({ from });
    bunnyConfig.mockReturnValue(cfg);

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ guid: "g1", status: 4, length: 10, thumbnailFileName: null, storageSize: 1, encodeProgress: 100 }), { status: 200 })) as unknown as typeof fetch;

    const { POST } = await import("../app/api/bunny/webhook/[token]/route");
    const req = new Request("https://x.com/api/bunny/webhook/token-certo", {
      method: "POST",
      body: JSON.stringify({ VideoLibraryId: 123, VideoGuid: "g1", Status: 4 }),
    });
    const res = await POST(req, { params: Promise.resolve({ token: "token-certo" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(update).toHaveBeenCalled();
    global.fetch = originalFetch;
  });
});
