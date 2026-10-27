import { beforeEach, describe, expect, it, vi } from "vitest";
import { cifrar, decifrar } from "@/src/lib/crypto";

process.env.CRYPTO_KEY ??= Buffer.alloc(32, 5).toString("base64");
process.env.NEXT_PUBLIC_PAINEL_URL ??= "https://painel.teste";
process.env.NEXT_PUBLIC_SALA_URL ??= "https://sala.teste";

const registrarAuditoria = vi.fn();
const enviarTeste = vi.fn();
let handler: (tabela: string, ops: Op[]) => unknown = () => ({ data: null, error: null });
let chamadas: { tabela: string; ops: Op[] }[] = [];

type Op = [string, ...unknown[]];

vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));
vi.mock("@/src/lib/disparos", () => ({ enviarTeste: (...a: unknown[]) => enviarTeste(...a) }));
vi.mock("@/src/lib/supabase/admin", () => ({
  dbAdmin: () => ({
    from(tabela: string) {
      const ops: Op[] = [];
      chamadas.push({ tabela, ops });
      const b: any = {};
      for (const m of ["select", "eq", "neq", "in", "or", "ilike", "gte", "lt", "lte", "gt", "order", "range", "limit", "insert", "update", "delete", "upsert"]) {
        b[m] = (...a: unknown[]) => {
          ops.push([m, ...a]);
          return b;
        };
      }
      b.maybeSingle = () => {
        ops.push(["maybeSingle"]);
        return Promise.resolve(handler(tabela, ops));
      };
      b.single = () => {
        ops.push(["single"]);
        return Promise.resolve(handler(tabela, ops));
      };
      b.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(handler(tabela, ops)).then(ok, falha);
      return b;
    },
  }),
}));

const CHAVE_ESCRITA = { id: "chave-1", nome: "Claude", permissao: "escrita" as const, usuarioId: "usuario-1" };

const W = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const W2 = "33333333-3333-4333-8333-333333333333";
const T = "44444444-4444-4444-8444-444444444444";
const P = "55555555-5555-4555-8555-555555555555";

const tem = (ops: Op[], m: string) => ops.some((o) => o[0] === m);
const arg = (ops: Op[], m: string) => ops.find((o) => o[0] === m)?.[1];
const escritas = (tabela: string, m: string) => chamadas.filter((c) => c.tabela === tabela && tem(c.ops, m));

async function ferramenta(nome: string) {
  const { FERRAMENTAS_INTEGRACOES } = await import("@/src/lib/mcp/ferramentas/integracoes");
  const f = FERRAMENTAS_INTEGRACOES.find((x) => x.name === nome);
  if (!f) throw new Error(`ferramenta ${nome} não existe`);
  return f;
}

const textoDe = (r: { content: { text: string }[] }) => r.content[0].text;
const json = (r: { content: { text: string }[] }) => JSON.parse(textoDe(r));

beforeEach(() => {
  vi.resetModules();
  registrarAuditoria.mockReset();
  enviarTeste.mockReset();
  chamadas = [];
  handler = () => ({ data: null, error: null });
});

describe("cadastro das ferramentas", () => {
  it("leituras sem escrita, mudanças com escrita, nomes únicos e schema fechado", async () => {
    const { FERRAMENTAS_INTEGRACOES } = await import("@/src/lib/mcp/ferramentas/integracoes");
    const nomes = FERRAMENTAS_INTEGRACOES.map((f) => f.name);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const f of FERRAMENTAS_INTEGRACOES) {
      expect(f.inputSchema.additionalProperties).toBe(false);
      const leitura = /^(listar|ver)_/.test(f.name);
      expect(f.escrita, f.name).toBe(!leitura);
      if (leitura) expect(f.annotations.readOnlyHint).toBe(true);
    }
    expect(nomes).not.toContain("trocar_segredo_checkout");
  });
});

