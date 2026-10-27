import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const dbUsuario = vi.fn();
const revalidatePath = vi.fn();
const enviarImagem = vi.fn();
const registrarAuditoria = vi.fn();

vi.mock("@/src/lib/supabase/usuario", () => ({ exigirAdmin: (...a: unknown[]) => exigirAdmin(...a), dbUsuario: (...a: unknown[]) => dbUsuario(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/src/lib/midias", () => ({ enviarImagem: (...a: unknown[]) => enviarImagem(...a) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));

/** Fábrica de uma chain estilo Supabase que resolve pro `resultado` dado, aceitando qualquer método encadeado. */
function chain(resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "neq", "upsert", "update", "maybeSingle"]) p[m] = () => p;
  return p;
}

function form(campos: Record<string, string>, arquivos: Record<string, File> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  for (const [k, v] of Object.entries(arquivos)) f.set(k, v);
  return f;
}

function arquivoFalso(bytes: number, nome = "foto.jpg", tipo = "image/jpeg"): File {
  return new File([new Uint8Array(bytes)], nome, { type: tipo });
}

beforeEach(() => {
  vi.resetModules();
  exigirAdmin.mockReset();
  exigirAdmin.mockResolvedValue({ id: "admin-1", nome: "Admin", papel: "admin" });
  dbUsuario.mockReset();
  revalidatePath.mockReset();
  enviarImagem.mockReset();
  registrarAuditoria.mockReset();
});

const CAMPOS_INICIO = {
  nome: "Minha Aula",
  titulo: "Título",
  slug: "minha-aula",
  idioma: "pt-BR",
  apresentador_nome: "Fulano",
};

describe("salvarInicio", () => {
  it("exige admin antes de tudo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { salvarInicio } = await import("../app/(painel)/webinars/[id]/inicio/actions");
    await expect(salvarInicio("webinar-1", {}, form(CAMPOS_INICIO))).rejects.toThrow("Só administradores podem fazer isso.");
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("erro de validação devolve valores digitados", async () => {
    const { salvarInicio } = await import("../app/(painel)/webinars/[id]/inicio/actions");
    const campos = { ...CAMPOS_INICIO, nome: "" };
    const r = await salvarInicio("webinar-1", {}, form(campos));
    expect(r).toEqual({ erro: "Dê um nome ao webinar.", valores: campos });
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("slug mudou e já está em uso por outro webinar → erro", async () => {
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c = chain({ data: { slug: "slug-antigo", apresentador_avatar_url: null } });
        let chamada = 0;
        c.maybeSingle = () => {
          chamada++;
          if (chamada === 1) return Promise.resolve({ data: { slug: "slug-antigo", apresentador_avatar_url: null } });
          return Promise.resolve({ data: { id: "outro-webinar" } });
        };
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarInicio } = await import("../app/(painel)/webinars/[id]/inicio/actions");
    const r = await salvarInicio("webinar-1", {}, form(CAMPOS_INICIO));
    expect(r).toEqual({ erro: "Esse endereço já está em uso.", valores: CAMPOS_INICIO });
    expect(enviarImagem).not.toHaveBeenCalled();
  });

  it("avatar vazio → não chama enviarImagem, mantém o avatar atual", async () => {
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: { slug: "minha-aula", apresentador_avatar_url: "https://x/atual.jpg" } });
        c.update = update;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarInicio } = await import("../app/(painel)/webinars/[id]/inicio/actions");
    const r = await salvarInicio("webinar-1", {}, form(CAMPOS_INICIO, { avatar: arquivoFalso(0) }));

    expect(r.ok).toBe(true);
    expect(enviarImagem).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ apresentador_avatar_url: "https://x/atual.jpg" }),
    );
  });

  it("avatar enviado → chama enviarImagem e grava a nova url", async () => {
    enviarImagem.mockResolvedValue({ url: "https://x/novo.jpg" });
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: { slug: "minha-aula", apresentador_avatar_url: null } });
        c.update = update;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarInicio } = await import("../app/(painel)/webinars/[id]/inicio/actions");
    const arquivo = arquivoFalso(1000);
    const r = await salvarInicio("webinar-1", {}, form(CAMPOS_INICIO, { avatar: arquivo }));

    expect(r.ok).toBe(true);
    expect(enviarImagem).toHaveBeenCalledWith("webinar-1", arquivo);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ apresentador_avatar_url: "https://x/novo.jpg" }));
    expect(revalidatePath).toHaveBeenCalledWith("/webinars/webinar-1/inicio");
  });

  it("grava antes/depois na auditoria (Revisão final: step saves levam antes/depois)", async () => {
    const update = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: { nome: "Antigo", slug: "minha-aula", apresentador_avatar_url: null } });
        c.update = update;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarInicio } = await import("../app/(painel)/webinars/[id]/inicio/actions");
    const r = await salvarInicio("webinar-1", {}, form(CAMPOS_INICIO));

    expect(r.ok).toBe(true);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        antes: expect.objectContaining({ nome: "Antigo" }),
        depois: expect.objectContaining({ nome: "Minha Aula" }),
      }),
    );
  });

  it("update falha → erro amigável", async () => {
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: { slug: "minha-aula", apresentador_avatar_url: null } });
        c.update = () => chain({ error: { message: "boom" } });
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarInicio } = await import("../app/(painel)/webinars/[id]/inicio/actions");
    const r = await salvarInicio("webinar-1", {}, form(CAMPOS_INICIO));
    expect(r).toEqual({ erro: "Não deu para salvar o início.", valores: CAMPOS_INICIO });
  });

  it("update falha com 23505 (corrida de slug) → erro de endereço em uso", async () => {
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "webinars") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: { slug: "minha-aula", apresentador_avatar_url: null } });
        c.update = () => chain({ error: { code: "23505", message: "duplicate" } });
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarInicio } = await import("../app/(painel)/webinars/[id]/inicio/actions");
    const r = await salvarInicio("webinar-1", {}, form(CAMPOS_INICIO));
    expect(r).toEqual({ erro: "Esse endereço já está em uso.", valores: CAMPOS_INICIO });
  });
});

