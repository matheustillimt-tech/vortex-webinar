import { beforeEach, describe, expect, it, vi } from "vitest";

const registrarAuditoria = vi.fn();
let banco: BancoFalso;

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => banco }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));
vi.mock("@/src/lib/sala/sessao", () => ({ tokenTeste: () => "token-teste" }));

process.env.NEXT_PUBLIC_PAINEL_URL = "https://painel.teste";
process.env.NEXT_PUBLIC_SALA_URL = "https://sala.teste";

// ---------------------------------------------------------------------------
// Banco falso: cada `from(tabela)` grava a cadeia de chamadas e resolve pelo `responder` da tabela.
// ---------------------------------------------------------------------------

type Op = { metodo: string; args: unknown[] };
type Cadeia = { tabela: string; ops: Op[] };
type Resposta = { data?: unknown; error?: unknown; count?: number };
type Responder = (c: Cadeia) => Resposta;

class BancoFalso {
  cadeias: Cadeia[] = [];
  constructor(private respostas: Record<string, Responder | Resposta>) {}

  from(tabela: string) {
    const cadeia: Cadeia = { tabela, ops: [] };
    this.cadeias.push(cadeia);
    const resolver = () => {
      const r = this.respostas[tabela];
      if (!r) throw new Error(`tabela inesperada: ${tabela}`);
      return Promise.resolve({ data: null, error: null, ...(typeof r === "function" ? r(cadeia) : r) });
    };
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "like", "ilike", "order", "range", "limit", "maybeSingle", "single", "insert", "upsert", "update", "delete"]) {
      c[m] = (...args: unknown[]) => {
        cadeia.ops.push({ metodo: m, args });
        return c;
      };
    }
    c.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => resolver().then(ok, falha);
    return c;
  }

  /** Primeiro argumento do método de escrita (`upsert`, `update`, `insert`) na tabela. */
  escrita(tabela: string, metodo: string): unknown {
    for (const c of this.cadeias) if (c.tabela === tabela) for (const o of c.ops) if (o.metodo === metodo) return o.args[0];
    return undefined;
  }
}

const tem = (c: Cadeia, metodo: string) => c.ops.some((o) => o.metodo === metodo);
const eqDe = (c: Cadeia, coluna: string) => c.ops.find((o) => o.metodo === "eq" && o.args[0] === coluna)?.args[1];

const W = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const CHAVE = { id: "chave-1", nome: "Claude", permissao: "escrita" as const, usuarioId: "usuario-1" };

const WEBINAR = { id: W, nome: "Aula", slug: "aula", tipo_agenda: "unica", idioma: "pt-BR", status: "ativo" };

const OFERTA = {
  ligada: true,
  nome: "Curso",
  titulo: "Oferta especial",
  preco_original: "R$ 1.997",
  preco_oferta: "R$ 997",
  botao_texto: "Quero",
  botao_cor: "#02890b",
  banner_url: "https://x/banner.jpg",
  banner_mobile_url: null,
  link: "https://pay.exemplo.com/curso",
  repassar_utms: true,
  aparece_seg: 1800,
  some_seg: 3600,
  pitch_seg: 1700,
  contagem_seg: 300,
  contagem_layout: "urgente",
  sorteio_ligado: false,
  sorteio_seg: null,
  sorteio_numero: null,
};

async function ferramenta(nome: string) {
  const { FERRAMENTAS_WEBINARS } = await import("@/src/lib/mcp/ferramentas/webinars");
  const f = FERRAMENTAS_WEBINARS.find((x) => x.name === nome);
  if (!f) throw new Error(`ferramenta ${nome} não existe`);
  return f;
}

const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

beforeEach(() => {
  registrarAuditoria.mockReset();
});

// ---------------------------------------------------------------------------
// Mesclagem (a base da atualização parcial)
// ---------------------------------------------------------------------------

