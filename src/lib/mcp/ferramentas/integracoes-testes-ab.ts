import "server-only";
import {
  carregarTeste,
  linkDoTeste,
  listarTestesPagina,
  periodoTexto,
  situacaoTeste,
  STATUS_TESTE,
  type StatusTesteFiltro,
  type TestePainel,
} from "../../../../app/(painel)/testes-ab/dados";
import { idValido } from "../../regras/midia";
import { POR_PAGINA_LISTA } from "../../regras/filtros-lista";
import { validarTesteAb, type DadosTesteAb, type EntradaTesteAb, type VariacaoAb } from "../../regras/teste-ab";
import { dbAdmin } from "../../supabase/admin";
import { ALTERA, auditar, CRIA, erro, inteiro, linkPainel, SO_LEITURA, texto, UUID, type Ferramenta } from "../comum";

/** Teste A/B (2 a 4 webinars num link `/t/<slug>`), com a mesma lógica de `app/(painel)/testes-ab/actions.ts`. */

type Db = ReturnType<typeof dbAdmin>;
// As consultas de `testes-ab/dados.ts` são tipadas com o cliente do usuário; aqui vai a service role (mesma API).
type DbPainel = Parameters<typeof carregarTeste>[0];
const comoPainel = (db: Db) => db as unknown as DbPainel;

const NAO_ENCONTRADO = "Teste não encontrado.";
const LINK_EM_USO = "Este link já está em uso.";
const FUSO_PADRAO = "America/Sao_Paulo";

async function slugsOcupados(db: Db, slug: string, idAtual: string | null): Promise<string[]> {
  const s = slug.trim();
  if (!s) return [];
  const { data: webinars } = await db.from("webinars").select("id").eq("slug", s).limit(1);
  if ((webinars ?? []).length) return [s];
  let consulta = db.from("testes_ab").select("id").eq("slug", s);
  if (idAtual) consulta = consulta.neq("id", idAtual);
  const { data: testes } = await consulta.limit(1);
  return (testes ?? []).length ? [s] : [];
}

async function webinarsAtivos(db: Db, entrada: EntradaTesteAb): Promise<string[]> {
  const ids = [...new Set((entrada.variacoes ?? []).map((v) => (v.webinar_id ?? "").trim()).filter(idValido))];
  if (!ids.length) return [];
  const { data } = await db.from("webinars").select("id").in("id", ids).eq("status", "ativo");
  return ((data ?? []) as { id: string }[]).map((w) => w.id);
}

async function temParticipantes(db: Db, testeId: string): Promise<boolean> {
  const { data } = await db.from("sessoes").select("id").eq("teste_ab_id", testeId).limit(1);
  return (data ?? []).length > 0;
}

async function variacoesAtuais(db: Db, testeId: string): Promise<VariacaoAb[]> {
  const { data } = await db.from("testes_ab_variacoes").select("webinar_id, percentual, ordem").eq("teste_id", testeId).order("ordem");
  return ((data ?? []) as { webinar_id: string; percentual: number }[]).map((v) => ({ webinarId: v.webinar_id, percentual: v.percentual }));
}

const linhasVariacoes = (testeId: string, vs: VariacaoAb[]) => vs.map((v, ordem) => ({ teste_id: testeId, webinar_id: v.webinarId, ordem, percentual: v.percentual }));

const resumo = (d: DadosTesteAb) => ({ nome: d.nome, slug: d.slug, inicio: d.inicio.toISOString(), fim: d.fim.toISOString(), fuso: d.fuso, variacoes: d.variacoes });

const ehSlugDuplicado = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "23505";

/** Variações dos args (`[{webinar_id, percentual}]`) → entrada do validador; ausente → `null`. */
function variacoesDosArgs(v: unknown): EntradaTesteAb["variacoes"] | "invalido" {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) return "invalido";
  return v.map((x) => {
    const o = (x && typeof x === "object" ? x : {}) as { webinar_id?: unknown; percentual?: unknown };
    return {
      webinar_id: typeof o.webinar_id === "string" ? o.webinar_id : "",
      percentual: typeof o.percentual === "number" || typeof o.percentual === "string" ? o.percentual : null,
    };
  });
}

