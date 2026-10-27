import { beforeEach, describe, expect, it, vi } from "vitest";

const exigirAdmin = vi.fn();
const exigirUsuario = vi.fn();
const dbUsuario = vi.fn();
const registrarAuditoria = vi.fn();
const emailConfig = vi.fn();
const enviarEmail = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/src/lib/supabase/usuario", () => ({
  exigirAdmin: (...a: unknown[]) => exigirAdmin(...a),
  exigirUsuario: (...a: unknown[]) => exigirUsuario(...a),
  dbUsuario: (...a: unknown[]) => dbUsuario(...a),
}));
vi.mock("@/src/lib/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));
vi.mock("@/src/lib/env", () => ({ emailConfig: () => emailConfig() }));
vi.mock("@/src/lib/email/resend", () => ({ enviarEmail: (...a: unknown[]) => enviarEmail(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (...a: [string]) => redirect(...a) }));

type Tabela = { lista?: unknown[]; unico?: unknown; erroLer?: unknown; erroEscrita?: unknown };
type Chamada = { tabela: string; metodo: string; args: unknown[] };

/** Supabase falso: cada tabela devolve `lista` (await direto), `unico` (maybeSingle) e `erroEscrita` nas escritas;
 *  registra todas as chamadas. */
function criarDb(tabelas: Record<string, Tabela>) {
  const chamadas: Chamada[] = [];
  const from = (tabela: string) => {
    const t = tabelas[tabela] ?? {};
    let escrita = false;
    const no: any = {};
    for (const m of ["select", "eq", "order", "limit", "insert", "upsert", "update", "delete"]) {
      no[m] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo: m, args });
        if (["insert", "upsert", "update", "delete"].includes(m)) escrita = true;
        return no;
      };
    }
    no.maybeSingle = () => Promise.resolve({ data: t.unico ?? null, error: null });
    no.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
      Promise.resolve(escrita ? { error: t.erroEscrita ?? null } : { data: t.lista ?? [], error: t.erroLer ?? null }).then(ok, falha);
    return no;
  };
  return { db: { from }, chamadas, escritas: (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo).map((c) => c.args) };
}

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const acoes = () => import("../app/(painel)/webinars/[id]/agenda/jit/actions");

beforeEach(() => {
  vi.resetModules();
  exigirAdmin.mockReset().mockResolvedValue({ id: "admin-1", nome: "Paula", papel: "admin" });
  exigirUsuario.mockReset().mockResolvedValue({ id: "auth-1", email: "paula@exemplo.com" });
  dbUsuario.mockReset();
  registrarAuditoria.mockReset();
  emailConfig.mockReset().mockReturnValue(null);
  enviarEmail.mockReset().mockResolvedValue({ id: "re_1" });
  revalidatePath.mockReset();
  redirect.mockClear();
});

