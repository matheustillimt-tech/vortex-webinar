import { describe, expect, it } from "vitest";
import {
  camposLinkMagico,
  caminhoPublico,
  decidirEntrada,
  tipoEventoDeEntrada,
  ehBotDePreview,
  formatoDoVideo,
  linkComUtms,
  origemDoRedirecionamento,
  sanitizarTitulo,
  slugValido,
  utmsDaUrl,
  validarCadastro,
  type EntradaSala,
} from "@/src/lib/regras/sala";

describe("camposLinkMagico", () => {
  it("ignora placeholders não substituídos", () => {
    expect(camposLinkMagico({ nome: "{{nome}}", email: "EMAIL_USUARIO", telefone: "telefone" })).toEqual({});
  });

  it("aceita valores reais", () => {
    expect(camposLinkMagico({ nome: "Ana", email: "ana@x.com", telefone: "+5511900008888" })).toEqual({
      nome: "Ana",
      email: "ana@x.com",
      telefone: "+5511900008888",
    });
  });

  it("campo ausente não entra no resultado", () => {
    expect(camposLinkMagico({ nome: "Ana" })).toEqual({ nome: "Ana" });
  });

  it("placeholder em qualquer caixa é ignorado", () => {
    expect(camposLinkMagico({ nome: "NOME_USUARIO" })).toEqual({});
  });
});

describe("utmsDaUrl", () => {
  it("filtra só utm_*", () => {
    expect(utmsDaUrl({ utm_source: "ig", outro: "x" })).toEqual({ utm_source: "ig" });
  });

  it("corta valores em 200 caracteres", () => {
    const longo = "a".repeat(250);
    expect(utmsDaUrl({ utm_source: longo }).utm_source).toHaveLength(200);
  });

  it("limite de 10 chaves", () => {
    const q: Record<string, string> = {};
    for (let i = 0; i < 15; i++) q[`utm_campo_${i}`] = String(i);
    expect(Object.keys(utmsDaUrl(q))).toHaveLength(10);
  });
});

describe("validarCadastro", () => {
  const regrasBase = { pedeEmail: true, emailObrigatorio: true, pedeTelefone: false, telefoneObrigatorio: false, paisPadrao: "BR" };

  it("nome vazio", () => {
    expect(validarCadastro({ nome: "  ", email: "a@b.com" }, regrasBase)).toEqual({ erro: "Informe seu nome." });
  });

  it("nome com mais de 80 caracteres", () => {
    expect(validarCadastro({ nome: "a".repeat(81), email: "a@b.com" }, regrasBase)).toEqual({ erro: "Informe seu nome." });
  });

  it("e-mail sai sem espaço e em minúsculas (o checkout casa a venda por igualdade exata)", () => {
    expect(validarCadastro({ nome: "Ana", email: "  Ana.Souza@Exemplo.COM " }, regrasBase)).toEqual({
      dados: { nome: "Ana", email: "ana.souza@exemplo.com", telefone: null },
    });
  });

  it("e-mail não pedido: dados.email é null mesmo que venha preenchido", () => {
    const r = validarCadastro({ nome: "Ana", email: "a@b.com" }, { ...regrasBase, pedeEmail: false });
    expect(r).toEqual({ dados: { nome: "Ana", email: null, telefone: null } });
  });

  it("e-mail pedido mas opcional e vazio: null, sem erro", () => {
    const r = validarCadastro({ nome: "Ana" }, { ...regrasBase, emailObrigatorio: false });
    expect(r).toEqual({ dados: { nome: "Ana", email: null, telefone: null } });
  });

  it("e-mail obrigatório e vazio: erro", () => {
    expect(validarCadastro({ nome: "Ana" }, regrasBase)).toEqual({ erro: "Informe um e-mail válido." });
  });

  it("e-mail inválido: erro", () => {
    expect(validarCadastro({ nome: "Ana", email: "não-é-email" }, regrasBase)).toEqual({ erro: "Informe um e-mail válido." });
  });

  it("telefone obrigatório e vazio: erro", () => {
    const regras = { ...regrasBase, pedeEmail: false, emailObrigatorio: false, pedeTelefone: true, telefoneObrigatorio: true };
    expect(validarCadastro({ nome: "Ana" }, regras)).toEqual({ erro: "Informe um WhatsApp válido." });
  });

  it("telefone válido converte para E.164", () => {
    const regras = { ...regrasBase, pedeEmail: false, emailObrigatorio: false, pedeTelefone: true, telefoneObrigatorio: true };
    const r = validarCadastro({ nome: "Ana", telefone: "11987654321" }, regras);
    expect(r).toEqual({ dados: { nome: "Ana", email: null, telefone: "+5511987654321" } });
  });

  it("telefone inválido: erro", () => {
    const regras = { ...regrasBase, pedeEmail: false, emailObrigatorio: false, pedeTelefone: true, telefoneObrigatorio: true };
    expect(validarCadastro({ nome: "Ana", telefone: "123" }, regras)).toEqual({ erro: "Informe um WhatsApp válido." });
  });

  it("telefone pedido mas opcional e vazio: null, sem erro", () => {
    const regras = { ...regrasBase, pedeTelefone: true, telefoneObrigatorio: false };
    const r = validarCadastro({ nome: "Ana", email: "a@b.com" }, regras);
    expect(r).toEqual({ dados: { nome: "Ana", email: "a@b.com", telefone: null } });
  });

  it("tudo certo", () => {
    expect(validarCadastro({ nome: "Ana", email: "ana@x.com" }, regrasBase)).toEqual({
      dados: { nome: "Ana", email: "ana@x.com", telefone: null },
    });
  });
});

