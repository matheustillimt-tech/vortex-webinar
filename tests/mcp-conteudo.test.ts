import { beforeEach, describe, expect, it, vi } from "vitest";

const registrarAuditoria = vi.fn();
const iaConfig = vi.fn();
const testarAgenteLib = vi.fn();
const iniciarGeracao = vi.fn();

type Chamada = { tabela: string; metodo: string; args: unknown[] };
let chamadas: Chamada[] = [];
let respostas: Record<string, unknown[]> = {};

/** Chain estilo Supabase: cada `from(tabela)` consome a próxima resposta da fila daquela tabela (padrão
 *  `{ data: null }`) e anota todos os métodos chamados. */
function chain(tabela: string, resultado: unknown) {
  const p: any = Promise.resolve(resultado);
  for (const m of ["select", "eq", "neq", "in", "gte", "lte", "order", "limit", "range", "insert", "update", "upsert", "delete"]) {
    p[m] = (...args: unknown[]) => {
      chamadas.push({ tabela, metodo: m, args });
      return p;
    };
  }
  p.maybeSingle = () => Promise.resolve(resultado);
  p.single = () => Promise.resolve(resultado);
  return p;
}
const from = vi.fn((tabela: string) => chain(tabela, (respostas[tabela] ?? []).shift() ?? { data: null }));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from }) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));
vi.mock("@/src/lib/env", () => ({
  iaConfig: (...a: unknown[]) => iaConfig(...a),
  env: (k: string) => (k === "NEXT_PUBLIC_PAINEL_URL" ? "https://painel.test" : "https://sala.test"),
}));
vi.mock("@/src/lib/agente", () => ({ testarAgente: (...a: unknown[]) => testarAgenteLib(...a) }));
vi.mock("@/src/lib/geracao", () => ({ iniciarGeracao: (...a: unknown[]) => iniciarGeracao(...a) }));

const W = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const CHAVE_ESCRITA = { id: "c1", nome: "Claude", permissao: "escrita" as const, usuarioId: "u1" };
const CHAVE_LEITURA = { ...CHAVE_ESCRITA, permissao: "leitura" as const };
const WEBINAR_OK = { data: { id: W } };

async function ferramenta(nome: string) {
  const { FERRAMENTAS_CONTEUDO } = await import("@/src/lib/mcp/ferramentas/conteudo");
  const f = FERRAMENTAS_CONTEUDO.find((x) => x.name === nome);
  if (!f) throw new Error("sem ferramenta " + nome);
  return f;
}
const textoDe = (r: { content: { text: string }[] }) => r.content[0].text;
const json = (r: { content: { text: string }[] }) => JSON.parse(textoDe(r));
const doMetodo = (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo);

beforeEach(() => {
  chamadas = [];
  respostas = {};
  from.mockClear();
  registrarAuditoria.mockReset();
  iaConfig.mockReset();
  iaConfig.mockReturnValue({ openrouterKey: "k", modelo: "m", elevenlabsKey: "e" });
  testarAgenteLib.mockReset();
  iniciarGeracao.mockReset();
});

