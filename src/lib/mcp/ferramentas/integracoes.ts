import "server-only";
import { buscarHistorico } from "../../historico";
import { filtrosHistorico, ITENS_POR_PAGINA_HISTORICO } from "../../regras/auditoria";
import { escaparIlike } from "../../regras/lista-webinars";
import { idValido } from "../../regras/midia";
import { MAX_NOME_PAGINA, TIPOS_PAGINA, validarNomePagina, type TipoPagina } from "../../regras/paginas";
import { ROTULO_LUGAR, ROTULO_TIPO_PAGINA } from "../../regras/paginas-editor";
import { dbAdmin } from "../../supabase/admin";
import { ALTERA, auditar, CRIA, erro, inteiro, linkPainel, PERIODO, SO_LEITURA, texto, UUID, WEBINAR, type Ferramenta } from "../comum";
import { FERRAMENTAS_CHECKOUTS } from "./integracoes-checkouts";
import { FERRAMENTAS_REGRAS, nomeDoWebinar } from "./integracoes-regras";
import { FERRAMENTAS_TESTES_AB } from "./integracoes-testes-ab";

/** Integrações e cadastros gerais: regras de webhook (`integracoes-regras.ts`), checkouts (`integracoes-checkouts.ts`),
 *  teste A/B (`integracoes-testes-ab.ts`) e, aqui, páginas, equipe e o Histórico de ações. Mesma lógica das telas e
 *  actions do painel. */

const NAO_ENCONTRADA = "Página não encontrada.";
const POR_PAGINA = 50;

// --- Páginas ----------------------------------------------------------------------------------------------------

type Uso = { webinar_id: string; webinar: string; lugar: string };

/** Onde cada página é usada (just in time: registro/espera; agenda: espera), como `vinculosDaPagina`, mas de uma vez
 *  pra lista toda. */
async function usosDasPaginas(ids: string[]): Promise<Map<string, Uso[]> | null> {
  const usos = new Map<string, Uso[]>();
  if (!ids.length) return usos;
  const db = dbAdmin();
  const [registro, espera, agendas] = await Promise.all([
    db.from("jit_config").select("webinar_id, pagina_registro_id, webinars(nome)").in("pagina_registro_id", ids),
    db.from("jit_config").select("webinar_id, pagina_espera_id, webinars(nome)").in("pagina_espera_id", ids),
    db.from("agendas").select("webinar_id, pagina_espera_id, webinars(nome)").in("pagina_espera_id", ids),
  ]);
  if (registro.error || espera.error || agendas.error) return null;
  const somar = (paginaId: string, webinarId: string, nome: string | undefined, lugar: TipoPagina) =>
    usos.set(paginaId, [...(usos.get(paginaId) ?? []), { webinar_id: webinarId, webinar: nome ?? "Webinar", lugar: ROTULO_LUGAR[lugar] }]);
  type L = { webinar_id: string; pagina_registro_id?: string; pagina_espera_id?: string; webinars: { nome: string } | null };
  for (const l of (registro.data ?? []) as unknown as L[]) somar(l.pagina_registro_id!, l.webinar_id, l.webinars?.nome, "registro_jit");
  for (const l of (espera.data ?? []) as unknown as L[]) somar(l.pagina_espera_id!, l.webinar_id, l.webinars?.nome, "espera_jit");
  for (const l of (agendas.data ?? []) as unknown as L[]) somar(l.pagina_espera_id!, l.webinar_id, l.webinars?.nome, "espera_unica");
  return usos;
}

