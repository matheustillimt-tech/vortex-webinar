import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agruparOrigem,
  compararMetricas,
  curvaRetencao,
  emailVisivel,
  escaparIlike,
  faixaCincoMinutos,
  foiRespondida,
  linhaCompacta,
  maioresQuedas,
  marcosRetencao,
  metricasChave,
  minutoSegundo,
  minutosMarco,
  passaFiltrosEventos,
  resumirMetricas,
  resumoChat,
  segundoDoVideo,
  taxasEntreEtapas,
} from "@/src/lib/regras/analise-mcp";
import { montarFunil } from "@/src/lib/regras/metricas";

const WEB = "11111111-1111-4111-8111-111111111111";
const SESS = "22222222-2222-4222-8222-222222222222";

type Chamada = { metodo: string; args: unknown[] };
type Consulta = { tabela: string; chamadas: Chamada[]; opcoesSelect?: unknown };

const consultas: Consulta[] = [];
let respostas: (c: Consulta) => unknown = () => ({ data: null, error: null });
let respostaRpc: (nome: string, args: unknown) => unknown = () => ({ data: {}, error: null });
const rpc = vi.fn();

/** Chain falsa do supabase: grava cada método chamado e resolve (await) com `respostas(consulta)`. */
function chain(tabela: string) {
  const c: Consulta = { tabela, chamadas: [] };
  consultas.push(c);
  const p: any = {
    then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(respostas(c)).then(ok, falha),
  };
  for (const m of ["select", "eq", "neq", "gte", "lt", "in", "ilike", "order", "range", "limit", "maybeSingle"]) {
    p[m] = (...args: unknown[]) => {
      c.chamadas.push({ metodo: m, args });
      if (m === "select") c.opcoesSelect = args[1];
      return p;
    };
  }
  return p;
}

vi.mock("@/src/lib/supabase/admin", () => ({
  dbAdmin: () => ({
    from: (t: string) => chain(t),
    rpc: (nome: string, args: unknown) => {
      rpc(nome, args);
      return Promise.resolve(respostaRpc(nome, args));
    },
  }),
}));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));

const CHAVE = { id: "c1", nome: "Teste", permissao: "leitura" as const, usuarioId: "u1" };

async function ferramenta(nome: string) {
  const { FERRAMENTAS_ANALISE } = await import("@/src/lib/mcp/ferramentas/analise");
  const f = FERRAMENTAS_ANALISE.find((x) => x.name === nome);
  if (!f) throw new Error("sem ferramenta " + nome);
  return f;
}

const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const tem = (c: Consulta, metodo: string, ...args: unknown[]) => c.chamadas.some((x) => x.metodo === metodo && JSON.stringify(x.args) === JSON.stringify(args));

beforeEach(() => {
  consultas.length = 0;
  rpc.mockReset();
  respostas = (c) => (c.tabela === "webinars" ? { data: { id: WEB, nome: "Aula" }, error: null } : { data: [], error: null });
  respostaRpc = () => ({ data: {}, error: null });
});

// Regras puras ---------------------------------------------------------------------------------------------------