describe("regras de webhook", () => {
  const webinarExiste = (tabela: string) => (tabela === "webinars" ? { data: { nome: "Aula" }, error: null } : undefined);

  it("webinar inexistente → erro", async () => {
    const f = await ferramenta("criar_regra");
    const r = await f.executar(CHAVE_ESCRITA, { webinar_id: W, gatilho: "acessou", url: "https://x.com/h" });
    expect(r.isError).toBe(true);
    expect(textoDe(r)).toBe("Webinar não encontrado.");
  });

  it("reaproveita a validação do painel (URL privada, tempo)", async () => {
    handler = (t) => webinarExiste(t) ?? { data: null, error: null };
    const f = await ferramenta("criar_regra");
    let r = await f.executar(CHAVE_ESCRITA, { webinar_id: W, gatilho: "acessou", url: "https://127.0.0.1/x" });
    expect(textoDe(r)).toBe("Use um endereço https público.");
    r = await f.executar(CHAVE_ESCRITA, { webinar_id: W, gatilho: "permaneceu", url: "https://x.com/h" });
    expect(textoDe(r)).toBe("Informe o tempo.");
    r = await f.executar(CHAVE_ESCRITA, { webinar_id: W, gatilho: "abandonou", url: "https://x.com/h", tempo: "abc" });
    expect(textoDe(r)).toBe("Tempo inválido (h:mm:ss).");
    r = await f.executar(CHAVE_ESCRITA, { webinar_id: W, gatilho: "acessou", url: "https://x.com/h", headers: { "Nome Ruim": "x" } });
    expect(textoDe(r)).toBe("Nome de header inválido.");
    expect(escritas("regras", "insert")).toHaveLength(0);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("cria com headers cifrados, POST padrão e auditoria (MCP)", async () => {
    handler = (t) => webinarExiste(t) ?? (t === "regras" ? { data: { id: R }, error: null } : { data: null, error: null });
    const f = await ferramenta("criar_regra");
    const r = await f.executar(CHAVE_ESCRITA, {
      webinar_id: W,
      gatilho: "permaneceu",
      tempo: "0:30:00",
      url: "https://x.com/h",
      headers: { Authorization: "Bearer segredo" },
      params: { nome: "{{NOME}}" },
    });
    expect(r.isError).toBeUndefined();
    const [ins] = escritas("regras", "insert");
    const linha = arg(ins.ops, "insert") as Record<string, unknown>;
    expect(linha).toMatchObject({ webinar_id: W, gatilho: "permaneceu", valor_seg: 1800, metodo: "POST", params: { nome: "{{NOME}}" }, corpo: null });
    expect(String(linha.headers_enc)).not.toContain("segredo");
    expect(JSON.parse(decifrar(String(linha.headers_enc)))).toEqual([["Authorization", "Bearer segredo"]]);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: "usuario-1", webinarId: W, acao: "criou", descricao: 'Adicionou a regra de webhook "permaneceu" (MCP)' }),
    );
  });

  it("listar mostra só os nomes dos headers", async () => {
    const regra = { id: R, gatilho: "pitch", valor_seg: null, url: "https://x.com/h", metodo: "POST", headers_enc: cifrar(JSON.stringify([["X-Token", "super-secreto"]])), params: {}, corpo: null, ativa: true };
    handler = (t) => webinarExiste(t) ?? { data: [regra], error: null };
    const f = await ferramenta("listar_regras");
    const r = await f.executar(CHAVE_ESCRITA, { webinar_id: W });
    expect(textoDe(r)).not.toContain("super-secreto");
    expect(textoDe(r)).not.toContain("headers_enc");
    expect(json(r).regras[0].headers).toEqual(["X-Token"]);
  });

  it("editar mescla: mantém os headers salvos e os campos não enviados", async () => {
    const headersEnc = cifrar(JSON.stringify([["X-Token", "abc"]]));
    const atual = { id: R, gatilho: "clicou_oferta", valor_seg: null, url: "https://velho.com/h", metodo: "PUT", headers_enc: headersEnc, params: { a: "1" }, corpo: '{"x":1}', ativa: true };
    handler = (t, ops) => webinarExiste(t) ?? (t === "regras" && tem(ops, "maybeSingle") ? { data: atual, error: null } : { data: null, error: null });
    const f = await ferramenta("editar_regra");
    const r = await f.executar(CHAVE_ESCRITA, { webinar_id: W, regra_id: R, url: "https://novo.com/h" });
    expect(r.isError).toBeUndefined();
    const [up] = escritas("regras", "update");
    const depois = arg(up.ops, "update") as Record<string, unknown>;
    expect(depois).toMatchObject({ gatilho: "clicou_oferta", url: "https://novo.com/h", metodo: "PUT", params: { a: "1" }, corpo: '{"x":1}' });
    expect(JSON.parse(decifrar(String(depois.headers_enc)))).toEqual([["X-Token", "abc"]]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "editou", descricao: 'Editou a regra de webhook "clicou_oferta" (MCP)' }));
  });

  it("editar com headers {} remove todos; regra de outro webinar → não encontrada", async () => {
    const atual = { id: R, gatilho: "pitch", valor_seg: null, url: "https://x.com/h", metodo: "POST", headers_enc: cifrar("[]"), params: {}, corpo: null, ativa: true };
    let achar = true;
    handler = (t, ops) => webinarExiste(t) ?? (t === "regras" && tem(ops, "maybeSingle") ? { data: achar ? atual : null, error: null } : { data: null, error: null });
    const f = await ferramenta("editar_regra");
    await f.executar(CHAVE_ESCRITA, { webinar_id: W, regra_id: R, headers: {} });
    expect((arg(escritas("regras", "update")[0].ops, "update") as Record<string, unknown>).headers_enc).toBeNull();
    achar = false;
    const r = await f.executar(CHAVE_ESCRITA, { webinar_id: W, regra_id: R, url: "https://y.com" });
    expect(textoDe(r)).toBe("Regra não encontrada.");
  });

  it("ligar/desligar grava o valor pedido e audita", async () => {
    const atual = { id: R, gatilho: "pitch", valor_seg: null, url: "https://x.com/h", metodo: "POST", headers_enc: null, params: {}, corpo: null, ativa: true };
    handler = (t, ops) => webinarExiste(t) ?? (t === "regras" && tem(ops, "maybeSingle") ? { data: atual, error: null } : { data: null, error: null });
    const f = await ferramenta("ligar_desligar_regra");
    await f.executar(CHAVE_ESCRITA, { webinar_id: W, regra_id: R, ativa: false });
    expect(arg(escritas("regras", "update")[0].ops, "update")).toEqual({ ativa: false });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: 'Desativou a regra de webhook "pitch" (MCP)', antes: { ativa: true }, depois: { ativa: false } }));
  });

  it("testar confere a regra no webinar antes de disparar", async () => {
    handler = (t) => webinarExiste(t) ?? { data: null, error: null };
    const f = await ferramenta("testar_regra");
    const r = await f.executar(CHAVE_ESCRITA, { webinar_id: W, regra_id: R });
    expect(textoDe(r)).toBe("Regra não encontrada.");
    expect(enviarTeste).not.toHaveBeenCalled();
  });

  it("ver_disparos filtra pelo webinar via regras!inner", async () => {
    handler = (t) =>
      webinarExiste(t) ?? {
        data: [{ id: "d1", status: "erro", tentativas: 3, resposta: { status: 500, corpo: "falhou" }, erro: "HTTP 500", enviar_apos: "x", created_at: "2026-10-20T10:00:00Z", regra_id: R, regras: { gatilho: "pitch" }, sessoes: { participantes: { nome: "Ana" } } }],
        count: 1,
        error: null,
      };
    const f = await ferramenta("ver_disparos");
    const r = json(await f.executar(CHAVE_ESCRITA, { webinar_id: W, status: "erro" }));
    expect(r.disparos[0]).toMatchObject({ status: "erro", tentativas: 3, participante: "Ana", gatilho: "Viu o pitch", erro: "HTTP 500" });
    const c = chamadas.find((x) => x.tabela === "disparos")!;
    expect(c.ops).toContainEqual(["eq", "regras.webinar_id", W]);
    expect(c.ops).toContainEqual(["eq", "status", "erro"]);
  });
});