const listarPaginas: Ferramenta = {
  name: "listar_paginas",
  title: "Listar páginas",
  description:
    "Lista as páginas de registro/espera feitas no editor (Páginas): id, nome, tipo, modelo e em quais webinars cada uma é usada. A edição visual fica só no editor do painel (o link vem junto). 50 por página.",
  inputSchema: {
    type: "object",
    properties: {
      busca: { type: "string", description: "Parte do nome." },
      tipo: { type: "string", enum: [...TIPOS_PAGINA], description: "registro_jit, espera_jit ou espera_unica (padrão: todos)." },
      pagina: { type: "integer", minimum: 1, description: "Página (padrão 1)." },
    },
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const pagina = inteiro(args.pagina, 1, 1, 100000);
    let consulta = dbAdmin().from("paginas").select("id, nome, tipo, modelo, updated_at", { count: "exact" }).order("created_at", { ascending: false }).order("id");
    if ((TIPOS_PAGINA as readonly string[]).includes(String(args.tipo))) consulta = consulta.eq("tipo", args.tipo as string);
    const busca = typeof args.busca === "string" ? args.busca.trim() : "";
    if (busca) consulta = consulta.ilike("nome", `%${escaparIlike(busca)}%`);
    const desde = (pagina - 1) * POR_PAGINA;
    const { data, count, error } = await consulta.range(desde, desde + POR_PAGINA - 1);
    if (error) return erro("Não deu para carregar as páginas. Tente de novo.");
    const linhas = (data ?? []) as { id: string; nome: string; tipo: TipoPagina; modelo: string; updated_at: string }[];
    const usos = await usosDasPaginas(linhas.map((p) => p.id));
    if (!usos) return erro("Não deu para ler os webinars vinculados.");
    return texto({
      total: count ?? 0,
      pagina,
      por_pagina: POR_PAGINA,
      paginas: linhas.map((p) => ({
        id: p.id,
        nome: p.nome,
        tipo: p.tipo,
        tipo_rotulo: ROTULO_TIPO_PAGINA[p.tipo] ?? p.tipo,
        modelo: p.modelo,
        atualizada_em: p.updated_at,
        usada_em: usos.get(p.id) ?? [],
        editor: linkPainel(`/paginas/${p.id}/editor`),
      })),
    });
  },
};

const renomearPagina: Ferramenta = {
  name: "renomear_pagina",
  title: "Renomear página",
  description: "Troca o nome de uma página do editor (o conteúdo e os vínculos com webinars não mudam).",
  inputSchema: {
    type: "object",
    properties: { pagina_id: { ...UUID, description: "Id da página (listar_paginas)." }, nome: { type: "string", description: `Nome novo (até ${MAX_NOME_PAGINA} caracteres).` } },
    required: ["pagina_id", "nome"],
    additionalProperties: false,
  },
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const nome = typeof args.nome === "string" ? args.nome : "";
    const erroNome = validarNomePagina(nome);
    if (erroNome) return erro(erroNome);
    const id = String(args.pagina_id ?? "");
    if (!idValido(id)) return erro(NAO_ENCONTRADA);
    const novo = nome.trim();
    const db = dbAdmin();
    const { data: antes } = await db.from("paginas").select("nome").eq("id", id).maybeSingle();
    if (!antes) return erro(NAO_ENCONTRADA);
    const { error } = await db.from("paginas").update({ nome: novo, atualizado_por: chave.usuarioId }).eq("id", id);
    if (error) return erro("Não deu para renomear a página.");
    await auditar(chave, {
      acao: "editou",
      descricao: `Renomeou a página "${(antes as { nome: string }).nome}" para "${novo}"`,
      antes: antes as Record<string, unknown>,
      depois: { nome: novo },
    });
    return texto({ ok: true, nome: novo });
  },
};

const duplicarPagina: Ferramenta = {
  name: "duplicar_pagina",
  title: "Duplicar página",
  description: 'Cria uma cópia da página com "(cópia)" no nome (mesmo conteúdo, sem os vínculos: cada webinar escolhe a sua). Devolve o id e o link do editor.',
  inputSchema: { type: "object", properties: { pagina_id: { ...UUID, description: "Id da página (listar_paginas)." } }, required: ["pagina_id"], additionalProperties: false },
  annotations: CRIA,
  escrita: true,
  async executar(chave, args) {
    const id = String(args.pagina_id ?? "");
    if (!idValido(id)) return erro(NAO_ENCONTRADA);
    const db = dbAdmin();
    const { data: original } = await db.from("paginas").select("nome, tipo, modelo, config, componentes, html, css").eq("id", id).maybeSingle();
    if (!original) return erro(NAO_ENCONTRADA);
    const o = original as { nome: string; tipo: string; modelo: string; config: unknown; componentes: unknown; html: string; css: string };

    const sufixo = " (cópia)";
    const nome = `${o.nome.slice(0, MAX_NOME_PAGINA - sufixo.length)}${sufixo}`;
    const { data, error } = await db
      .from("paginas")
      .insert({ nome, tipo: o.tipo, modelo: o.modelo, config: o.config, componentes: o.componentes, html: o.html, css: o.css, atualizado_por: chave.usuarioId })
      .select("id")
      .single();
    if (error || !data) return erro("Não deu para duplicar a página.");
    const novoId = (data as { id: string }).id;
    await auditar(chave, { acao: "criou", descricao: `Duplicou a página "${o.nome}"`, depois: { id: novoId, nome } });
    return texto({ ok: true, id: novoId, nome, editor: linkPainel(`/paginas/${novoId}/editor`) });
  },
};