describe("mesclarCampos", () => {
  it("sobrepõe só o que veio: false desliga, null limpa, undefined mantém", async () => {
    const { mesclarCampos } = await import("@/src/lib/mcp/ferramentas/webinars-campos");
    const r = mesclarCampos({ ligada: "on", nome: "Curso", link: "https://a", preco: "R$ 1" }, { ligada: false, nome: undefined, link: null, preco: "R$ 2" });
    expect(r).toEqual({ campos: { ligada: "", nome: "Curso", link: "", preco: "R$ 2" } });
  });

  it("segundos viram h:mm:ss nos campos de tempo; número comum vira texto", async () => {
    const { mesclarCampos } = await import("@/src/lib/mcp/ferramentas/webinars-campos");
    const r = mesclarCampos({ aparece: "1:00", maximo: "" }, { aparece: 3725, maximo: 500 }, { tempos: ["aparece"] });
    expect(r).toEqual({ campos: { aparece: "1:02:05", maximo: "500" } });
  });

  it("campo que o formulário não tem → erro; ignorados passam", async () => {
    const { mesclarCampos } = await import("@/src/lib/mcp/ferramentas/webinars-campos");
    expect(mesclarCampos({ nome: "a" }, { nmoe: "b" })).toEqual({ erro: "Campo desconhecido: nmoe." });
    expect(mesclarCampos({ nome: "a" }, { webinar_id: W }, { ignorar: ["webinar_id"] })).toEqual({ campos: { nome: "a" } });
  });

  it("agenda com repetição: 'Começar em' sai do inicio, início/fim não vão pro validador", async () => {
    const { camposAgenda, camposAgendaParaEnvio } = await import("@/src/lib/mcp/ferramentas/webinars-campos");
    const c = camposAgenda({
      fuso: "America/Sao_Paulo",
      inicio: "2026-11-01T03:00:00.000Z",
      fim: null,
      repeticao: "semanal",
      dia_semana: 3,
      hora_inicio: "20:00:00",
      hora_fim: "22:00:00",
      vigencia_fim: null,
      usar_sala_espera: false,
    });
    expect(c).toMatchObject({ repeticao: "semanal", comeca_em: "2026-11-01", dia_semana: "3", hora_inicio: "20:00", hora_fim: "22:00", usar_sala_espera: "" });
    const envio = camposAgendaParaEnvio(c);
    expect(envio).not.toHaveProperty("inicio");
    expect(envio).not.toHaveProperty("fim");
    expect(camposAgendaParaEnvio({ ...c, repeticao: "nenhuma" })).not.toHaveProperty("vigencia_fim");
  });
});

// ---------------------------------------------------------------------------
// Ferramentas de escrita
// ---------------------------------------------------------------------------