describe("checkouts", () => {
  it("listar nunca mostra o segredo e traz a URL de recebimento", async () => {
    handler = (t) => {
      if (t === "checkouts") return { data: [{ id: "c1", plataforma: "kiwify", ligado: true, segredo_enc: "SEGREDO-CIFRADO" }], error: null };
      if (t === "checkout_webhooks") return { data: [{ id: "wh1", webinar_id: W, token: "tok123", filtro_src: null, checkout_id: "c1" }], error: null };
      return { data: [{ id: W, nome: "Aula" }], error: null };
    };
    const f = await ferramenta("listar_checkouts");
    const r = await f.executar(CHAVE_ESCRITA, {});
    expect(textoDe(r)).not.toContain("SEGREDO-CIFRADO");
    const kiwify = json(r).checkouts.find((c: { plataforma: string }) => c.plataforma === "kiwify");
    expect(kiwify).toMatchObject({ ligado: true, tem_segredo: true });
    expect(kiwify.webhooks[0]).toMatchObject({ webinar: "Aula", url: "https://painel.teste/api/checkout/kiwify/tok123" });
  });

  it("adicionar exige plataforma configurada", async () => {
    handler = (t) => (t === "webinars" ? { data: { nome: "Aula" }, error: null } : { data: null, error: null });
    const f = await ferramenta("adicionar_webhook_checkout");
    expect(textoDe(await f.executar(CHAVE_ESCRITA, { plataforma: "xpto", webinar_id: W }))).toBe("Plataforma inválida.");
    expect(textoDe(await f.executar(CHAVE_ESCRITA, { plataforma: "hotmart", webinar_id: W }))).toBe("Configure essa plataforma antes de adicionar um webhook.");
    expect(escritas("checkout_webhooks", "insert")).toHaveLength(0);
  });

  it("adicionar gera token, devolve a URL e audita", async () => {
    handler = (t) => {
      if (t === "webinars") return { data: { nome: "Aula" }, error: null };
      if (t === "checkouts") return { data: { id: "c1" }, error: null };
      return { data: { id: "wh-novo" }, error: null };
    };
    const f = await ferramenta("adicionar_webhook_checkout");
    const r = json(await f.executar(CHAVE_ESCRITA, { plataforma: "hotmart", webinar_id: W }));
    const linha = arg(escritas("checkout_webhooks", "insert")[0].ops, "insert") as { token: string; checkout_id: string; webinar_id: string };
    expect(linha).toMatchObject({ checkout_id: "c1", webinar_id: W, filtro_src: null });
    expect(linha.token.length).toBeGreaterThan(20);
    expect(r.url).toBe(`https://painel.teste/api/checkout/hotmart/${linha.token}`);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ webinarId: W, acao: "criou", descricao: "Adicionou um webhook de hotmart (MCP)" }));
  });
});