describe("adicionarHorarioJit", () => {
  it("adiciona o horário validado e registra a auditoria", async () => {
    const f = criarDb({ jit_config: { unico: { fuso: "America/Sao_Paulo" } }, jit_horarios: { lista: [] } });
    dbUsuario.mockResolvedValue(f.db);
    const { adicionarHorarioJit } = await acoes();
    const r = await adicionarHorarioJit("web-1", {}, form({ quando: "dia_semana", dia_semana: "3", hora: "20:00" }));
    expect(r).toEqual({ ok: true });
    expect(f.escritas("jit_horarios", "insert")).toEqual([
      [{ webinar_id: "web-1", quando: "dia_semana", hora: "20:00", intervalo_min: null, data: null, dia_semana: 3 }],
    ]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "criou", descricao: "Adicionou um horário do just in time" }));
    expect(revalidatePath).toHaveBeenCalledWith("/webinars/web-1/agenda/jit");
  });

  it("data digitada é interpretada no fuso da configuração", async () => {
    const f = criarDb({ jit_config: { unico: { fuso: "America/Manaus" } }, jit_horarios: { lista: [] } });
    dbUsuario.mockResolvedValue(f.db);
    const { adicionarHorarioJit } = await acoes();
    await adicionarHorarioJit("web-1", {}, form({ quando: "data", data: "2026-10-25T19:00" }));
    expect((f.escritas("jit_horarios", "insert")[0][0] as { data: string }).data).toBe("2026-10-25T23:00:00.000Z");
  });

  it("horário igual a um que já existe (vindo do banco com HH:mm:ss): não insere", async () => {
    const f = criarDb({
      jit_horarios: { lista: [{ quando: "todo_dia", hora: "19:00:00", intervalo_min: null, data: null, dia_semana: null }] },
    });
    dbUsuario.mockResolvedValue(f.db);
    const { adicionarHorarioJit } = await acoes();
    const campos = { quando: "todo_dia", hora: "19:00" };
    const r = await adicionarHorarioJit("web-1", {}, form(campos));
    expect(r).toEqual({ erro: "Já existe um horário igual.", valores: campos });
    expect(f.escritas("jit_horarios", "insert")).toEqual([]);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("campos inválidos devolvem o erro e o que foi digitado", async () => {
    dbUsuario.mockResolvedValue(criarDb({}).db);
    const { adicionarHorarioJit } = await acoes();
    const r = await adicionarHorarioJit("web-1", {}, form({ quando: "a_cada", intervalo_min: "20" }));
    expect(r).toEqual({ erro: "Escolha o intervalo (15, 30, 45 ou 60 minutos).", valores: { quando: "a_cada", intervalo_min: "20" } });
  });

  it("sem admin: lança antes de tocar no banco", async () => {
    exigirAdmin.mockRejectedValue(new Error("Só administradores podem fazer isso."));
    const { adicionarHorarioJit } = await acoes();
    await expect(adicionarHorarioJit("web-1", {}, form({ quando: "todo_dia", hora: "19:00" }))).rejects.toThrow("Só administradores");
    expect(dbUsuario).not.toHaveBeenCalled();
  });
});

describe("excluirHorarioJit", () => {
  it("não deixa excluir o último horário", async () => {
    const f = criarDb({ jit_horarios: { lista: [{ id: "h1", quando: "todo_dia", hora: "19:00:00" }] } });
    dbUsuario.mockResolvedValue(f.db);
    const { excluirHorarioJit } = await acoes();
    const r = await excluirHorarioJit("web-1", {}, form({ id: "h1" }));
    expect(r.erro).toMatch(/pelo menos um horário/);
    expect(f.escritas("jit_horarios", "delete")).toEqual([]);
  });

  it("exclui um dos horários (filtrando pelo webinar) e audita", async () => {
    const f = criarDb({ jit_horarios: { lista: [{ id: "h1" }, { id: "h2" }] } });
    dbUsuario.mockResolvedValue(f.db);
    const { excluirHorarioJit } = await acoes();
    const r = await excluirHorarioJit("web-1", {}, form({ id: "h2" }));
    expect(r).toEqual({ ok: true });
    expect(f.escritas("jit_horarios", "delete")).toHaveLength(1);
    expect(f.chamadas.filter((c) => c.metodo === "eq").map((c) => c.args)).toEqual(
      expect.arrayContaining([
        ["id", "h2"],
        ["webinar_id", "web-1"],
      ]),
    );
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ acao: "excluiu", antes: { id: "h2" } }));
  });

  it("horário de outro webinar: não encontrado", async () => {
    const f = criarDb({ jit_horarios: { lista: [{ id: "h1" }, { id: "h2" }] } });
    dbUsuario.mockResolvedValue(f.db);
    const { excluirHorarioJit } = await acoes();
    expect(await excluirHorarioJit("web-1", {}, form({ id: "outro" }))).toEqual({ erro: "Horário não encontrado." });
  });
});