describe("salvar_oferta", () => {
  function bancoOferta(oferta: unknown = OFERTA, duracao: number | null = 4000) {
    return new BancoFalso({
      webinars: { data: WEBINAR },
      webinar_video: { data: duracao === null ? null : { videos: { duracao_seg: duracao } } },
      ofertas: (c) => (tem(c, "upsert") ? { error: null } : { data: oferta }),
    });
  }

  it("muda só o preço: o resto da oferta continua igual e vai inteiro pro upsert", async () => {
    banco = bancoOferta();
    const f = await ferramenta("salvar_oferta");
    const r = await f.executar(CHAVE, { webinar_id: W, preco_oferta: "R$ 497" });
    expect(r.isError).toBeUndefined();
    const { banner_mobile_url: _b, ...resto } = OFERTA;
    expect(banco.escrita("ofertas", "upsert")).toEqual({ ...resto, webinar_id: W, banner_mobile_url: null, preco_oferta: "R$ 497" });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: "usuario-1", webinarId: W, acao: "editou", descricao: "Editou a oferta (MCP)", antes: OFERTA }),
    );
    expect(json(r).salvo.preco_oferta).toBe("R$ 497");
  });

  it("aceita segundos nos tempos", async () => {
    banco = bancoOferta();
    const f = await ferramenta("salvar_oferta");
    await f.executar(CHAVE, { webinar_id: W, aparece: 1200, pitch: "18:00" });
    expect(banco.escrita("ofertas", "upsert")).toMatchObject({ aparece_seg: 1200, pitch_seg: 1080, some_seg: 3600 });
  });

  it("usa o validador do painel: ligar sem link → erro e nada gravado", async () => {
    banco = bancoOferta(null);
    const f = await ferramenta("salvar_oferta");
    const r = await f.executar(CHAVE, { webinar_id: W, nome: "Curso", titulo: "Oferta" });
    expect(r).toEqual({ content: [{ type: "text", text: "Use um link https para o checkout." }], isError: true });
    expect(banco.escrita("ofertas", "upsert")).toBeUndefined();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("tempo depois do fim do vídeo → erro do validador", async () => {
    banco = bancoOferta(OFERTA, 1000);
    const f = await ferramenta("salvar_oferta");
    const r = await f.executar(CHAVE, { webinar_id: W, preco_oferta: "R$ 1" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Os tempos não podem passar da duração do vídeo (h:mm:ss).");
  });

  it("banner por URL: https troca, \"\" tira, outro protocolo → erro", async () => {
    banco = bancoOferta();
    const f = await ferramenta("salvar_oferta");
    await f.executar(CHAVE, { webinar_id: W, banner_url: "", banner_mobile_url: "https://cdn/m.png" });
    expect(banco.escrita("ofertas", "upsert")).toMatchObject({ banner_url: null, banner_mobile_url: "https://cdn/m.png" });

    banco = bancoOferta();
    const r = await f.executar(CHAVE, { webinar_id: W, banner_url: "http://inseguro/b.png" });
    expect(r.isError).toBe(true);
    expect(banco.escrita("ofertas", "upsert")).toBeUndefined();
  });

  it("id inválido ou inexistente → Webinar não encontrado", async () => {
    banco = new BancoFalso({ webinars: { data: null } });
    const f = await ferramenta("salvar_oferta");
    expect((await f.executar(CHAVE, { webinar_id: "abc" })).content[0].text).toBe("Webinar não encontrado.");
    expect(banco.cadeias).toHaveLength(0);
    expect((await f.executar(CHAVE, { webinar_id: W })).content[0].text).toBe("Webinar não encontrado.");
  });
});

describe("salvar_inicio", () => {
  const ATUAL = {
    nome: "Aula",
    titulo: "Aula ao vivo",
    slug: "aula",
    idioma: "pt-BR",
    apresentador_nome: "Paula",
    apresentador_avatar_url: "https://x/avatar.jpg",
    acesso_facilitado: true,
    login_na_sala: true,
    sincronizar_video: false,
  };

  it("desliga um booleano sem mexer no resto (mantém avatar)", async () => {
    banco = new BancoFalso({ webinars: (c) => (tem(c, "update") ? { error: null } : { data: ATUAL }) });
    const f = await ferramenta("salvar_inicio");
    const r = await f.executar(CHAVE, { webinar_id: W, login_na_sala: false });
    expect(r.isError).toBeUndefined();
    expect(banco.escrita("webinars", "update")).toEqual({ ...ATUAL, login_na_sala: false });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Editou o Início (MCP)" }));
  });

  it("slug em uso por outro webinar → erro", async () => {
    banco = new BancoFalso({ webinars: (c) => (eqDe(c, "slug") ? { data: { id: "outro" } } : { data: ATUAL }) });
    const f = await ferramenta("salvar_inicio");
    const r = await f.executar(CHAVE, { webinar_id: W, slug: "ocupado" });
    expect(r.content[0].text).toBe("Esse endereço já está em uso.");
    expect(banco.escrita("webinars", "update")).toBeUndefined();
  });

  it("nome vazio → erro do validador", async () => {
    banco = new BancoFalso({ webinars: { data: ATUAL } });
    const f = await ferramenta("salvar_inicio");
    expect((await f.executar(CHAVE, { webinar_id: W, nome: "  " })).content[0].text).toBe("Dê um nome ao webinar.");
  });
});

describe("salvar_agenda", () => {
  const AGENDA = {
    fuso: "America/Sao_Paulo",
    repeticao: "diaria",
    inicio: null,
    fim: null,
    dia_semana: null,
    hora_inicio: "19:00:00",
    hora_fim: "21:00:00",
    usar_sala_espera: true,
    vigencia_fim: null,
  };

  it("webinar just in time → pede mudar_tipo_agenda antes", async () => {
    banco = new BancoFalso({ webinars: { data: { ...WEBINAR, tipo_agenda: "jit" } } });
    const f = await ferramenta("salvar_agenda");
    const r = await f.executar(CHAVE, { webinar_id: W, hora_inicio: "20:00" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("mudar_tipo_agenda");
  });

  it("muda só a hora de início de uma repetição e atualiza o tipo", async () => {
    banco = new BancoFalso({ webinars: { data: { ...WEBINAR, tipo_agenda: "recorrente" } }, agendas: (c) => (tem(c, "upsert") ? {} : { data: AGENDA }) });
    const f = await ferramenta("salvar_agenda");
    const r = await f.executar(CHAVE, { webinar_id: W, hora_inicio: "20:30" });
    expect(r.isError).toBeUndefined();
    expect(banco.escrita("agendas", "upsert")).toEqual({ ...AGENDA, webinar_id: W, hora_inicio: "20:30", hora_fim: "21:00" });
    expect(banco.escrita("webinars", "update")).toEqual({ tipo_agenda: "recorrente" });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Editou a agenda (MCP)" }));
  });

  it("sessão única no fuso: data local vira UTC", async () => {
    banco = new BancoFalso({ webinars: { data: WEBINAR }, agendas: (c) => (tem(c, "upsert") ? {} : { data: null }) });
    const f = await ferramenta("salvar_agenda");
    const r = await f.executar(CHAVE, { webinar_id: W, inicio: "2026-11-10T20:00", fim: "2026-11-10T22:00" });
    expect(r.isError).toBeUndefined();
    expect(banco.escrita("agendas", "upsert")).toMatchObject({ repeticao: "nenhuma", inicio: "2026-11-10T23:00:00.000Z", fim: "2026-11-11T01:00:00.000Z" });
    expect(banco.escrita("webinars", "update")).toEqual({ tipo_agenda: "unica" });
  });

  it("trocar repetição pra sessão única sem início/fim → erro do validador", async () => {
    banco = new BancoFalso({ webinars: { data: WEBINAR }, agendas: { data: AGENDA } });
    const f = await ferramenta("salvar_agenda");
    expect((await f.executar(CHAVE, { webinar_id: W, repeticao: "nenhuma" })).content[0].text).toBe("Informe início e fim da sessão.");
  });
});

describe("salvar_tela_login e salvar_email_jit", () => {
  it("tela de login sem linha parte do padrão do painel", async () => {
    banco = new BancoFalso({ webinars: { data: WEBINAR }, telas_login: (c) => (tem(c, "upsert") ? {} : { data: null }) });
    const f = await ferramenta("salvar_tela_login");
    const r = await f.executar(CHAVE, { webinar_id: W, botao_texto: "Entrar agora", logo_url: "https://cdn/logo.png" });
    expect(r.isError).toBeUndefined();
    expect(banco.escrita("telas_login", "upsert")).toMatchObject({
      botao_texto: "Entrar agora",
      logo_url: "https://cdn/logo.png",
      barra_valor: 92,
      email_obrigatorio: true,
      placeholder_email: "Seu melhor e-mail",
    });
  });

  it("tela de login: tirar os dois obrigatórios → erro do validador", async () => {
    banco = new BancoFalso({ webinars: { data: WEBINAR }, telas_login: { data: null } });
    const f = await ferramenta("salvar_tela_login");
    expect((await f.executar(CHAVE, { webinar_id: W, email_obrigatorio: false })).content[0].text).toBe("Deixe e-mail ou WhatsApp como obrigatório.");
  });

  it("e-mail do JIT sem modelo salvo: muda só o assunto, o texto vem do padrão", async () => {
    banco = new BancoFalso({ webinars: { data: { ...WEBINAR, tipo_agenda: "jit" } }, emails_jit: (c) => (tem(c, "upsert") ? {} : { data: null }) });
    const f = await ferramenta("salvar_email_jit");
    const r = await f.executar(CHAVE, { webinar_id: W, tipo: "lembrete", assunto: "Falta pouco!" });
    expect(r.isError).toBeUndefined();
    const gravado = banco.escrita("emails_jit", "upsert") as { assunto: string; minutos_antes: number; modelo: { texto: string } };
    expect(gravado.assunto).toBe("Falta pouco!");
    expect(gravado.minutos_antes).toBe(60);
    expect(gravado.modelo.texto.length).toBeGreaterThan(10);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: 'Editou o e-mail "Lembrete" do just in time (MCP)' }));
  });
});

describe("vídeo, audiência e horários", () => {
  it("definir_video recusa vídeo que não está pronto", async () => {
    banco = new BancoFalso({ webinars: { data: WEBINAR }, webinar_video: { data: null }, videos: { data: { nome: "v", status: "processando", duracao_seg: null } } });
    const f = await ferramenta("definir_video");
    expect((await f.executar(CHAVE, { webinar_id: W, video_id: V })).content[0].text).toBe("Escolha um vídeo pronto.");
    expect(banco.escrita("webinar_video", "upsert")).toBeUndefined();
  });

  it("definir_video troca só a orientação mantendo o vídeo atual", async () => {
    banco = new BancoFalso({
      webinars: { data: WEBINAR },
      webinar_video: (c) => (tem(c, "upsert") ? {} : { data: { video_id: V, autoplay: false, tela_cheia: true, orientacao: "horizontal" } }),
      videos: { data: { nome: "Aula 1", status: "pronto", duracao_seg: 3600 } },
    });
    const f = await ferramenta("definir_video");
    await f.executar(CHAVE, { webinar_id: W, orientacao: "vertical" });
    expect(banco.escrita("webinar_video", "upsert")).toEqual({ webinar_id: W, video_id: V, autoplay: false, tela_cheia: true, orientacao: "vertical" });
  });

  it("salvar_audiencia: dinâmico com mínimo maior que o máximo → erro", async () => {
    banco = new BancoFalso({ webinars: { data: WEBINAR }, audiencias: { data: { modo: "dinamico", minimo: 100, maximo: 300, selo_ao_vivo: true } } });
    const f = await ferramenta("salvar_audiencia");
    expect((await f.executar(CHAVE, { webinar_id: W, minimo: 500 })).content[0].text).toBe("O mínimo não pode passar do máximo.");
  });

  it("adicionar_horario_jit valida contra os existentes (duplicado → erro)", async () => {
    banco = new BancoFalso({
      webinars: { data: WEBINAR },
      jit_config: { data: { fuso: "America/Sao_Paulo" } },
      jit_horarios: { data: [{ quando: "todo_dia", hora: "19:00:00", intervalo_min: null, data: null, dia_semana: null }] },
    });
    const f = await ferramenta("adicionar_horario_jit");
    expect((await f.executar(CHAVE, { webinar_id: W, quando: "todo_dia", hora: "19:00" })).content[0].text).toBe("Já existe um horário igual.");
  });
});

describe("ciclo de vida", () => {
  it("criar_webinar cria com slug do nome, agenda vazia e auditoria", async () => {
    banco = new BancoFalso({
      webinars: (c) => (tem(c, "insert") ? { data: { id: W } } : { data: [] }),
      agendas: { error: null },
    });
    const f = await ferramenta("criar_webinar");
    const r = await f.executar(CHAVE, { nome: "Aula de Março" });
    expect(json(r)).toMatchObject({ ok: true, id: W, slug: "aula-de-marco", link_sala: "https://sala.teste/aula-de-marco" });
    expect(banco.escrita("agendas", "insert")).toEqual({ webinar_id: W });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "criou", descricao: 'Criou o webinar "Aula de Março" (MCP)' }));
  });

  it("arquivar_webinar só muda o status (nunca exclui)", async () => {
    banco = new BancoFalso({ webinars: (c) => (tem(c, "update") ? {} : { data: WEBINAR }) });
    const f = await ferramenta("arquivar_webinar");
    await f.executar(CHAVE, { webinar_id: W });
    expect(banco.escrita("webinars", "update")).toEqual({ status: "arquivado" });
    expect(banco.cadeias.some((c) => tem(c, "delete"))).toBe(false);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Arquivou o webinar (MCP)" }));
  });

  it("leitura e escrita marcadas certo (chave de leitura é barrada nas de escrita)", async () => {
    const { FERRAMENTAS_WEBINARS } = await import("@/src/lib/mcp/ferramentas/webinars");
    const leitura = FERRAMENTAS_WEBINARS.filter((f) => !f.escrita).map((f) => f.name);
    expect(leitura.sort()).toEqual(["listar_tarjas", "listar_videos", "listar_webinars", "ver_webinar"]);
    for (const f of FERRAMENTAS_WEBINARS) {
      expect(f.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(f.annotations.readOnlyHint).toBe(!f.escrita);
    }
  });
});