describe("teste A/B", () => {
  const VARIACOES = [
    { webinar_id: W, percentual: 50 },
    { webinar_id: W2, percentual: 50 },
  ];

  it("criar reaproveita o validador (soma dos percentuais)", async () => {
    handler = (t, ops) => (t === "webinars" && tem(ops, "in") ? { data: [{ id: W }, { id: W2 }], error: null } : { data: [], error: null });
    const f = await ferramenta("criar_teste_ab");
    const r = await f.executar(CHAVE_ESCRITA, {
      nome: "Teste",
      slug: "teste-ab",
      inicio: "2026-10-25T08:00",
      fim: "2026-10-30T08:00",
      variacoes: [{ webinar_id: W, percentual: 50 }, { webinar_id: W2, percentual: 40 }],
    });
    expect(textoDe(r)).toBe("Os percentuais precisam somar 100% (faltam 10%).");
    expect(escritas("testes_ab", "insert")).toHaveLength(0);
  });

  it("criar grava teste + variações, fuso padrão e audita", async () => {
    handler = (t, ops) => {
      if (t === "webinars" && tem(ops, "in")) return { data: [{ id: W }, { id: W2 }], error: null };
      if (t === "testes_ab" && tem(ops, "insert")) return { data: { id: T }, error: null };
      return { data: [], error: null };
    };
    const f = await ferramenta("criar_teste_ab");
    const r = json(await f.executar(CHAVE_ESCRITA, { nome: "Teste", slug: "teste-ab", inicio: "2026-10-25T08:00", fim: "2026-10-30T08:00", variacoes: VARIACOES }));
    expect(r).toMatchObject({ ok: true, id: T, link: "https://sala.teste/t/teste-ab" });
    expect(arg(escritas("testes_ab", "insert")[0].ops, "insert")).toMatchObject({ slug: "teste-ab", fuso: "America/Sao_Paulo", inicio: "2026-10-25T11:00:00.000Z" });
    expect(arg(escritas("testes_ab_variacoes", "insert")[0].ops, "insert")).toEqual([
      { teste_id: T, webinar_id: W, ordem: 0, percentual: 50 },
      { teste_id: T, webinar_id: W2, ordem: 1, percentual: 50 },
    ]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "criou", descricao: 'Criou o teste A/B "Teste" (MCP)' }));
  });

  it("editar com participantes trava as variações, mas aceita mudar só o nome", async () => {
    handler = (t, ops) => {
      if (t === "testes_ab" && tem(ops, "maybeSingle")) return { data: { nome: "Velho", slug: "teste-ab", inicio: "2026-10-25T11:00:00+00:00", fim: "2026-10-30T11:00:00+00:00", fuso: "America/Sao_Paulo" }, error: null };
      if (t === "sessoes") return { data: [{ id: "s1" }], error: null };
      if (t === "testes_ab_variacoes") return { data: [{ webinar_id: W, percentual: 50, ordem: 0 }, { webinar_id: W2, percentual: 50, ordem: 1 }], error: null };
      return { data: [], error: null };
    };
    const f = await ferramenta("editar_teste_ab");
    const r = await f.executar(CHAVE_ESCRITA, { teste_id: T, variacoes: [{ webinar_id: W, percentual: 70 }, { webinar_id: W2, percentual: 30 }] });
    expect(textoDe(r)).toBe("Este teste já tem participantes; as variações não podem mudar.");

    chamadas = [];
    const ok = await f.executar(CHAVE_ESCRITA, { teste_id: T, nome: "Novo" });
    expect(ok.isError).toBeUndefined();
    expect(arg(escritas("testes_ab", "update")[0].ops, "update")).toMatchObject({ nome: "Novo", slug: "teste-ab", inicio: "2026-10-25T11:00:00.000Z" });
    expect(escritas("testes_ab_variacoes", "delete")).toHaveLength(0);
  });

  it("arquivar audita antes/depois", async () => {
    handler = (t, ops) => (t === "testes_ab" && tem(ops, "maybeSingle") ? { data: { nome: "Teste", arquivado: false }, error: null } : { data: null, error: null });
    const f = await ferramenta("arquivar_teste_ab");
    await f.executar(CHAVE_ESCRITA, { teste_id: T });
    expect(arg(escritas("testes_ab", "update")[0].ops, "update")).toEqual({ arquivado: true });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: 'Arquivou o teste A/B "Teste" (MCP)', antes: { arquivado: false }, depois: { arquivado: true } }));
  });
});