describe("salvarConfigJit", () => {
  it("salva (upsert por webinar) com a data final no fuso", async () => {
    const f = criarDb({ jit_config: { unico: { fuso: "America/Sao_Paulo", exibicao: "todos" } } });
    dbUsuario.mockResolvedValue(f.db);
    const { salvarConfigJit } = await acoes();
    const r = await salvarConfigJit("web-1", {}, form({ fuso: "America/Sao_Paulo", esconder_de: "0", esconder_ate: "6", exibicao: "proximos_3", fim: "2026-12-31T23:00" }));
    expect(r).toEqual({ ok: true });
    expect(f.escritas("jit_config", "upsert")).toEqual([
      [
        { webinar_id: "web-1", fuso: "America/Sao_Paulo", esconder_de: 0, esconder_ate: 6, exibicao: "proximos_3", fim: "2027-01-01T02:00:00.000Z" },
        { onConflict: "webinar_id" },
      ],
    ]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Editou a configuração do just in time" }));
  });

  it("inválida: devolve o erro e os valores", async () => {
    const { salvarConfigJit } = await acoes();
    const campos = { fuso: "America/Sao_Paulo", esconder_de: "2", esconder_ate: "", exibicao: "todos" };
    expect(await salvarConfigJit("web-1", {}, form(campos))).toEqual({ erro: "Informe de que hora até que hora esconder.", valores: campos });
  });

  it("falha do banco: erro amigável", async () => {
    dbUsuario.mockResolvedValue(criarDb({ jit_config: { erroEscrita: { message: "x" } } }).db);
    const { salvarConfigJit } = await acoes();
    const r = await salvarConfigJit("web-1", {}, form({ fuso: "participante", exibicao: "todos" }));
    expect(r.erro).toBe("Não deu para salvar a configuração.");
  });
});

describe("salvarEmailJit", () => {
  it("salva o modelo (texto em modelo.texto) com upsert por webinar+tipo", async () => {
    const f = criarDb({});
    dbUsuario.mockResolvedValue(f.db);
    const { salvarEmailJit } = await acoes();
    const r = await salvarEmailJit(
      "web-1",
      {},
      form({ tipo: "lembrete", remetente_nome: "Paula", assunto: "Faltam {{minutos}}", texto: "Oi {{nome}}\r\n\r\n{{link}}", minutos_antes: "30" }),
    );
    expect(r).toEqual({ ok: true });
    expect(f.escritas("emails_jit", "upsert")).toEqual([
      [
        { webinar_id: "web-1", tipo: "lembrete", remetente_nome: "Paula", assunto: "Faltam {{minutos}}", modelo: { texto: "Oi {{nome}}\n\n{{link}}" }, minutos_antes: 30 },
        { onConflict: "webinar_id,tipo" },
      ],
    ]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: 'Editou o e-mail "Lembrete" do just in time' }));
  });

  it("assunto vazio: erro", async () => {
    const { salvarEmailJit } = await acoes();
    const r = await salvarEmailJit("web-1", {}, form({ tipo: "inscricao", remetente_nome: "G", assunto: " ", texto: "x" }));
    expect(r.erro).toMatch(/assunto/);
  });
});