const CAMPOS_LOGIN = {
  logo_alinhamento: "centro",
  barra_valor: "50",
  barra_cor: "#ffffff",
  barra_cor_texto: "#000000",
  botao_cor: "#123abc",
  botao_cor_texto: "#ffffff",
  titulo_html: "<b>Oi</b>",
  botao_texto: "Entrar",
  email_obrigatorio: "on",
  pede_email: "on",
  pais_padrao: "br",
};

describe("salvarTelaLogin", () => {
  it("exige admin antes de tudo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { salvarTelaLogin } = await import("../app/(painel)/webinars/[id]/login/actions");
    await expect(salvarTelaLogin("webinar-1", {}, form(CAMPOS_LOGIN))).rejects.toThrow("Só administradores podem fazer isso.");
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("erro de validação devolve valores digitados", async () => {
    const { salvarTelaLogin } = await import("../app/(painel)/webinars/[id]/login/actions");
    const campos = { ...CAMPOS_LOGIN, botao_texto: "" };
    const r = await salvarTelaLogin("webinar-1", {}, form(campos));
    expect(r).toEqual({ erro: "Escreva o texto do botão.", valores: campos });
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("logo vazio → não chama enviarImagem, mantém a logo atual, upsert com onConflict webinar_id", async () => {
    const upsert = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "telas_login") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: { logo_url: "https://x/logo-atual.png" } });
        c.upsert = upsert;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarTelaLogin } = await import("../app/(painel)/webinars/[id]/login/actions");
    const r = await salvarTelaLogin("webinar-1", {}, form(CAMPOS_LOGIN, { logo: arquivoFalso(0) }));

    expect(r.ok).toBe(true);
    expect(enviarImagem).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ webinar_id: "webinar-1", logo_url: "https://x/logo-atual.png" }),
      { onConflict: "webinar_id" },
    );
  });

  it("logo enviada → chama enviarImagem e grava a nova url", async () => {
    enviarImagem.mockResolvedValue({ url: "https://x/logo-nova.png" });
    const upsert = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "telas_login") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: null });
        c.upsert = upsert;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarTelaLogin } = await import("../app/(painel)/webinars/[id]/login/actions");
    const arquivo = arquivoFalso(1000);
    const r = await salvarTelaLogin("webinar-1", {}, form(CAMPOS_LOGIN, { logo: arquivo }));

    expect(r.ok).toBe(true);
    expect(enviarImagem).toHaveBeenCalledWith("webinar-1", arquivo);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ logo_url: "https://x/logo-nova.png" }),
      { onConflict: "webinar_id" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/webinars/webinar-1/login");
  });

  it("placeholders limpos → upsert recebe os defaults da tabela (não null)", async () => {
    const upsert = vi.fn().mockReturnValue(chain({ error: null }));
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "telas_login") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: null });
        c.upsert = upsert;
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarTelaLogin } = await import("../app/(painel)/webinars/[id]/login/actions");
    const campos = { ...CAMPOS_LOGIN, placeholder_nome: "", placeholder_email: "", placeholder_telefone: "" };
    const r = await salvarTelaLogin("webinar-1", {}, form(campos));

    expect(r.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        placeholder_nome: "Como podemos te chamar",
        placeholder_email: "Seu melhor e-mail",
        placeholder_telefone: "Seu WhatsApp",
      }),
      { onConflict: "webinar_id" },
    );
  });

  it("upsert falha → erro amigável", async () => {
    const from = vi.fn().mockImplementation((tabela: string) => {
      if (tabela === "telas_login") {
        const c: any = {};
        c.select = () => c;
        c.eq = () => c;
        c.maybeSingle = () => Promise.resolve({ data: null });
        c.upsert = () => chain({ error: { message: "boom" } });
        return c;
      }
      throw new Error("tabela inesperada: " + tabela);
    });
    dbUsuario.mockResolvedValue({ from });

    const { salvarTelaLogin } = await import("../app/(painel)/webinars/[id]/login/actions");
    const r = await salvarTelaLogin("webinar-1", {}, form(CAMPOS_LOGIN));
    expect(r).toEqual({ erro: "Não deu para salvar a tela de login.", valores: CAMPOS_LOGIN });
  });
});