describe("páginas, equipe e histórico", () => {
  it("renomear valida o nome como o painel", async () => {
    const f = await ferramenta("renomear_pagina");
    expect(textoDe(await f.executar(CHAVE_ESCRITA, { pagina_id: P, nome: "  " }))).toBe("Informe o nome da página.");
    handler = (t, ops) => (t === "paginas" && tem(ops, "maybeSingle") ? { data: { nome: "Antiga" }, error: null } : { data: null, error: null });
    await f.executar(CHAVE_ESCRITA, { pagina_id: P, nome: " Nova " });
    expect(arg(escritas("paginas", "update")[0].ops, "update")).toEqual({ nome: "Nova", atualizado_por: "usuario-1" });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: 'Renomeou a página "Antiga" para "Nova" (MCP)' }));
  });

  it("listar_paginas diz em quais webinars cada página é usada", async () => {
    handler = (t, ops) => {
      if (t === "paginas") return { data: [{ id: P, nome: "Espera", tipo: "espera_jit", modelo: "espera_jit", updated_at: "x" }], count: 1, error: null };
      if (t === "jit_config" && arg(ops, "in") === "pagina_espera_id") return { data: [{ webinar_id: W, pagina_espera_id: P, webinars: { nome: "Aula" } }], error: null };
      return { data: [], error: null };
    };
    const f = await ferramenta("listar_paginas");
    const r = json(await f.executar(CHAVE_ESCRITA, {}));
    expect(r.paginas[0].usada_em).toEqual([{ webinar_id: W, webinar: "Aula", lugar: "Página de espera (just in time)" }]);
  });

  it("listar_equipe não traz auth_id", async () => {
    handler = () => ({ data: [{ id: "u1", nome: "Ana", email: "ana@x.com", papel: "admin", ativo: true }], error: null });
    const f = await ferramenta("listar_equipe");
    const r = json(await f.executar(CHAVE_ESCRITA, { papel: "admin" }));
    expect(r.equipe).toHaveLength(1);
    expect(chamadas[0].ops[0]).toEqual(["select", "id, nome, email, papel, ativo"]);
  });

  it("ver_historico filtra pelo webinar e repassa período inválido como erro", async () => {
    handler = (t) => (t === "webinars" ? { data: { nome: "Aula" }, error: null } : { data: [], count: 0, error: null });
    const f = await ferramenta("ver_historico");
    const r = await f.executar(CHAVE_ESCRITA, { webinar_id: W, acao: "editou" });
    expect(r.isError).toBeUndefined();
    const c = chamadas.find((x) => x.tabela === "auditoria")!;
    expect(c.ops).toContainEqual(["eq", "webinar_id", W]);
    expect(c.ops).toContainEqual(["eq", "acao", "editou"]);
    const ruim = await f.executar(CHAVE_ESCRITA, { de: "ontem" });
    expect(ruim.isError).toBe(true);
  });
});