describe("formatoDoVideo", () => {
  it("m3u8 -> hls", () => expect(formatoDoVideo("https://x.com/a.m3u8")).toBe("hls"));
  it("mp4 -> mp4", () => expect(formatoDoVideo("https://x.com/a.mp4")).toBe("mp4"));
  it("url inválida cai no padrão hls", () => expect(formatoDoVideo("não é url")).toBe("hls"));
  it("extensão desconhecida cai no padrão hls", () => expect(formatoDoVideo("https://x.com/a.mov")).toBe("hls"));
});

describe("linkComUtms", () => {
  it("acrescenta utms sem sobrescrever o que já existe", () => {
    const r = linkComUtms("https://x.com/checkout?utm_source=ja-tinha", { utm_source: "novo", utm_medium: "sala" });
    const u = new URL(r);
    expect(u.searchParams.get("utm_source")).toBe("ja-tinha");
    expect(u.searchParams.get("utm_medium")).toBe("sala");
  });

  it("preserva o hash", () => {
    const r = linkComUtms("https://x.com/checkout#secao", { utm_source: "sala" });
    expect(r).toContain("#secao");
    expect(new URL(r).hash).toBe("#secao");
  });

  it("link inválido: devolve como veio", () => {
    expect(linkComUtms("não é url", { utm_source: "x" })).toBe("não é url");
  });
});

describe("sanitizarTitulo", () => {
  it("remove script e onclick", () => {
    const r = sanitizarTitulo('<p onclick="alert(1)">Oi<script>alert(1)</script></p>');
    expect(r).not.toContain("script");
    expect(r).not.toContain("onclick");
    expect(r).toContain("Oi");
  });

  it("remove img", () => {
    expect(sanitizarTitulo('<img src="x.png">texto')).not.toContain("img");
  });

  it("mantém strong e o alinhamento de texto", () => {
    const r = sanitizarTitulo('<p style="text-align: center; color: red;"><strong>Oi</strong></p>');
    expect(r).toContain("<strong>Oi</strong>");
    expect(r).toContain("text-align:center");
    expect(r).not.toContain("color");
  });
});