describe("registro", () => {
  it("nomes únicos, schema fechado, escrita bate com as anotações", async () => {
    const { FERRAMENTAS_CONTEUDO } = await import("@/src/lib/mcp/ferramentas/conteudo");
    const nomes = FERRAMENTAS_CONTEUDO.map((f) => f.name);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const f of FERRAMENTAS_CONTEUDO) {
      expect(f.inputSchema.additionalProperties).toBe(false);
      expect(f.escrita).toBe(f.annotations.readOnlyHint === false);
    }
  });

  it("chave só de leitura não roda ferramenta de escrita", async () => {
    const { chamarFerramenta } = await import("@/src/lib/mcp/ferramentas");
    const f = await ferramenta("salvar_agente");
    const r = await chamarFerramenta(f, CHAVE_LEITURA, { webinar_id: W, ligado: true });
    expect(r.isError).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("agente", () => {
  it("webinar inexistente ou id inválido → erro", async () => {
    const f = await ferramenta("ver_agente");
    expect(textoDe(await f.executar(CHAVE_LEITURA, { webinar_id: "x" }))).toBe("Webinar não encontrado.");
    expect(textoDe(await f.executar(CHAVE_LEITURA, { webinar_id: W }))).toBe("Webinar não encontrado.");
  });

  it("ver_agente avisa quando a IA não está configurada", async () => {
    iaConfig.mockReturnValue(null);
    respostas = { webinars: [WEBINAR_OK], agentes_ia: [{ data: { ligado: true, nome: "Ana", instrucoes: null, contexto: "X", faq: null } }] };
    const r = json(await (await ferramenta("ver_agente")).executar(CHAVE_LEITURA, { webinar_id: W }));
    expect(r).toMatchObject({ ligado: true, nome: "Ana", ia_configurada: false });
    expect(r.aviso).toMatch(/não está configurada/);
  });

  it("salvar_agente mescla com o salvo, valida e audita", async () => {
    const atual = { ligado: false, nome: "Ana", instrucoes: "seja breve", contexto: "Curso X", faq: null };
    respostas = { webinars: [WEBINAR_OK], agentes_ia: [{ data: atual }, { error: null }] };
    const r = await (await ferramenta("salvar_agente")).executar(CHAVE_ESCRITA, { webinar_id: W, ligado: true, faq: "P: preço? R: no link" });
    expect(r.isError).toBeUndefined();
    const [upsert] = doMetodo("agentes_ia", "upsert");
    expect(upsert.args[0]).toEqual({ webinar_id: W, ligado: true, nome: "Ana", instrucoes: "seja breve", contexto: "Curso X", faq: "P: preço? R: no link" });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: "u1", webinarId: W, acao: "editou", descricao: "Editou o agente de IA (MCP)", antes: atual }),
    );
  });

  it("salvar_agente: null limpa e ausência de `ligado` mantém o atual", async () => {
    respostas = { webinars: [WEBINAR_OK], agentes_ia: [{ data: { ligado: true, nome: "Ana", instrucoes: "a", contexto: null, faq: null } }, { error: null }] };
    await (await ferramenta("salvar_agente")).executar(CHAVE_ESCRITA, { webinar_id: W, nome: null });
    expect(doMetodo("agentes_ia", "upsert")[0].args[0]).toMatchObject({ ligado: true, nome: null, instrucoes: "a" });
  });

  it("salvar_agente devolve o erro do validarAgente sem gravar", async () => {
    respostas = { webinars: [WEBINAR_OK], agentes_ia: [{ data: null }] };
    const r = await (await ferramenta("salvar_agente")).executar(CHAVE_ESCRITA, { webinar_id: W, nome: "x".repeat(61) });
    expect(r.isError).toBe(true);
    expect(textoDe(r)).toBe("Use até 60 caracteres no nome.");
    expect(doMetodo("agentes_ia", "upsert")).toHaveLength(0);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("testar_agente usa o salvo com as substituições do teste e não grava", async () => {
    respostas = { webinars: [WEBINAR_OK], agentes_ia: [{ data: { ligado: false, nome: "Ana", instrucoes: "i", contexto: "c", faq: null } }] };
    testarAgenteLib.mockResolvedValue({ resposta: "Oi!" });
    const r = json(await (await ferramenta("testar_agente")).executar(CHAVE_LEITURA, { webinar_id: W, pergunta: "quanto custa?", contexto: "novo" }));
    expect(testarAgenteLib).toHaveBeenCalledWith({ nome: "Ana", instrucoes: "i", contexto: "novo", faq: null }, "quanto custa?", { momentoSeg: null });
    expect(r).toMatchObject({ resposta: "Oi!", respondeu: true, agente_ligado: false });
    expect(doMetodo("agentes_ia", "upsert")).toHaveLength(0);
  });
});

describe("chatbot", () => {
  it("descontinuado: nenhuma ferramenta de chatbot no MCP", async () => {
    const { FERRAMENTAS_CONTEUDO } = await import("@/src/lib/mcp/ferramentas/conteudo");
    expect(FERRAMENTAS_CONTEUDO.filter((f) => f.name.includes("chatbot"))).toEqual([]);
  });
});

describe("chat simulado", () => {
  it("adicionar em lote: aceita momento e segundo, grava num insert só e audita", async () => {
    respostas = { webinars: [WEBINAR_OK], mensagens_simuladas: [{ error: null }] };
    const r = json(
      await (await ferramenta("adicionar_mensagens_chat")).executar(CHAVE_ESCRITA, {
        webinar_id: W,
        mensagens: [
          { momento: "1:02:03", nome: "Ana", texto: "Oi" },
          { segundo: 90, nome: "Bia", texto: "Top", suporte: true },
        ],
      }),
    );
    expect(r).toMatchObject({ ok: true, adicionadas: 2 });
    const inserts = doMetodo("mensagens_simuladas", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toEqual([
      { webinar_id: W, segundo: 3723, nome: "Ana", texto: "Oi", suporte: false },
      { webinar_id: W, segundo: 90, nome: "Bia", texto: "Top", suporte: true },
    ]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "criou", descricao: "Adicionou 2 mensagens no chat simulado (MCP)" }));
  });

  it("adicionar: uma inválida → nada gravado, erro com a posição", async () => {
    respostas = { webinars: [WEBINAR_OK] };
    const r = await (await ferramenta("adicionar_mensagens_chat")).executar(CHAVE_ESCRITA, {
      webinar_id: W,
      mensagens: [{ momento: "0:10", nome: "Ana", texto: "Oi" }, { nome: "Bia", texto: "sem momento" }],
    });
    expect(r.isError).toBe(true);
    expect(textoDe(r)).toContain("Mensagem 2: Informe o momento da mensagem (h:mm:ss).");
    expect(doMetodo("mensagens_simuladas", "insert")).toHaveLength(0);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("adicionar: mais de 2000 → erro", async () => {
    respostas = { webinars: [WEBINAR_OK] };
    const mensagens = Array.from({ length: 2001 }, () => ({ segundo: 1, nome: "A", texto: "b" }));
    const r = await (await ferramenta("adicionar_mensagens_chat")).executar(CHAVE_ESCRITA, { webinar_id: W, mensagens });
    expect(r.isError).toBe(true);
  });

  it("listar pagina e filtra por intervalo", async () => {
    respostas = { webinars: [WEBINAR_OK], mensagens_simuladas: [{ data: [{ id: ID, segundo: 65, nome: "Ana", texto: "Oi", suporte: false }], count: 3 }] };
    const r = json(await (await ferramenta("listar_chat_simulado")).executar(CHAVE_LEITURA, { webinar_id: W, de_segundo: 60, ate_segundo: "0:02:00", limite: 1, offset: 0 }));
    expect(r).toMatchObject({ total: 3, mostrando: 1, proximo_offset: 1 });
    expect(r.mensagens[0]).toMatchObject({ momento: "1:05", segundo: 65 });
    expect(doMetodo("mensagens_simuladas", "gte")[0].args).toEqual(["segundo", 60]);
    expect(doMetodo("mensagens_simuladas", "lte")[0].args).toEqual(["segundo", 120]);
    expect(doMetodo("mensagens_simuladas", "range")[0].args).toEqual([0, 0]);
  });

  it("editar mescla com o atual", async () => {
    respostas = { webinars: [WEBINAR_OK], mensagens_simuladas: [{ data: { id: ID, segundo: 30, nome: "Ana", texto: "Oi", suporte: true } }, { error: null }] };
    await (await ferramenta("editar_mensagem_chat")).executar(CHAVE_ESCRITA, { webinar_id: W, id: ID, texto: "Olá" });
    expect(doMetodo("mensagens_simuladas", "update")[0].args[0]).toEqual({ segundo: 30, nome: "Ana", texto: "Olá", suporte: true });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Editou uma mensagem do chat simulado (MCP)", antes: { segundo: 30, nome: "Ana", texto: "Oi", suporte: true } }));
  });

  it("excluir tudo exige confirmar", async () => {
    respostas = { webinars: [WEBINAR_OK, WEBINAR_OK], mensagens_simuladas: [{ count: 40, error: null }] };
    const f = await ferramenta("excluir_mensagens_chat");
    const sem = await f.executar(CHAVE_ESCRITA, { webinar_id: W, tudo: true });
    expect(sem.isError).toBe(true);
    expect(doMetodo("mensagens_simuladas", "delete")).toHaveLength(0);

    const com = json(await f.executar(CHAVE_ESCRITA, { webinar_id: W, tudo: true, confirmar: true }));
    expect(com).toMatchObject({ excluidas: 40 });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "excluiu", descricao: "Apagou 40 mensagens do chat simulado (MCP)" }));
  });

  it("excluir: sem critério ou com dois critérios → erro", async () => {
    respostas = { webinars: [WEBINAR_OK, WEBINAR_OK] };
    const f = await ferramenta("excluir_mensagens_chat");
    expect((await f.executar(CHAVE_ESCRITA, { webinar_id: W })).isError).toBe(true);
    expect((await f.executar(CHAVE_ESCRITA, { webinar_id: W, ids: [ID], de_segundo: 0 })).isError).toBe(true);
  });

  it("excluir por intervalo filtra pelo segundo", async () => {
    respostas = { webinars: [WEBINAR_OK], mensagens_simuladas: [{ count: 5, error: null }] };
    const r = json(await (await ferramenta("excluir_mensagens_chat")).executar(CHAVE_ESCRITA, { webinar_id: W, de_segundo: 600, ate_segundo: 1200 }));
    expect(r.excluidas).toBe(5);
    expect(doMetodo("mensagens_simuladas", "gte")[0].args).toEqual(["segundo", 600]);
    expect(doMetodo("mensagens_simuladas", "lte")[0].args).toEqual(["segundo", 1200]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Excluiu 5 mensagens do chat simulado (de 10:00 a 20:00) (MCP)" }));
  });
});

describe("chat com IA", () => {
  it("gerar_chat_ia valida opções e chama iniciarGeracao", async () => {
    respostas = { webinars: [WEBINAR_OK, WEBINAR_OK] };
    iniciarGeracao.mockResolvedValue({ ok: true });
    const f = await ferramenta("gerar_chat_ia");
    const ruim = await f.executar(CHAVE_ESCRITA, { webinar_id: W, tom: "bravo" });
    expect(textoDe(ruim)).toBe("Escolha o tom.");
    const r = await f.executar(CHAVE_ESCRITA, { webinar_id: W, intensidade: "alta" });
    expect(r.isError).toBeUndefined();
    expect(iniciarGeracao).toHaveBeenCalledWith(W, { idioma: "pt", tom: "natural", intensidade: "alta", instrucoes: null });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Iniciou uma geração de chat por IA (MCP)" }));
  });

  it("gerar_chat_ia repassa o erro de iniciarGeracao", async () => {
    respostas = { webinars: [WEBINAR_OK] };
    iniciarGeracao.mockResolvedValue({ erro: "Já tem uma geração em andamento para este webinar." });
    const r = await (await ferramenta("gerar_chat_ia")).executar(CHAVE_ESCRITA, { webinar_id: W });
    expect(textoDe(r)).toBe("Já tem uma geração em andamento para este webinar.");
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("ver_geracao_chat mostra o progresso", async () => {
    respostas = {
      webinars: [WEBINAR_OK],
      geracoes_chat: [{ data: { status: "gerando", idioma: "pt", tom: "natural", intensidade: "media", instrucoes: null, bloco_atual: 2, total_blocos: 6, mensagens_geradas: 30, erro: null, created_at: "2026-10-21T10:00:00Z" } }],
    };
    const r = json(await (await ferramenta("ver_geracao_chat")).executar(CHAVE_LEITURA, { webinar_id: W }));
    expect(r.geracao).toMatchObject({ status: "gerando", em_andamento: true, bloco_atual: 2, total_blocos: 6, mensagens_geradas: 30 });
  });
});

describe("vendas simuladas", () => {
  it("adicionar em lote valida com validarVendaSimulada", async () => {
    respostas = { webinars: [WEBINAR_OK, WEBINAR_OK], vendas_simuladas: [{ error: null }] };
    const f = await ferramenta("adicionar_vendas_simuladas");
    const ruim = await f.executar(CHAVE_ESCRITA, { webinar_id: W, vendas: [{ segundo: 10, texto: "x".repeat(201) }] });
    expect(textoDe(ruim)).toContain("Venda 1: Use até 200 caracteres.");

    const r = json(await f.executar(CHAVE_ESCRITA, { webinar_id: W, vendas: [{ momento: "30:00", texto: "Ana comprou" }] }));
    expect(r.adicionadas).toBe(1);
    expect(doMetodo("vendas_simuladas", "insert")[0].args[0]).toEqual([{ webinar_id: W, segundo: 1800, texto: "Ana comprou" }]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Adicionou uma venda simulada (MCP)" }));
  });

  it("título vazio volta pro padrão e audita antes/depois", async () => {
    respostas = { webinars: [{ data: { titulo_notificacao_compra: "Antigo" } }, { error: null }] };
    const r = json(await (await ferramenta("salvar_titulo_notificacao_compra")).executar(CHAVE_ESCRITA, { webinar_id: W, titulo: "  " }));
    expect(r.titulo_notificacao_compra).toBe("Venda confirmada!");
    expect(doMetodo("webinars", "update")[0].args[0]).toEqual({ titulo_notificacao_compra: "Venda confirmada!" });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ antes: { titulo_notificacao_compra: "Antigo" }, depois: { titulo_notificacao_compra: "Venda confirmada!" } }),
    );
  });

  it("excluir por ids em lotes", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`);
    respostas = { webinars: [WEBINAR_OK], vendas_simuladas: [{ count: 200, error: null }, { count: 50, error: null }] };
    const r = json(await (await ferramenta("excluir_vendas_simuladas")).executar(CHAVE_ESCRITA, { webinar_id: W, ids }));
    expect(r.excluidas).toBe(250);
    expect(doMetodo("vendas_simuladas", "in")).toHaveLength(2);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Excluiu 250 vendas simuladas (MCP)" }));
  });
});