describe("ver_webinar", () => {
  it("junta todos os passos com os campos no formato das salvar_*", async () => {
    banco = new BancoFalso({
      webinars: { data: { ...WEBINAR, titulo: null, apresentador_nome: null, apresentador_avatar_url: null, acesso_facilitado: false, login_na_sala: false, sincronizar_video: false } },
      agendas: { data: null },
      jit_config: { data: null },
      jit_horarios: { data: [] },
      emails_jit: { data: [] },
      telas_login: { data: null },
      webinar_video: { data: { video_id: V, autoplay: true, tela_cheia: false, orientacao: "horizontal", videos: { nome: "Aula 1", duracao_seg: 3725, status: "pronto" } } },
      ofertas: { data: OFERTA },
      audiencias: { data: null },
      agentes_ia: { data: { ligado: true, nome: "Ana" } },
      mensagens_simuladas: { count: 120 },
      vendas_simuladas: { count: 8 },
      regras: { count: 1 },
    });
    const f = await ferramenta("ver_webinar");
    const r = json(await f.executar(CHAVE, { webinar_id: W }));
    expect(r.oferta).toMatchObject({ aparece: "30:00", some: "1:00:00", pitch: "28:20", preco_oferta: "R$ 997", ligada: "on" });
    expect(r.video).toMatchObject({ nome: "Aula 1", duracao: "1:02:05" });
    expect(r.agente_ia).toEqual({ ligado: true, nome: "Ana" });
    expect(r.quantidades).toEqual({ chat_simulado: 120, vendas_simuladas: 8, regras: 1 });
    expect(r.pendencias).toEqual(["Nenhuma agenda salva", "Tela de login padrão (ainda não personalizada)"]);
    expect(r.links.sala.map((l: { url: string }) => l.url)).toEqual(
      expect.arrayContaining(["https://sala.teste/aula", "https://sala.teste/aula?replay=1", "https://sala.teste/aula?teste=token-teste"]),
    );
  });
});