describe("decidirEntrada", () => {
  const base: EntradaSala = {
    webinarAtivo: true,
    temVideo: true,
    estado: "aberta",
    replay: false,
    teste: false,
    temSessao: false,
    cheia: false,
    acessoFacilitado: false,
    linkMagicoValido: false,
  };

  it("webinar inativo -> indisponivel", () => {
    expect(decidirEntrada({ ...base, webinarAtivo: false })).toBe("indisponivel");
  });

  it("sem vídeo -> indisponivel", () => {
    expect(decidirEntrada({ ...base, temVideo: false })).toBe("indisponivel");
  });

  it("inativo e sem vídeo ao mesmo tempo -> indisponivel (não quebra)", () => {
    expect(decidirEntrada({ ...base, webinarAtivo: false, temVideo: false })).toBe("indisponivel");
  });

  it("teste sem sessão -> criar_sessao_teste", () => {
    expect(decidirEntrada({ ...base, teste: true })).toBe("criar_sessao_teste");
  });

  it("teste com sessão normal no cookie -> sessão de teste nova mesmo assim", () => {
    expect(decidirEntrada({ ...base, teste: true, temSessao: true })).toBe("criar_sessao_teste");
  });

  it("teste vence espera/encerrada/cheia", () => {
    expect(decidirEntrada({ ...base, teste: true, estado: "espera", cheia: true })).toBe("criar_sessao_teste");
    expect(decidirEntrada({ ...base, teste: true, estado: "encerrada" })).toBe("criar_sessao_teste");
  });

  it("teste não fura webinar inativo/sem vídeo", () => {
    expect(decidirEntrada({ ...base, teste: true, webinarAtivo: false })).toBe("indisponivel");
  });

  it("replay sem sessão -> login", () => {
    expect(decidirEntrada({ ...base, replay: true })).toBe("login");
  });

  it("replay com sessão -> sala", () => {
    expect(decidirEntrada({ ...base, replay: true, temSessao: true })).toBe("sala");
  });

  it("replay vence espera/encerrada", () => {
    expect(decidirEntrada({ ...base, replay: true, estado: "encerrada" })).toBe("login");
  });

  it("com sessão válida (estado aberta) -> sala", () => {
    expect(decidirEntrada({ ...base, temSessao: true })).toBe("sala");
  });

  it("sessão válida vence cheia/link mágico/acesso facilitado", () => {
    expect(decidirEntrada({ ...base, temSessao: true, cheia: true, linkMagicoValido: true, acessoFacilitado: true })).toBe("sala");
  });

  it("estado espera -> espera", () => {
    expect(decidirEntrada({ ...base, estado: "espera" })).toBe("espera");
  });

  it("estado espera com sessão -> sala (só \"encerrada\" vence sessão, não \"espera\")", () => {
    expect(decidirEntrada({ ...base, estado: "espera", temSessao: true })).toBe("sala");
  });

  it("estado encerrada -> encerrada", () => {
    expect(decidirEntrada({ ...base, estado: "encerrada" })).toBe("encerrada");
  });

  it("estado encerrada vence sessão válida (mostra a tela de encerrada, com o link de replay)", () => {
    expect(decidirEntrada({ ...base, estado: "encerrada", temSessao: true })).toBe("encerrada");
  });

  it("estado encerrada vence sessão, cheia, link mágico e acesso facilitado", () => {
    expect(
      decidirEntrada({ ...base, estado: "encerrada", temSessao: true, cheia: true, linkMagicoValido: true, acessoFacilitado: true }),
    ).toBe("encerrada");
  });

  it("cheia -> cheia", () => {
    expect(decidirEntrada({ ...base, cheia: true })).toBe("cheia");
  });

  it("cheia vence link mágico e acesso facilitado", () => {
    expect(decidirEntrada({ ...base, cheia: true, linkMagicoValido: true, acessoFacilitado: true })).toBe("cheia");
  });

  it("link mágico válido -> criar_sessao_magica", () => {
    expect(decidirEntrada({ ...base, linkMagicoValido: true })).toBe("criar_sessao_magica");
  });

  it("link mágico vence acesso facilitado", () => {
    expect(decidirEntrada({ ...base, linkMagicoValido: true, acessoFacilitado: true })).toBe("criar_sessao_magica");
  });

  it("acesso facilitado -> criar_sessao_provisoria", () => {
    expect(decidirEntrada({ ...base, acessoFacilitado: true })).toBe("criar_sessao_provisoria");
  });

  it("nenhuma condição -> login", () => {
    expect(decidirEntrada(base)).toBe("login");
  });
});

describe("caminhoPublico", () => {
  it("host da sala -> /<slug>/<sufixo>", () => {
    expect(caminhoPublico("aovivo.exemplo.com", "aovivo.exemplo.com", "turma-1", "sala")).toBe("/turma-1/sala");
  });

  it("outro host (painel, localhost) -> /s/<slug>/<sufixo>", () => {
    expect(caminhoPublico("painel.exemplo.com", "aovivo.exemplo.com", "turma-1", "sala")).toBe("/s/turma-1/sala");
  });

  it("ignora a porta do host", () => {
    expect(caminhoPublico("aovivo.exemplo.com:3000", "aovivo.exemplo.com", "turma-1", "")).toBe("/turma-1");
  });

  it("é case-insensitive na comparação do host", () => {
    expect(caminhoPublico("AoVivo.Exemplo.com", "aovivo.exemplo.com", "turma-1", "")).toBe("/turma-1");
  });

  it("sem sufixo: sem barra sobrando", () => {
    expect(caminhoPublico("painel.exemplo.com", "aovivo.exemplo.com", "turma-1")).toBe("/s/turma-1");
  });

  it("hostSala vazio (variável não configurada): sempre /s/<slug>", () => {
    expect(caminhoPublico("qualquer.com", "", "turma-1", "entrar")).toBe("/s/turma-1/entrar");
  });

  it("open redirect: slug \"/evil.com\" (como o Next decodifica /s/%2Fevil.com) nunca vira //evil.com", () => {
    const r = caminhoPublico("aovivo.exemplo.com", "aovivo.exemplo.com", "/evil.com", "entrar");
    expect(r).toBe("/");
    expect(r.startsWith("//")).toBe(false);
  });

  it("slug com protocolo embutido também é rejeitado", () => {
    expect(caminhoPublico("painel.exemplo.com", "aovivo.exemplo.com", "https://evil.com", "")).toBe("/");
  });
});