function testeParaSaida(t: TestePainel, agora = new Date()) {
  return {
    id: t.id,
    nome: t.nome,
    slug: t.slug,
    link: linkDoTeste(t.slug),
    situacao: situacaoTeste(t, agora).rotulo,
    inicio: t.inicio.toISOString(),
    fim: t.fim.toISOString(),
    fuso: t.fuso,
    periodo: periodoTexto(t),
    arquivado: t.arquivado,
    variacoes: t.variacoes.map((v) => ({ letra: v.letra, webinar_id: v.webinarId, webinar: v.nome, webinar_ativo: v.ativo, percentual: v.percentual })),
  };
}

const VARIACOES = {
  type: "array",
  minItems: 2,
  maxItems: 4,
  description: "De 2 a 4 variações, na ordem A, B, C, D. Webinars ativos e diferentes; percentuais inteiros somando 100.",
  items: {
    type: "object",
    properties: {
      webinar_id: { type: "string", format: "uuid", description: "Id do webinar da variação." },
      percentual: { type: "integer", minimum: 1, maximum: 100, description: "Fatia do tráfego (%)." },
    },
    required: ["webinar_id", "percentual"],
    additionalProperties: false,
  },
} as const;

const DATA = 'Data e hora "AAAA-MM-DDTHH:mm" no fuso do teste (ou ISO com fuso, ex.: 2026-10-25T20:00:00-03:00).';

const CAMPOS = {
  nome: { type: "string", description: "Nome do teste (até 120 caracteres)." },
  slug: { type: "string", description: "Endereço do link (/t/<slug>): minúsculas, números e hífen; não pode repetir o de outro teste nem de um webinar." },
  inicio: { type: "string", description: `Início. ${DATA}` },
  fim: { type: "string", description: `Fim (não pode vir antes do início). ${DATA}` },
  fuso: { type: "string", description: `Fuso IANA das datas (padrão ${FUSO_PADRAO}).` },
  variacoes: VARIACOES,
} as const;

// --- Ferramentas ------------------------------------------------------------------------------------------------

const listarTestesAb: Ferramenta = {
  name: "listar_testes_ab",
  title: "Listar testes A/B",
  description: "Lista os testes A/B (link /t/<slug> que divide o tráfego entre 2 a 4 webinars): nome, link, situação (No ar, Agendado, Encerrado, Arquivado), período e variações. 10 por página.",
  inputSchema: {
    type: "object",
    properties: {
      busca: { type: "string", description: "Parte do nome." },
      status: { type: "string", enum: STATUS_TESTE.map((s) => s.valor), description: "Filtro: todos, no_ar, agendados, encerrados, arquivados (padrão todos)." },
      pagina: { type: "integer", minimum: 1, description: "Página (padrão 1)." },
    },
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const status = (STATUS_TESTE.map((s) => s.valor) as string[]).includes(String(args.status)) ? (args.status as StatusTesteFiltro) : "todos";
    const pagina = inteiro(args.pagina, 1, 1, 100000);
    const busca = typeof args.busca === "string" ? args.busca.trim() : "";
    const r = await listarTestesPagina(comoPainel(dbAdmin()), { busca, ordem: "recentes", status, pagina });
    if (r.erro) return erro(r.erro);
    return texto({ total: r.total, pagina, por_pagina: POR_PAGINA_LISTA, testes: r.testes.map((t) => testeParaSaida(t)) });
  },
};

const verTesteAb: Ferramenta = {
  name: "ver_teste_ab",
  title: "Ver teste A/B",
  description: "Detalhe de um teste A/B: link pra divulgar, situação, período, variações (letra, webinar, percentual) e se já tem participantes (com participantes, as variações não podem mais mudar).",
  inputSchema: { type: "object", properties: { teste_id: { ...UUID, description: "Id do teste (listar_testes_ab)." } }, required: ["teste_id"], additionalProperties: false },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    if (!idValido(String(args.teste_id ?? ""))) return erro(NAO_ENCONTRADO);
    const db = dbAdmin();
    const t = await carregarTeste(comoPainel(db), args.teste_id as string);
    if (!t) return erro(NAO_ENCONTRADO);
    return texto({
      ...testeParaSaida(t),
      tem_participantes: await temParticipantes(db, t.id),
      painel: linkPainel(`/testes-ab/${t.id}`),
      metricas: linkPainel(`/testes-ab/${t.id}/metricas`),
    });
  },
};