describe("regras de análise", () => {
  it("minutoSegundo e segundoDoVideo", () => {
    expect(minutoSegundo(0)).toBe("00:00");
    expect(minutoSegundo(75 * 60 + 12)).toBe("75:12");
    expect(minutoSegundo(-3)).toBe("00:00");
    expect(segundoDoVideo("2026-10-21T20:05:30Z", "2026-10-21T20:00:00Z")).toBe(330);
    expect(segundoDoVideo("2026-10-21T19:59:00Z", "2026-10-21T20:00:00Z")).toBe(0);
    expect(segundoDoVideo("2026-10-21T20:00:00Z", null)).toBeNull();
  });

  it("funil: taxas entre etapas vizinhas", () => {
    const funil = montarFunil(100, { acessou_sala: 50, min_15: 25, pitch: 20, oferta: 20, clicou_oferta: 5, comprou: 1 });
    const t = taxasEntreEtapas(funil);
    expect(t[0]).toEqual({ de: "Cadastros", para: "Acessou a sala", percentual: 50 });
    expect(t[1].percentual).toBe(50);
    expect(t.at(-1)).toEqual({ de: "Clicou na oferta", para: "Comprou", percentual: 20 });
  });

  it("resumirMetricas: receita por participante e reais", () => {
    const r = resumirMetricas({
      cadastros: 10,
      eventos: { acessou_sala: 4 },
      vendas: { total: 2, faturamentoCentavos: 99800 },
      tempoMedioSeg: 125,
      porDia: [{ dia: "2026-10-20", aoVivo: 3, replay: 1 }, { dia: "2026-10-21", aoVivo: 2, replay: 4 }],
    });
    expect(r.vendas).toEqual({ total: 2, faturamentoReais: 998 });
    expect(r.receitaPorParticipanteReais).toBe(249.5);
    expect(r.tempoMedioAssistido).toBe("02:05");
    expect(r.aoVivoReplay.aoVivo).toBe(5);
    expect(r.aoVivoReplay.replay).toBe(5);
  });

  it("comparar períodos: diferença e variação (null quando A é 0)", () => {
    const a = metricasChave({ cadastros: 100, eventos: { acessou_sala: 40 }, vendas: { total: 0, faturamentoCentavos: 0 } });
    const b = metricasChave({ cadastros: 150, eventos: { acessou_sala: 60 }, vendas: { total: 3, faturamentoCentavos: 30000 } });
    const c = compararMetricas(a, b);
    expect(c.find((x) => x.metrica === "cadastros")).toEqual({ metrica: "cadastros", a: 100, b: 150, diferenca: 50, variacaoPercentual: 50 });
    expect(c.find((x) => x.metrica === "vendas")?.variacaoPercentual).toBeNull();
    expect(c.find((x) => x.metrica === "faturamento_reais")?.b).toBe(300);
  });

  it("curva de retenção preenche minutos sem linha e calcula % sobre a base", () => {
    const c = curvaRetencao([{ minuto: 1, visualizacoes: 10 }, { minuto: 3, visualizacoes: 5 }, { minuto: 1, visualizacoes: 10 }], 40);
    expect(c).toEqual([
      { minuto: 1, pessoas: 20, percentual: 50 },
      { minuto: 2, pessoas: 0, percentual: 0 },
      { minuto: 3, pessoas: 5, percentual: 12.5 },
    ]);
    expect(curvaRetencao([], 10)).toEqual([]);
  });

  it("marcos: 5…60 e de 15 em 15 até a duração", () => {
    expect(minutosMarco(0)).toEqual([5, 10, 15, 20, 30, 45, 60]);
    expect(minutosMarco(22 * 60)).toEqual([5, 10, 15, 20]);
    expect(minutosMarco(100 * 60)).toEqual([5, 10, 15, 20, 30, 45, 60, 75, 90]);
    const m = marcosRetencao([0, 300, 600, 1200], [{ rotulo: "5 min", segundo: 300 }, { rotulo: "Pitch", segundo: 900 }], 4);
    expect(m).toEqual([
      { rotulo: "5 min", segundo: 300, pessoas: 3, percentual: 75 },
      { rotulo: "Pitch", segundo: 900, pessoas: 1, percentual: 25 },
    ]);
  });

  it("maiores quedas: minuto do último ponto visto, sem quem foi até o fim nem quem não assistiu", () => {
    // 3 saíram no minuto 2, 1 no minuto 5, 1 assistiu até o fim (minuto 10 de 10), 1 nunca passou do 0.
    const q = maioresQuedas([130, 150, 179, 310, 600, 20], 600, 6, 5);
    expect(q[0]).toEqual({ minuto: 2, momento: "02:00", sairam: 3, percentual: 50, aindaAssistindo: 2 });
    expect(q[1].minuto).toBe(5);
    expect(q).toHaveLength(2);
  });

  it("chat: faixas de 5 min, resumo, respondida e linha compacta", () => {
    expect(faixaCincoMinutos(0)).toBe("00-05");
    expect(faixaCincoMinutos(299)).toBe("00-05");
    expect(faixaCincoMinutos(300)).toBe("05-10");
    const r = resumoChat([
      { sessaoId: "a", segundoVideo: 10 },
      { sessaoId: "a", segundoVideo: 400 },
      { sessaoId: "b", segundoVideo: 20 },
      { sessaoId: "c", segundoVideo: null },
    ]);
    expect(r).toEqual({ totalMensagens: 4, pessoasDistintas: 3, porFaixaDe5Min: [{ faixa: "00-05", mensagens: 2 }, { faixa: "05-10", mensagens: 1 }] });
    const resp = new Map([["a", [new Date("2026-10-21T20:10:00Z").getTime()]]]);
    expect(foiRespondida("a", "2026-10-21T20:05:00Z", resp)).toBe(true);
    expect(foiRespondida("a", "2026-10-21T20:15:00Z", resp)).toBe(false);
    expect(foiRespondida("b", "2026-10-21T20:05:00Z", resp)).toBe(false);
    expect(linhaCompacta(65, "  quanto\ncusta? ", false)).toBe("01:05 | quanto custa?");
    expect(linhaCompacta(null, null, true)).toBe("--:-- | [imagem]");
    expect(escaparIlike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("e-mail mascarado menos de quem comprou; filtros por evento", () => {
    expect(emailVisivel("ana.silva@exemplo.com", false)).toBe("an***@exemplo.com");
    expect(emailVisivel("ana.silva@exemplo.com", true)).toBe("ana.silva@exemplo.com");
    expect(emailVisivel(null, true)).toBeNull();
    expect(passaFiltrosEventos(["acessou_sala", "comprou"], { comprou: true })).toBe(true);
    expect(passaFiltrosEventos(["acessou_sala", "comprou"], { naoComprou: true })).toBe(false);
    expect(passaFiltrosEventos(["acessou_sala"], { clicouOferta: true })).toBe(false);
  });

  it("origem do tráfego: venda conta pra UTM da sessão casada, ou pras UTMs da venda", () => {
    const linhas = agruparOrigem(
      [
        { id: "s1", utms: { utm_source: "instagram" }, eventos: ["acessou_sala", "clicou_oferta"] },
        { id: "s2", utms: { utm_source: "instagram" }, eventos: [] },
        { id: "s3", utms: {}, eventos: ["acessou_sala"] },
      ],
      [
        { sessaoId: "s1", valorCentavos: 50000, utms: { utm_source: "outra" } },
        { sessaoId: null, valorCentavos: 20000, utms: { utm_source: "email" } },
      ],
      "utm_source",
    );
    expect(linhas.map((l) => l.origem)).toEqual(["instagram", "email", "(sem utm)"]);
    expect(linhas[0]).toMatchObject({ cadastros: 2, acessaramSala: 1, clicaramOferta: 1, vendas: 1, faturamentoReais: 500, taxaAcesso: 50, conversao: 100 });
    expect(linhas[1]).toMatchObject({ cadastros: 0, vendas: 1, faturamentoReais: 200 });
  });
});

// Ferramentas ----------------------------------------------------------------------------------------------------

describe("ferramentas de análise", () => {
  it("todas são só leitura", async () => {
    const { FERRAMENTAS_ANALISE } = await import("@/src/lib/mcp/ferramentas/analise");
    expect(FERRAMENTAS_ANALISE.map((f) => f.name)).toEqual([
      "metricas_webinar",
      "dashboard_geral",
      "analisar_retencao",
      "comparar_periodos",
      "ler_chat",
      "listar_participantes",
      "ver_participante",
      "listar_vendas",
      "origem_trafego",
    ]);
    for (const f of FERRAMENTAS_ANALISE) {
      expect(f.escrita).toBe(false);
      expect(f.annotations.readOnlyHint).toBe(true);
      expect((f.inputSchema as { additionalProperties: boolean }).additionalProperties).toBe(false);
    }
  });

  it("metricas_webinar: id inválido, período inválido e RPC com o período em Brasília", async () => {
    const f = await ferramenta("metricas_webinar");
    expect((await f.executar(CHAVE, { webinar_id: "x" })).isError).toBe(true);
    expect((await f.executar(CHAVE, { webinar_id: WEB, de: "2026-10-10", ate: "2026-10-01" })).content[0].text).toBe("A data final não pode vir antes da inicial.");

    respostaRpc = () => ({
      data: { cadastros: 10, eventos: { acessou_sala: 5, mensagem_chat: 3, comprou: 1 }, vendas: { total: 1, faturamentoCentavos: 49700 }, tempoMedioSeg: 600 },
      error: null,
    });
    respostas = (c) => (c.tabela === "webinars" ? { data: { id: WEB, nome: "Aula" }, error: null } : { data: null, count: 7, error: null });
    const r = json(await f.executar(CHAVE, { webinar_id: WEB, de: "2026-10-01", ate: "2026-10-07" }));
    expect(rpc).toHaveBeenCalledWith("metricas_webinar", { p_webinar: WEB, p_de: "2026-10-01T03:00:00.000Z", p_ate: "2026-10-08T03:00:00.000Z" });
    expect(r.periodo).toEqual({ de: "2026-10-01", ate: "2026-10-07", fuso: "Brasília" });
    expect(r.chat).toEqual({ pessoasQueEscreveram: 3, totalMensagens: 7 });
    expect(r.receitaPorParticipanteReais).toBe(99.4);
    const contagem = consultas.find((c) => c.tabela === "mensagens_suporte")!;
    expect(tem(contagem, "neq", "sessoes.modo", "teste")).toBe(true);
    expect(tem(contagem, "eq", "autor", "participante")).toBe(true);
  });

  it("metricas_webinar: webinar que não existe", async () => {
    respostas = () => ({ data: null, error: null });
    const r = await (await ferramenta("metricas_webinar")).executar(CHAVE, { webinar_id: WEB });
    expect(r).toEqual({ content: [{ type: "text", text: "Webinar não encontrado." }], isError: true });
  });

  it("dashboard_geral: ranking ordenado por faturamento", async () => {
    respostaRpc = () => ({
      data: {
        cadastros: 3,
        porWebinar: [
          { id: "a", nome: "A", cadastros: 1, acessos: 1, vendas: 0, faturamentoCentavos: 0 },
          { id: "b", nome: "B", cadastros: 2, acessos: 2, vendas: 1, faturamentoCentavos: 10000 },
        ],
      },
      error: null,
    });
    const r = json(await (await ferramenta("dashboard_geral")).executar(CHAVE, {}));
    expect(rpc.mock.calls[0][0]).toBe("dashboard_geral");
    expect(r.porWebinar.map((w: { id: string }) => w.id)).toEqual(["b", "a"]);
    expect(r.porWebinar[0].receitaPorParticipanteReais).toBe(50);
  });

  it("analisar_retencao: base em quem acessou, marcos com pitch/oferta e sem sessões de teste", async () => {
    respostaRpc = () => ({ data: { cadastros: 8, eventos: { acessou_sala: 4 }, retencao: [{ minuto: 1, visualizacoes: 4 }, { minuto: 2, visualizacoes: 2 }] }, error: null });
    respostas = (c) => {
      if (c.tabela === "webinars") return { data: { id: WEB, nome: "Aula" }, error: null };
      if (c.tabela === "sessoes") return { data: [{ id: "1", max_segundo: 100 }, { id: "2", max_segundo: 400 }, { id: "3", max_segundo: 1300 }, { id: "4", max_segundo: 3000 }], error: null };
      if (c.tabela === "ofertas") return { data: { ligada: true, aparece_seg: 1500, pitch_seg: 1200 }, error: null };
      if (c.tabela === "webinar_video") return { data: { videos: { nome: "Aula.mp4", duracao_seg: 3000 } }, error: null };
      return { data: [], error: null };
    };
    const r = json(await (await ferramenta("analisar_retencao")).executar(CHAVE, { webinar_id: WEB }));
    const sess = consultas.find((c) => c.tabela === "sessoes")!;
    expect(tem(sess, "neq", "modo", "teste")).toBe(true);
    expect(tem(sess, "eq", "eventos.tipo", "acessou_sala")).toBe(true);
    expect(r.acessaramSala).toBe(4);
    expect(r.video).toEqual({ nome: "Aula.mp4", duracao: "50:00", duracaoSeg: 3000 });
    expect(r.marcos.find((m: { rotulo: string }) => m.rotulo === "5 min")).toMatchObject({ pessoas: 3, percentual: 75 });
    expect(r.marcos.find((m: { rotulo: string }) => m.rotulo.startsWith("Pitch"))).toMatchObject({ segundo: 1200, pessoas: 2, percentual: 50 });
    expect(r.marcos.find((m: { rotulo: string }) => m.rotulo.startsWith("Oferta"))).toMatchObject({ segundo: 1500, pessoas: 1 });
    expect(r.curva[0]).toEqual({ minuto: 1, pessoas: 4, percentual: 100 });
    expect(r.pico).toEqual({ minuto: 1, pessoas: 4 });
    expect(r.maioresQuedas.map((q: { minuto: number }) => q.minuto)).toEqual([1, 6, 21]);
  });

  it("comparar_periodos: exige as quatro datas e chama a RPC duas vezes", async () => {
    const f = await ferramenta("comparar_periodos");
    expect((await f.executar(CHAVE, { de_a: "2026-10-01" })).isError).toBe(true);
    expect((await f.executar(CHAVE, { de_a: "2026-10-01", ate_a: "2026-10-07", de_b: "xx", ate_b: "2026-10-14" })).content[0].text).toBe("Período B: Data inválida.");
    respostaRpc = (_n, a) => ({ data: { cadastros: (a as { p_de: string }).p_de.startsWith("2026-10-01") ? 10 : 20 }, error: null });
    const r = json(await f.executar(CHAVE, { webinar_id: WEB, de_a: "2026-10-01", ate_a: "2026-10-07", de_b: "2026-10-08", ate_b: "2026-10-14" }));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(r.comparacao.find((c: { metrica: string }) => c.metrica === "cadastros")).toEqual({ metrica: "cadastros", a: 10, b: 20, diferenca: 10, variacaoPercentual: 100 });
  });

  it("ler_chat: filtros, minuto do vídeo, comprou/clicou, respondida e formato compacto", async () => {
    const msgs = [
      { id: "m1", created_at: "2026-10-21T23:02:05Z", autor: "participante", texto: "Quanto custa?", imagem_url: null, apagada: false, sessao_id: "s1", sessoes: { modo: "ao_vivo", inicio_sessao: "2026-10-21T23:00:00Z", participantes: { nome: "Ana" } } },
      { id: "m2", created_at: "2026-10-21T23:07:00Z", autor: "participante", texto: "Tem garantia?", imagem_url: null, apagada: false, sessao_id: "s2", sessoes: { modo: "ao_vivo", inicio_sessao: "2026-10-21T23:00:00Z", participantes: { nome: "Bia" } } },
    ];
    respostas = (c) => {
      if (c.tabela === "webinars") return { data: { id: WEB, nome: "Aula" }, error: null };
      if (c.tabela === "mensagens_suporte" && c.chamadas.some((x) => x.metodo === "range")) return { data: msgs, error: null };
      if (c.tabela === "mensagens_suporte") return { data: [{ sessao_id: "s1", created_at: "2026-10-21T23:03:00Z" }], error: null };
      if (c.tabela === "eventos") return { data: [{ sessao_id: "s2", tipo: "comprou" }, { sessao_id: "s2", tipo: "clicou_oferta" }], error: null };
      return { data: [], error: null };
    };
    const f = await ferramenta("ler_chat");
    expect((await f.executar(CHAVE, { webinar_id: WEB, autor: "hacker" })).content[0].text).toBe("Autor inválido.");

    const r = json(await f.executar(CHAVE, { webinar_id: WEB, busca: "50%", so_ao_vivo: true }));
    const principal = consultas.find((c) => c.tabela === "mensagens_suporte" && c.chamadas.some((x) => x.metodo === "range"))!;
    expect(tem(principal, "neq", "sessoes.modo", "teste")).toBe(true);
    expect(tem(principal, "eq", "sessoes.modo", "ao_vivo")).toBe(true);
    expect(tem(principal, "eq", "autor", "participante")).toBe(true);
    expect(tem(principal, "eq", "apagada", false)).toBe(true);
    expect(tem(principal, "ilike", "texto", "%50\\%%")).toBe(true);
    expect(r.resumo).toEqual({ totalMensagens: 2, pessoasDistintas: 2, porFaixaDe5Min: [{ faixa: "00-05", mensagens: 1 }, { faixa: "05-10", mensagens: 1 }] });
    expect(r.mensagens[0]).toMatchObject({ nome: "Ana", minutoVideo: "02:05", respondida: true, comprou: false, clicouOferta: false });
    expect(r.mensagens[1]).toMatchObject({ nome: "Bia", minutoVideo: "07:00", respondida: false, comprou: true, clicouOferta: true });

    const c = json(await f.executar(CHAVE, { webinar_id: WEB, formato: "compacto", limite: 1 }));
    expect(c.mensagens).toEqual(["02:05 | Quanto custa?"]);
    expect(c.paginacao).toEqual({ pagina: 1, limite: 1, total: 2, temMais: true });
  });

  it("listar_participantes: e-mail mascarado menos de quem comprou, filtros e sem teste", async () => {
    respostas = (c) => {
      if (c.tabela === "webinars") return { data: { id: WEB, nome: "Aula" }, error: null };
      if (c.tabela === "sessoes")
        return {
          data: [
            { id: "s1", entrou_em: "2026-10-21T23:00:00Z", modo: "ao_vivo", max_segundo: 1800, dispositivo: "mobile", pais: "BR", cidade: "SP", utms: { utm_source: "ig" }, participantes: { nome: "Ana", email: "ana@x.com" }, eventos: [{ tipo: "acessou_sala" }, { tipo: "comprou" }] },
            { id: "s2", entrou_em: "2026-10-21T23:01:00Z", modo: "ao_vivo", max_segundo: 1900, dispositivo: "desktop", pais: null, cidade: null, utms: {}, participantes: { nome: "Bia", email: "bia.souza@x.com" }, eventos: [{ tipo: "acessou_sala" }] },
          ],
          error: null,
        };
      return { data: [], error: null };
    };
    const f = await ferramenta("listar_participantes");
    const r = json(await f.executar(CHAVE, { webinar_id: WEB, assistiu_min: 30, utm_source: "ig" }));
    const sess = consultas.find((c) => c.tabela === "sessoes")!;
    expect(tem(sess, "neq", "modo", "teste")).toBe(true);
    expect(tem(sess, "gte", "max_segundo", 1800)).toBe(true);
    expect(tem(sess, "eq", "utms->>utm_source", "ig")).toBe(true);
    expect(r.participantes[0]).toMatchObject({ nome: "Ana", email: "ana@x.com", comprou: true, assistiuAte: "30:00", local: "SP, BR" });
    expect(r.participantes[1]).toMatchObject({ nome: "Bia", email: "bi***@x.com", comprou: false });

    const s = json(await f.executar(CHAVE, { webinar_id: WEB, nao_comprou: true }));
    expect(s.total).toBe(1);
    expect(s.participantes[0].nome).toBe("Bia");
  });

  it("ver_participante: sessão inexistente e jornada com minuto do vídeo", async () => {
    const f = await ferramenta("ver_participante");
    expect((await f.executar(CHAVE, { sessao_id: "nada" })).content[0].text).toBe("Sessão não encontrada.");
    respostas = (c) => {
      if (c.tabela === "sessoes")
        return {
          data: { id: SESS, webinar_id: WEB, entrou_em: "2026-10-21T22:59:00Z", inicio_sessao: "2026-10-21T23:00:00Z", modo: "ao_vivo", max_segundo: 900, dispositivo: "mobile", navegador: "Chrome", pais: "BR", cidade: null, utms: {}, status_atendimento: "atendido", participantes: { nome: "Ana", email: "ana.lima@x.com" }, webinars: { nome: "Aula" } },
          error: null,
        };
      if (c.tabela === "eventos") return { data: [{ tipo: "acessou_sala", segundo_video: null, criado_em: "2026-10-21T23:00:30Z" }, { tipo: "pitch", segundo_video: 840, criado_em: "2026-10-21T23:14:00Z" }], error: null };
      if (c.tabela === "mensagens_suporte") return { data: [{ autor: "participante", texto: "segredo", imagem_url: null, apagada: true, created_at: "2026-10-21T23:01:00Z", usuarios: null }], error: null };
      return { data: [], error: null };
    };
    const r = json(await f.executar(CHAVE, { sessao_id: SESS }));
    expect(r.email).toBe("an***@x.com");
    expect(r.eventos).toEqual([
      { tipo: "acessou_sala", minutoVideo: "00:30", em: "21/10/2026 20:00" },
      { tipo: "pitch", minutoVideo: "14:00", em: "21/10/2026 20:14" },
    ]);
    expect(r.mensagens[0].texto).toBe("[apagada]");
  });

  it("listar_vendas: totais do filtro inteiro e paginação", async () => {
    respostas = (c) => {
      if (c.tabela === "vendas")
        return {
          data: [
            { id: "v1", created_at: "2026-10-21T23:30:00Z", webinar_id: WEB, sessao_id: SESS, plataforma: "kiwify", id_transacao: "T1", valor_centavos: 49700, comprador_email: "a@x.com", src: null, utms: {}, webinars: { nome: "Aula" } },
            { id: "v2", created_at: "2026-10-21T23:40:00Z", webinar_id: WEB, sessao_id: null, plataforma: "hotmart", id_transacao: "T2", valor_centavos: 30300, comprador_email: null, src: "ig", utms: {}, webinars: { nome: "Aula" } },
          ],
          error: null,
        };
      return { data: { id: WEB, nome: "Aula" }, error: null };
    };
    const r = json(await (await ferramenta("listar_vendas")).executar(CHAVE, { limite: 1 }));
    expect(r).toMatchObject({ total: 2, faturamentoReais: 800, ticketMedioReais: 400, casadasComSessao: 1 });
    expect(r.porPlataforma).toEqual({ kiwify: { vendas: 1, faturamentoReais: 497 }, hotmart: { vendas: 1, faturamentoReais: 303 } });
    expect(r.vendas).toHaveLength(1);
    expect(r.vendas[0]).toMatchObject({ em: "21/10/2026 20:30", valorReais: 497, sessaoId: SESS });
  });

  it("origem_trafego: campo inválido e agrupamento", async () => {
    const f = await ferramenta("origem_trafego");
    expect((await f.executar(CHAVE, { agrupar_por: "utm_x" })).isError).toBe(true);
    respostas = (c) => {
      if (c.tabela === "sessoes") return { data: [{ id: "s1", utms: { utm_campaign: "black" }, eventos: [{ tipo: "acessou_sala" }] }], error: null };
      if (c.tabela === "vendas") return { data: [{ id: "v1", sessao_id: "s1", valor_centavos: 10000, utms: {} }], error: null };
      return { data: [], error: null };
    };
    const r = json(await f.executar(CHAVE, { agrupar_por: "utm_campaign" }));
    expect(r.origens).toEqual([
      { origem: "black", cadastros: 1, acessaramSala: 1, clicaramOferta: 0, vendas: 1, faturamentoReais: 100, taxaAcesso: 100, taxaClique: 0, conversao: 100 },
    ]);
    expect(tem(consultas.find((c) => c.tabela === "sessoes")!, "neq", "modo", "teste")).toBe(true);
  });
});