describe("slugValido", () => {
  it("aceita letras minúsculas, dígitos e hífen", () => {
    expect(slugValido("turma-1-2026")).toBe(true);
  });

  it("rejeita barra (caminho de outro host disfarçado de slug)", () => {
    expect(slugValido("/evil.com")).toBe(false);
  });

  it("rejeita menos de 3 caracteres", () => {
    expect(slugValido("ab")).toBe(false);
  });

  it("rejeita mais de 60 caracteres", () => {
    expect(slugValido("a".repeat(61))).toBe(false);
  });

  it("rejeita letra maiúscula", () => {
    expect(slugValido("Turma-1")).toBe(false);
  });

  it("rejeita espaço e caracteres especiais", () => {
    expect(slugValido("turma 1")).toBe(false);
    expect(slugValido("turma?.1")).toBe(false);
  });
});

describe("ehBotDePreview", () => {
  it("detecta os bots de preview mais comuns", () => {
    const bots = [
      "WhatsApp/2.23",
      "facebookexternalhit/1.1",
      "Facebot",
      "Slackbot-LinkExpanding 1.0",
      "TelegramBot (like TwitterBot)",
      "Twitterbot/1.0",
      "LinkedInBot/1.0",
      "Mozilla/5.0 (compatible; Discordbot/2.0;)",
      "Googlebot/2.1",
      "Mozilla/5.0 (compatible; bingbot/2.0;)",
      "Applebot/0.1",
    ];
    for (const ua of bots) expect(ehBotDePreview(ua)).toBe(true);
  });

  it("navegador comum não é bot", () => {
    expect(ehBotDePreview("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15")).toBe(false);
  });

  it("sem User-Agent não é bot", () => {
    expect(ehBotDePreview(null)).toBe(false);
  });
});

describe("tipoEventoDeEntrada", () => {
  it("link mágico vence tudo", () => {
    expect(tipoEventoDeEntrada({ linkMagico: true, temporario: false, loginNaSala: false })).toBe("link_magico");
    expect(tipoEventoDeEntrada({ linkMagico: true, temporario: true, loginNaSala: true })).toBe("link_magico");
  });
  it("cadastro completo pelo formulário: sempre fez_login", () => {
    expect(tipoEventoDeEntrada({ linkMagico: false, temporario: false, loginNaSala: false })).toBe("fez_login");
    expect(tipoEventoDeEntrada({ linkMagico: false, temporario: false, loginNaSala: true })).toBe("fez_login");
  });
  it("provisória: sem_login sem cadastro na sala, login_provisorio com", () => {
    expect(tipoEventoDeEntrada({ linkMagico: false, temporario: true, loginNaSala: false })).toBe("sem_login");
    expect(tipoEventoDeEntrada({ linkMagico: false, temporario: true, loginNaSala: true })).toBe("login_provisorio");
  });
});

describe("origemDoRedirecionamento", () => {
  it("Host = domínio da sala: usa a origem configurada, não a do req.url (no next dev ela vem como localhost)", () => {
    expect(origemDoRedirecionamento("http://localhost:3150/s/turma-1/entrar", "sala.localhost:3150", "http://sala.localhost:3150")).toBe(
      "http://sala.localhost:3150",
    );
    expect(origemDoRedirecionamento("http://localhost:3000/s/a/entrar", "AOVIVO.exemplo.com", "https://aovivo.exemplo.com")).toBe(
      "https://aovivo.exemplo.com",
    );
  });

  it("outro Host (painel, dev sem domínio da sala) ou sem configuração: origem do req.url", () => {
    expect(origemDoRedirecionamento("http://localhost:3150/s/a/entrar", "localhost:3150", "http://sala.localhost:3150")).toBe("http://localhost:3150");
    expect(origemDoRedirecionamento("http://localhost:3150/s/a/entrar", "evil.com", "http://sala.localhost:3150")).toBe("http://localhost:3150");
    expect(origemDoRedirecionamento("http://localhost:3150/s/a/entrar", null, "http://sala.localhost:3150")).toBe("http://localhost:3150");
    expect(origemDoRedirecionamento("https://aovivo.exemplo.com/s/a/entrar", "aovivo.exemplo.com", undefined)).toBe("https://aovivo.exemplo.com");
    expect(origemDoRedirecionamento("https://aovivo.exemplo.com/s/a/entrar", "aovivo.exemplo.com", "não é url")).toBe("https://aovivo.exemplo.com");
  });
});