const criarTesteAb: Ferramenta = {
  name: "criar_teste_ab",
  title: "Criar teste A/B",
  description: "Cria um teste A/B: um link /t/<slug> que divide o tráfego entre 2 a 4 webinars ativos pelo percentual (cada pessoa cai sempre na mesma variação). Devolve o link pra divulgar.",
  inputSchema: { type: "object", properties: CAMPOS, required: ["nome", "slug", "inicio", "fim", "variacoes"], additionalProperties: false },
  annotations: CRIA,
  escrita: true,
  async executar(chave, args) {
    const variacoes = variacoesDosArgs(args.variacoes);
    if (variacoes === "invalido") return erro("Escolha de 2 a 4 webinars.");
    const str = (k: string, padrao = "") => (typeof args[k] === "string" ? (args[k] as string) : padrao);
    const entrada: EntradaTesteAb = { nome: str("nome"), slug: str("slug"), inicio: str("inicio"), fim: str("fim"), fuso: str("fuso", FUSO_PADRAO), variacoes: variacoes ?? [] };
    const db = dbAdmin();
    const r = validarTesteAb(entrada, { slugsOcupados: await slugsOcupados(db, entrada.slug ?? "", null), webinarsAtivos: await webinarsAtivos(db, entrada) });
    if ("erro" in r) return erro(r.erro);
    const d = r.dados;

    const { data, error } = await db
      .from("testes_ab")
      .insert({ nome: d.nome, slug: d.slug, inicio: d.inicio.toISOString(), fim: d.fim.toISOString(), fuso: d.fuso })
      .select("id")
      .single();
    if (error || !data) return erro(ehSlugDuplicado(error) ? LINK_EM_USO : "Não deu para criar o teste.");
    const id = (data as { id: string }).id;

    const { error: erroVariacoes } = await db.from("testes_ab_variacoes").insert(linhasVariacoes(id, d.variacoes));
    if (erroVariacoes) {
      // Sem as variações o link não funciona: desfaz o teste em vez de deixar um teste vazio (idêntico ao painel).
      await db.from("testes_ab").delete().eq("id", id);
      return erro("Não deu para salvar as variações do teste.");
    }

    await auditar(chave, { acao: "criou", descricao: `Criou o teste A/B "${d.nome}"`, depois: { id, ...resumo(d) } });
    return texto({ ok: true, id, link: linkDoTeste(d.slug), painel: linkPainel(`/testes-ab/${id}`) });
  },
};

