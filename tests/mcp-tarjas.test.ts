import { beforeEach, describe, expect, it, vi } from "vitest";

/** Banco falso por tabela: cada consulta resolve pro que estiver em `respostas[tabela]`; grava inserts/updates. */
const respostas: Record<string, unknown> = {};
const gravado: { tabela: string; op: string; valor: unknown }[] = [];
const auditoria = vi.fn();

function chain(tabela: string) {
  const p: any = {};
  const resolver = () => Promise.resolve(respostas[tabela] ?? { data: null, error: null });
  for (const m of ["select", "eq", "order"]) p[m] = () => p;
  p.maybeSingle = resolver;
  p.single = resolver;
  p.then = (ok: any, falha: any) => resolver().then(ok, falha);
  p.insert = (v: unknown) => (gravado.push({ tabela, op: "insert", valor: v }), p);
  p.update = (v: unknown) => (gravado.push({ tabela, op: "update", valor: v }), p);
  p.delete = () => (gravado.push({ tabela, op: "delete", valor: null }), p);
  return p;
}

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => ({ from: (t: string) => chain(t) }) }));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => auditoria(...a) }));

const W = "11111111-1111-1111-1111-111111111111";
const T = "22222222-2222-2222-2222-222222222222";
const CHAVE = { id: "c", nome: "Claude", permissao: "escrita" as const, usuarioId: "u1" };
const ferramenta = async (nome: string) => (await import("@/src/lib/mcp/ferramentas/webinars-tarjas")).FERRAMENTAS_TARJAS.find((f) => f.name === nome)!;

beforeEach(() => {
  for (const k of Object.keys(respostas)) delete respostas[k];
  gravado.length = 0;
  auditoria.mockReset();
  respostas.webinars = { data: { id: W }, error: null };
  respostas.webinar_video = { data: { videos: { duracao_seg: 600 } }, error: null };
});

describe("tarjas de aviso pelo MCP", () => {
  it("adicionar valida com a regra do painel (momento dentro do vídeo)", async () => {
    const f = await ferramenta("adicionar_tarja");
    const r = await f.executar(CHAVE, { webinar_id: W, texto: "Não saia!", aparece: "20:00" });
    expect(r.isError).toBe(true);
    expect(gravado).toEqual([]);
  });

  it("adicionar grava e registra no histórico", async () => {
    respostas.tarjas_aviso = { data: { id: T, texto: "Não saia!", aparece_seg: 95, duracao_seg: 15, posicao: "topo", cor: "vermelho", ligada: true }, error: null, count: 0 };
    const f = await ferramenta("adicionar_tarja");
    const r = await f.executar(CHAVE, { webinar_id: W, texto: "Não saia!", aparece: "1:35" });
    expect(r.isError).toBeUndefined();
    expect(gravado[0]).toEqual({ tabela: "tarjas_aviso", op: "insert", valor: { webinar_id: W, texto: "Não saia!", aparece_seg: 95, duracao_seg: 15, posicao: "topo", cor: "vermelho", ligada: true } });
    expect(auditoria.mock.calls[0][0]).toMatchObject({ usuarioId: "u1", acao: "criou", descricao: 'Adicionou a tarja de aviso "Não saia!" (MCP)' });
  });

  it("limite de 20 por webinar", async () => {
    respostas.tarjas_aviso = { data: null, error: null, count: 20 };
    const f = await ferramenta("adicionar_tarja");
    const r = await f.executar(CHAVE, { webinar_id: W, texto: "x", aparece: "10" });
    expect(r.content[0].text).toMatch(/até 20/);
  });

  it("editar muda só o que veio (desligar mantém texto e momento)", async () => {
    respostas.tarjas_aviso = { data: { texto: "Fica!", aparece_seg: 120, duracao_seg: 30, posicao: "base", cor: "amarelo", ligada: true }, error: null };
    const f = await ferramenta("editar_tarja");
    await f.executar(CHAVE, { webinar_id: W, tarja_id: T, ligada: false });
    expect(gravado[0].valor).toEqual({ texto: "Fica!", aparece_seg: 120, duracao_seg: 30, posicao: "base", cor: "amarelo", ligada: false });
  });

  it("todas as de mudança exigem escrita", async () => {
    const { FERRAMENTAS_TARJAS } = await import("@/src/lib/mcp/ferramentas/webinars-tarjas");
    expect(FERRAMENTAS_TARJAS.filter((f) => f.escrita).map((f) => f.name)).toEqual(["adicionar_tarja", "editar_tarja", "excluir_tarja"]);
  });
});