const CAMPOS_OFERTA = {
  ligada: "on",
  nome: "Oferta X",
  titulo: "Título Y",
  preco_original: "997",
  preco_oferta: "497",
  botao_texto: "Comprar",
  botao_cor: "#16a34a",
  link: "https://checkout.com/x",
  repassar_utms: "on",
  aparece: "1:00",
  some: "",
  pitch: "",
  contagem: "5:00",
  contagem_layout: "classico",
  sorteio_ligado: "",
  sorteio_momento: "",
  sorteio_numero: "",
};

/** Fábrica de um `from` que roteia por tabela; `webinar_video` sempre devolve a duração dada (ou nenhum vídeo). */
function fromOferta(duracaoVideoSeg: number | null, ofertasOverrides: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation((tabela: string) => {
    if (tabela === "webinar_video") {
      return chain({ data: duracaoVideoSeg === null ? null : { videos: { duracao_seg: duracaoVideoSeg } } });
    }
    if (tabela === "ofertas") {
      const c: any = { ...ofertasOverrides };
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = () => Promise.resolve({ data: ofertasOverrides.dadosAtuais ?? null });
      c.upsert = ofertasOverrides.upsert ?? vi.fn().mockReturnValue(chain({ error: null }));
      return c;
    }
    throw new Error("tabela inesperada: " + tabela);
  });
}

describe("salvarOferta", () => {
  it("exige admin antes de tudo", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { salvarOferta } = await import("../app/(painel)/webinars/[id]/oferta/actions");
    await expect(salvarOferta("webinar-1", {}, form(CAMPOS_OFERTA))).rejects.toThrow("Só administradores podem fazer isso.");
    expect(dbUsuario).not.toHaveBeenCalled();
  });

  it("tempo além da duração do vídeo → erro", async () => {
    dbUsuario.mockResolvedValue({ from: fromOferta(30) });
    const { salvarOferta } = await import("../app/(painel)/webinars/[id]/oferta/actions");
    const r = await salvarOferta("webinar-1", {}, form(CAMPOS_OFERTA));
    expect(r.erro).toBe("Os tempos não podem passar da duração do vídeo (h:mm:ss).");
  });

  it("some antes de aparecer → erro", async () => {
    dbUsuario.mockResolvedValue({ from: fromOferta(null) });
    const { salvarOferta } = await import("../app/(painel)/webinars/[id]/oferta/actions");
    const campos = { ...CAMPOS_OFERTA, some: "0:30" };
    const r = await salvarOferta("webinar-1", {}, form(campos));
    expect(r.erro).toBe("A oferta precisa sumir depois de aparecer.");
  });

  it("sorteio ligado sem número → erro", async () => {
    dbUsuario.mockResolvedValue({ from: fromOferta(null) });
    const { salvarOferta } = await import("../app/(painel)/webinars/[id]/oferta/actions");
    const campos = { ...CAMPOS_OFERTA, sorteio_ligado: "on", sorteio_momento: "2:00", sorteio_numero: "" };
    const r = await salvarOferta("webinar-1", {}, form(campos));
    expect(r.erro).toBe("O número do sorteio tem de 1 a 6 dígitos.");
  });

  it("sucesso com banner → envia a imagem e grava a nova url", async () => {
    enviarImagem.mockResolvedValue({ url: "https://x/banner-novo.jpg" });
    const upsert = vi.fn().mockReturnValue(chain({ error: null }));
    dbUsuario.mockResolvedValue({ from: fromOferta(null, { upsert }) });

    const { salvarOferta } = await import("../app/(painel)/webinars/[id]/oferta/actions");
    const arquivo = arquivoFalso(1000);
    const r = await salvarOferta("webinar-1", {}, form(CAMPOS_OFERTA, { banner: arquivo }));

    expect(r.ok).toBe(true);
    expect(enviarImagem).toHaveBeenCalledWith("webinar-1", arquivo);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ webinar_id: "webinar-1", banner_url: "https://x/banner-novo.jpg", nome: "Oferta X", titulo: "Título Y" }),
      { onConflict: "webinar_id" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/webinars/webinar-1/oferta");
  });

  it("oferta desligada com nome/título vazios → grava vazio, não null (coluna NOT NULL)", async () => {
    const upsert = vi.fn().mockReturnValue(chain({ error: null }));
    dbUsuario.mockResolvedValue({ from: fromOferta(null, { upsert }) });

    const { salvarOferta } = await import("../app/(painel)/webinars/[id]/oferta/actions");
    const campos = { ...CAMPOS_OFERTA, ligada: "", nome: "", titulo: "", link: "" };
    const r = await salvarOferta("webinar-1", {}, form(campos));

    expect(r.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ ligada: false, nome: "", titulo: "" }),
      { onConflict: "webinar_id" },
    );
  });
});

const CAMPOS_CHATBOT = { remetente: "Suporte", palavra_chave: "preço valor", resposta: "O valor está na oferta!", atraso_seg: "5" };