const editarTesteAb: Ferramenta = {
  name: "editar_teste_ab",
  title: "Editar teste A/B",
  description:
    "Edita um teste A/B. Só os campos enviados mudam. Com participantes já gravados, só nome, link e datas podem mudar (variações travadas); sem participantes, mandar `variacoes` troca todas.",
  inputSchema: {
    type: "object",
    properties: { teste_id: { ...UUID, description: "Id do teste (listar_testes_ab)." }, ...CAMPOS },
    required: ["teste_id"],
    additionalProperties: false,
  },
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const id = String(args.teste_id ?? "");
    if (!idValido(id)) return erro(NAO_ENCONTRADO);
    const variacoesNovas = variacoesDosArgs(args.variacoes);
    if (variacoesNovas === "invalido") return erro("Escolha de 2 a 4 webinars.");
    const db = dbAdmin();

    const { data: antesData } = await db.from("testes_ab").select("nome, slug, inicio, fim, fuso").eq("id", id).maybeSingle();
    if (!antesData) return erro(NAO_ENCONTRADO);
    const antes = antesData as { nome: string; slug: string; inicio: string; fim: string; fuso: string };
    const comParticipantes = await temParticipantes(db, id);
    const atuais = await variacoesAtuais(db, id);

    // Merge parcial: o que não veio fica como está (datas salvas vão como ISO com fuso, que o validador aceita).
    const str = (k: string, atual: string) => (typeof args[k] === "string" ? (args[k] as string) : atual);
    const entrada: EntradaTesteAb = {
      nome: str("nome", antes.nome),
      slug: str("slug", antes.slug),
      inicio: str("inicio", antes.inicio),
      fim: str("fim", antes.fim),
      fuso: str("fuso", antes.fuso),
      variacoes: variacoesNovas ?? (comParticipantes ? null : atuais.map((v) => ({ webinar_id: v.webinarId, percentual: v.percentual }))),
    };

    const r = validarTesteAb(entrada, {
      slugsOcupados: await slugsOcupados(db, entrada.slug ?? "", id),
      webinarsAtivos: await webinarsAtivos(db, entrada),
      temParticipantes: comParticipantes,
      variacoesAtuais: atuais,
    });
    if ("erro" in r) return erro(r.erro);
    const d = r.dados;

    const { error } = await db
      .from("testes_ab")
      .update({ nome: d.nome, slug: d.slug, inicio: d.inicio.toISOString(), fim: d.fim.toISOString(), fuso: d.fuso })
      .eq("id", id);
    if (error) return erro(ehSlugDuplicado(error) ? LINK_EM_USO : "Não deu para salvar o teste.");

    if (!comParticipantes) {
      const { error: erroApagar } = await db.from("testes_ab_variacoes").delete().eq("teste_id", id);
      if (erroApagar) return erro("Não deu para salvar as variações do teste.");
      const { error: erroInserir } = await db.from("testes_ab_variacoes").insert(linhasVariacoes(id, d.variacoes));
      if (erroInserir) {
        if (atuais.length) await db.from("testes_ab_variacoes").insert(linhasVariacoes(id, atuais));
        return erro("Não deu para salvar as variações do teste.");
      }
    }

    await auditar(chave, { acao: "editou", descricao: `Editou o teste A/B "${d.nome}"`, antes: { ...antes, variacoes: atuais }, depois: resumo(d) });
    return texto({ ok: true, id, link: linkDoTeste(d.slug) });
  },
};

const arquivarTesteAb: Ferramenta = {
  name: "arquivar_teste_ab",
  title: "Arquivar ou reativar teste A/B",
  description: 'Arquiva (arquivado=true, padrão) ou reativa (arquivado=false) um teste A/B. Arquivado, o link mostra "Este link não está disponível agora."; sessões e métricas continuam.',
  inputSchema: {
    type: "object",
    properties: {
      teste_id: { ...UUID, description: "Id do teste (listar_testes_ab)." },
      arquivado: { type: "boolean", description: "true arquiva (padrão), false reativa." },
    },
    required: ["teste_id"],
    additionalProperties: false,
  },
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const id = String(args.teste_id ?? "");
    const arquivado = args.arquivado !== false;
    if (!idValido(id)) return erro(NAO_ENCONTRADO);
    const db = dbAdmin();
    const { data: antes } = await db.from("testes_ab").select("nome, arquivado").eq("id", id).maybeSingle();
    if (!antes) return erro(NAO_ENCONTRADO);
    const { error } = await db.from("testes_ab").update({ arquivado }).eq("id", id);
    if (error) return erro(arquivado ? "Não deu para arquivar o teste." : "Não deu para reativar o teste.");

    const a = antes as { nome: string; arquivado: boolean };
    await auditar(chave, {
      acao: "editou",
      descricao: `${arquivado ? "Arquivou" : "Reativou"} o teste A/B "${a.nome}"`,
      antes: { arquivado: a.arquivado },
      depois: { arquivado },
    });
    return texto({ ok: true, arquivado });
  },
};

export const FERRAMENTAS_TESTES_AB: Ferramenta[] = [listarTestesAb, verTesteAb, criarTesteAb, editarTesteAb, arquivarTesteAb];