describe("enviarTesteEmailJit", () => {
  const campos = { tipo: "inscricao", remetente_nome: "Paula", assunto: "Confirmado: {{webinar}}", texto: "Oi {{nome}}, {{webinar}} às {{hora}}." };

  it("sem Resend: avisa e não envia", async () => {
    const { enviarTesteEmailJit } = await acoes();
    const r = await enviarTesteEmailJit("web-1", {}, form(campos));
    expect(r.erro).toBe("Os e-mails ainda não estão configurados (falta a conta do Resend).");
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it("com Resend: manda pro e-mail do admin logado, com o remetente do cartão e as variáveis trocadas", async () => {
    emailConfig.mockReturnValue({ resendKey: "re_x", de: "Vórtex <no-reply@exemplo.com.br>" });
    dbUsuario.mockResolvedValue(
      criarDb({ webinars: { unico: { nome: "Aulão <IA>", slug: "aulao", idioma: "pt-BR" } }, jit_config: { unico: { fuso: "America/Sao_Paulo" } } }).db,
    );
    const { enviarTesteEmailJit } = await acoes();
    const r = await enviarTesteEmailJit("web-1", {}, form(campos));
    expect(r).toEqual({ ok: true, mensagem: "Teste enviado para paula@exemplo.com." });
    expect(enviarEmail).toHaveBeenCalledTimes(1);
    const [cfg, msg] = enviarEmail.mock.calls[0] as [unknown, { de: string; para: string; assunto: string; html: string; texto: string }];
    expect(cfg).toEqual({ resendKey: "re_x", de: "Vórtex <no-reply@exemplo.com.br>" });
    expect(msg.de).toBe("Paula <no-reply@exemplo.com.br>");
    expect(msg.para).toBe("paula@exemplo.com");
    expect(msg.assunto).toBe("[Teste] Confirmado: Aulão <IA>");
    expect(msg.html).toContain("Oi Paula, Aulão &lt;IA&gt; às");
    expect(msg.texto).toContain("Oi Paula, Aulão <IA> às");
  });

  it("erro do Resend vira a mensagem do resultado", async () => {
    emailConfig.mockReturnValue({ resendKey: "re_x", de: "no-reply@exemplo.com.br" });
    enviarEmail.mockRejectedValue(new Error("O Resend recusou o e-mail (HTTP 403)."));
    dbUsuario.mockResolvedValue(criarDb({ webinars: { unico: { nome: "Aulão", slug: "aulao", idioma: "pt-BR" } } }).db);
    const { enviarTesteEmailJit } = await acoes();
    const r = await enviarTesteEmailJit("web-1", {}, form(campos));
    expect(r.erro).toBe("O Resend recusou o e-mail (HTTP 403).");
  });
});

describe("escolherTipoAgenda", () => {
  const acoesAgenda = () => import("../app/(painel)/webinars/[id]/agenda/actions");

  it("Just in time: grava tipo_agenda = 'jit', audita e abre a aba do JIT", async () => {
    const f = criarDb({ webinars: { unico: { tipo_agenda: "unica" } } });
    dbUsuario.mockResolvedValue(f.db);
    const { escolherTipoAgenda } = await acoesAgenda();
    await expect(escolherTipoAgenda("web-1", form({ tipo: "jit" }))).rejects.toThrow("REDIRECT:/webinars/web-1/agenda/jit");
    expect(f.escritas("webinars", "update")).toEqual([[{ tipo_agenda: "jit" }]]);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ descricao: "Mudou a agenda para just in time" }));
  });

  it("voltar do JIT: usa a repetição salva (semanal → recorrente)", async () => {
    const f = criarDb({ webinars: { unico: { tipo_agenda: "jit" } }, agendas: { unico: { repeticao: "semanal" } } });
    dbUsuario.mockResolvedValue(f.db);
    const { escolherTipoAgenda } = await acoesAgenda();
    await expect(escolherTipoAgenda("web-1", form({ tipo: "agenda" }))).rejects.toThrow("REDIRECT:/webinars/web-1/agenda");
    expect(f.escritas("webinars", "update")).toEqual([[{ tipo_agenda: "recorrente" }]]);
  });

  it("já está no tipo escolhido: só redireciona, sem gravar", async () => {
    const f = criarDb({ webinars: { unico: { tipo_agenda: "unica" } }, agendas: { unico: { repeticao: "nenhuma" } } });
    dbUsuario.mockResolvedValue(f.db);
    const { escolherTipoAgenda } = await acoesAgenda();
    await expect(escolherTipoAgenda("web-1", form({ tipo: "agenda" }))).rejects.toThrow("REDIRECT:/webinars/web-1/agenda");
    expect(f.escritas("webinars", "update")).toEqual([]);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});