// --- Equipe -----------------------------------------------------------------------------------------------------

const listarEquipe: Ferramenta = {
  name: "listar_equipe",
  title: "Listar equipe",
  description: "Lista os usuários do painel (Equipe): nome, e-mail, papel (admin ou atendente) e se está ativo. Criar usuário, trocar senha ou papel fica só no painel.",
  inputSchema: {
    type: "object",
    properties: {
      busca: { type: "string", description: "Parte do nome ou do e-mail." },
      papel: { type: "string", enum: ["admin", "atendente"], description: "Só este papel (opcional)." },
      ativo: { type: "boolean", description: "true só ativos, false só desativados (padrão: todos)." },
    },
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    let consulta = dbAdmin().from("usuarios").select("id, nome, email, papel, ativo").order("nome").order("id").limit(1000);
    if (args.papel === "admin" || args.papel === "atendente") consulta = consulta.eq("papel", args.papel);
    if (typeof args.ativo === "boolean") consulta = consulta.eq("ativo", args.ativo);
    // Vírgula e parênteses quebram o filtro `or` do PostgREST: saem do termo (igual à tela).
    const termo = escaparIlike((typeof args.busca === "string" ? args.busca : "").replace(/[,()]/g, " ").trim());
    if (termo) consulta = consulta.or(`nome.ilike.%${termo}%,email.ilike.%${termo}%`);
    const { data, error } = await consulta;
    if (error) return erro("Não deu para carregar a equipe.");
    const pessoas = (data ?? []) as { id: string; nome: string; email: string; papel: string; ativo: boolean }[];
    return texto({ total: pessoas.length, equipe: pessoas });
  },
};

// --- Histórico de ações -----------------------------------------------------------------------------------------

const verHistorico: Ferramenta = {
  name: "ver_historico",
  title: "Ver histórico de ações",
  description:
    "Histórico de ações do painel (quem fez o quê, quando e em qual webinar), mais recente primeiro; inclui o que foi feito pelo MCP (marcado com \"(MCP)\"). Filtra por webinar, ação, texto e período. 50 por página.",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: { ...WEBINAR, description: "Só o histórico deste webinar (opcional; sem ele, o geral)." },
      acao: { type: "string", enum: ["todas", "criou", "editou", "excluiu"], description: "Tipo de ação (padrão todas)." },
      busca: { type: "string", description: "Parte da descrição (ex.: \"oferta\", \"(MCP)\")." },
      de: { ...PERIODO.de, description: "Data inicial AAAA-MM-DD (horário de Brasília). Opcional." },
      ate: PERIODO.ate,
      pagina: { type: "integer", minimum: 1, description: "Página (padrão 1)." },
    },
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const db = dbAdmin();
    let webinarId: string | undefined;
    if (args.webinar_id !== undefined) {
      if (!(await nomeDoWebinar(db, args.webinar_id))) return erro("Webinar não encontrado.");
      webinarId = args.webinar_id as string;
    }
    const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);
    const filtros = filtrosHistorico({ acao: s("acao"), busca: s("busca"), de: s("de"), ate: s("ate"), pagina: args.pagina === undefined ? undefined : String(args.pagina) });
    const r = await buscarHistorico(db as unknown as Parameters<typeof buscarHistorico>[0], filtros, webinarId);
    if (r.erro) return erro(r.erro);
    return texto({
      total: r.total,
      pagina: filtros.pagina,
      por_pagina: ITENS_POR_PAGINA_HISTORICO,
      acoes: r.linhas.map((l) => ({
        data: l.criado_em,
        quem: l.usuario_nome,
        acao: l.acao,
        descricao: l.descricao,
        webinar: l.webinar_nome,
        ...(l.antes ? { antes: l.antes } : {}),
        ...(l.depois ? { depois: l.depois } : {}),
      })),
    });
  },
};

export const FERRAMENTAS_INTEGRACOES: Ferramenta[] = [
  ...FERRAMENTAS_REGRAS,
  ...FERRAMENTAS_CHECKOUTS,
  ...FERRAMENTAS_TESTES_AB,
  listarPaginas,
  renomearPagina,
  duplicarPagina,
  listarEquipe,
  verHistorico,
];
