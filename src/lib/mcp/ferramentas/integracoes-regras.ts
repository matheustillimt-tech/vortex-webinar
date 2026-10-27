import "server-only";
import { cifrar, decifrar } from "../../crypto";
import { enviarTeste } from "../../disparos";
import { GATILHOS, rotuloGatilho, validarRegra, type CandidataRegra, type Gatilho } from "../../regras/regras-webhook";
import { lerDuracao } from "../../regras/video";
import { dbAdmin } from "../../supabase/admin";
import { ALTERA, APAGA, auditar, CRIA, ehUuid, erro, inteiro, linkPainel, SO_LEITURA, texto, UUID, WEBINAR, type Ferramenta } from "../comum";

/** Regras de webhook do webinar (Configurações → Integrações do webinar) (mesma validação de `app/(painel)/configuracoes/integracoes/[id]/
 *  actions.ts`). Os headers chegam em texto, são cifrados como no painel e nunca voltam decifrados: a listagem só
 *  mostra os NOMES deles. */

type Db = ReturnType<typeof dbAdmin>;

type RegraBanco = {
  id: string;
  gatilho: Gatilho;
  valor_seg: number | null;
  url: string;
  metodo: string;
  headers_enc: string | null;
  params: Record<string, string> | null;
  corpo: string | null;
  ativa: boolean;
};

const NAO_ENCONTRADA = "Regra não encontrada.";
const WEBINAR_NAO_ENCONTRADO = "Webinar não encontrado.";

/** Webinar existe? Devolve o nome (pra mensagens) ou `null`. */
export async function nomeDoWebinar(db: Db, webinarId: unknown): Promise<string | null> {
  if (!ehUuid(webinarId)) return null;
  const { data } = await db.from("webinars").select("nome").eq("id", webinarId).maybeSingle();
  return (data as { nome: string } | null)?.nome ?? null;
}

/** Mesmo que `headersAntigos` da action: headers salvos decifrados (só uso interno, nunca vão na saída). */
function headersSalvos(headersEnc: string | null): [string, string][] {
  if (!headersEnc) return [];
  try {
    const d = JSON.parse(decifrar(headersEnc));
    return Array.isArray(d) ? (d as [string, string][]) : [];
  } catch {
    return [];
  }
}

/** `{ "Authorization": "Bearer x" }` → pares `[chave, valor]`, como as linhas do formulário do painel (linha toda
 *  vazia some; chave com espaço nas pontas é aparada). Não é objeto → `null`. */
function paresDeObjeto(v: unknown): [string, string][] | null {
  if (v === undefined || v === null) return [];
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const pares: [string, string][] = [];
  for (const [k, valor] of Object.entries(v as Record<string, unknown>)) {
    const chave = k.trim();
    const texto = valor === null || valor === undefined ? "" : String(valor);
    if (!chave && !texto) continue;
    pares.push([chave, texto]);
  }
  return pares;
}

/** Tempo do gatilho `permaneceu`/`abandonou`: "h:mm:ss", "mm:ss" (como no painel) ou número de segundos. */
function lerTempo(v: unknown): { valorSeg: number | null } | { erro: string } {
  if (v === undefined || v === null || v === "") return { valorSeg: null };
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? { valorSeg: v } : { erro: "Tempo inválido (h:mm:ss)." };
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return { valorSeg: Number(s) };
  const seg = lerDuracao(s);
  return seg === null ? { erro: "Tempo inválido (h:mm:ss)." } : { valorSeg: seg };
}

function duracaoTexto(seg: number | null): string | null {
  if (seg === null) return null;
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function regraParaSaida(r: RegraBanco) {
  return {
    id: r.id,
    gatilho: r.gatilho,
    gatilho_rotulo: rotuloGatilho(r.gatilho),
    tempo: duracaoTexto(r.valor_seg),
    url: r.url,
    metodo: r.metodo,
    headers: headersSalvos(r.headers_enc).map(([chave]) => chave),
    params: r.params ?? {},
    corpo: r.corpo,
    ativa: r.ativa,
  };
}

const SELECT_REGRA = "id, gatilho, valor_seg, url, metodo, headers_enc, params, corpo, ativa";

async function lerRegra(db: Db, webinarId: string, regraId: unknown): Promise<RegraBanco | null> {
  if (!ehUuid(regraId)) return null;
  const { data } = await db.from("regras").select(SELECT_REGRA).eq("id", regraId).eq("webinar_id", webinarId).maybeSingle();
  return (data as RegraBanco | null) ?? null;
}

const linkIntegracoes = (webinarId: string) => linkPainel(`/configuracoes/integracoes/${webinarId}`);

// --- Esquema comum das regras ---------------------------------------------------------------------------------

const CAMPOS_REGRA = {
  gatilho: {
    type: "string",
    enum: [...GATILHOS],
    description:
      "Quando dispara: acessou (acessou a sala), inscreveu_lp (inscreveu na página do just in time), cadastrou, permaneceu (ficou X tempo), abandonou (saiu antes de X tempo), pitch, oferta, clicou_oferta, nao_viu_oferta.",
  },
  tempo: {
    type: ["string", "integer"],
    description: 'Só pra permaneceu/abandonou: "h:mm:ss", "mm:ss" ou segundos (ex.: "0:30:00" ou 1800).',
  },
  url: { type: "string", description: "Endereço https público que recebe o webhook." },
  metodo: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "Método HTTP (padrão POST na criação)." },
  headers: {
    type: "object",
    additionalProperties: { type: "string" },
    description: 'Headers em texto, ex.: {"Authorization": "Bearer xyz"}. Ficam cifrados; depois só os nomes aparecem. Máximo 20.',
  },
  params: {
    type: "object",
    additionalProperties: { type: "string" },
    description: "Parâmetros da URL (query). Aceitam variáveis {{NOME}}, {{EMAIL}}, {{TELEFONE}}, {{TAG}}, {{DATA}}, {{UTMS}}, {{TEMPO}}, {{WEBINAR}}.",
  },
  corpo: {
    type: ["string", "null"],
    description: "Corpo da requisição (JSON vira application/json; aceita as mesmas variáveis {{...}}). null/vazio = sem corpo.",
  },
} as const;

type Montada = { candidata: CandidataRegra } | { erro: string };

/** Monta a candidata do validador a partir dos args (já mesclados com a regra atual, na edição). */
function montarCandidata(a: { gatilho: unknown; tempo: unknown; url: unknown; metodo: unknown; headers: [string, string][]; params: unknown; corpo: unknown }): Montada {
  const gatilho = typeof a.gatilho === "string" ? a.gatilho : "";
  const tempo = lerTempo(a.tempo);
  if ("erro" in tempo && (gatilho === "permaneceu" || gatilho === "abandonou")) return { erro: tempo.erro };
  const params = paresDeObjeto(a.params);
  if (!params) return { erro: "params precisa ser um objeto {chave: valor}." };
  const corpo = typeof a.corpo === "string" && a.corpo.trim() ? a.corpo : null;
  return {
    candidata: {
      gatilho,
      valorSeg: "erro" in tempo ? null : tempo.valorSeg,
      url: typeof a.url === "string" ? a.url : "",
      metodo: typeof a.metodo === "string" ? a.metodo.toUpperCase() : "",
      headers: a.headers,
      params,
      corpo,
    },
  };
}

function linhaParaGravar(d: Extract<ReturnType<typeof validarRegra>, { dados: unknown }>["dados"]) {
  return {
    gatilho: d.gatilho,
    valor_seg: d.valorSeg,
    url: d.url,
    metodo: d.metodo,
    headers_enc: d.headers.length ? cifrar(JSON.stringify(d.headers)) : null,
    params: Object.fromEntries(d.params),
    corpo: d.corpo,
  };
}

// --- Ferramentas ------------------------------------------------------------------------------------------------

const listarRegras: Ferramenta = {
  name: "listar_regras",
  title: "Listar regras de webhook",
  description:
    "Lista as regras de webhook (Configurações → Integrações do webinar) de um webinar: gatilho, tempo, URL, método, params, corpo, se está ativa e os NOMES dos headers (o valor dos headers nunca aparece).",
  inputSchema: { type: "object", properties: { webinar_id: WEBINAR }, required: ["webinar_id"], additionalProperties: false },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const db = dbAdmin();
    if (!(await nomeDoWebinar(db, args.webinar_id))) return erro(WEBINAR_NAO_ENCONTRADO);
    const webinarId = args.webinar_id as string;
    const { data, error } = await db.from("regras").select(SELECT_REGRA).eq("webinar_id", webinarId).order("created_at");
    if (error) return erro("Não deu para ler as regras.");
    return texto({ regras: ((data ?? []) as RegraBanco[]).map(regraParaSaida), painel: linkIntegracoes(webinarId) });
  },
};

const criarRegra: Ferramenta = {
  name: "criar_regra",
  title: "Criar regra de webhook",
  description:
    "Adiciona uma regra de webhook ao webinar (mesma validação do painel: https público, gatilho, método, até 20 headers/params). Headers são cifrados antes de gravar. A regra nasce ativa.",
  inputSchema: {
    type: "object",
    properties: { webinar_id: WEBINAR, ...CAMPOS_REGRA },
    required: ["webinar_id", "gatilho", "url"],
    additionalProperties: false,
  },
  annotations: CRIA,
  escrita: true,
  async executar(chave, args) {
    const db = dbAdmin();
    if (!(await nomeDoWebinar(db, args.webinar_id))) return erro(WEBINAR_NAO_ENCONTRADO);
    const webinarId = args.webinar_id as string;

    const headers = paresDeObjeto(args.headers);
    if (!headers) return erro("headers precisa ser um objeto {nome: valor}.");
    const m = montarCandidata({ gatilho: args.gatilho, tempo: args.tempo, url: args.url, metodo: args.metodo ?? "POST", headers, params: args.params, corpo: args.corpo });
    if ("erro" in m) return erro(m.erro);
    const r = validarRegra(m.candidata);
    if ("erro" in r) return erro(r.erro);

    const { data, error } = await db
      .from("regras")
      .insert({ webinar_id: webinarId, ...linhaParaGravar(r.dados) })
      .select("id")
      .single();
    if (error || !data) return erro("Não deu para adicionar a regra.");

    await auditar(chave, { webinarId, acao: "criou", descricao: `Adicionou a regra de webhook "${r.dados.gatilho}"` });
    return texto({ ok: true, id: (data as { id: string }).id, gatilho: r.dados.gatilho, painel: linkIntegracoes(webinarId) });
  },
};

const editarRegra: Ferramenta = {
  name: "editar_regra",
  title: "Editar regra de webhook",
  description:
    "Edita uma regra de webhook. Só os campos enviados mudam; o resto (inclusive os headers salvos) fica como está. Mandar `headers` troca TODOS os headers pela lista nova ({} remove todos).",
  inputSchema: {
    type: "object",
    properties: { webinar_id: WEBINAR, regra_id: { ...UUID, description: "Id da regra (veja listar_regras)." }, ...CAMPOS_REGRA },
    required: ["webinar_id", "regra_id"],
    additionalProperties: false,
  },
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const db = dbAdmin();
    if (!(await nomeDoWebinar(db, args.webinar_id))) return erro(WEBINAR_NAO_ENCONTRADO);
    const webinarId = args.webinar_id as string;
    const atual = await lerRegra(db, webinarId, args.regra_id);
    if (!atual) return erro(NAO_ENCONTRADA);

    let headers: [string, string][];
    if (args.headers === undefined) headers = headersSalvos(atual.headers_enc);
    else {
      const novos = paresDeObjeto(args.headers);
      if (!novos) return erro("headers precisa ser um objeto {nome: valor}.");
      headers = novos;
    }
    const tem = (k: string) => Object.prototype.hasOwnProperty.call(args, k);
    const m = montarCandidata({
      gatilho: tem("gatilho") ? args.gatilho : atual.gatilho,
      tempo: tem("tempo") ? args.tempo : atual.valor_seg,
      url: tem("url") ? args.url : atual.url,
      metodo: tem("metodo") ? args.metodo : atual.metodo,
      headers,
      params: tem("params") ? args.params : (atual.params ?? {}),
      corpo: tem("corpo") ? args.corpo : atual.corpo,
    });
    if ("erro" in m) return erro(m.erro);
    const r = validarRegra(m.candidata);
    if ("erro" in r) return erro(r.erro);

    const depois = linhaParaGravar(r.dados);
    const { error } = await db.from("regras").update(depois).eq("id", atual.id).eq("webinar_id", webinarId);
    if (error) return erro("Não deu para salvar a regra.");

    const { id: _id, ativa: _ativa, ...antes } = atual;
    await auditar(chave, { webinarId, acao: "editou", descricao: `Editou a regra de webhook "${r.dados.gatilho}"`, antes, depois });
    return texto({ ok: true, regra: regraParaSaida({ ...atual, ...depois }) });
  },
};

const ligarDesligarRegra: Ferramenta = {
  name: "ligar_desligar_regra",
  title: "Ligar ou desligar regra de webhook",
  description: "Ativa (ativa=true) ou desativa (ativa=false) uma regra de webhook do webinar. Regra desativada não enfileira disparos novos.",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      regra_id: { ...UUID, description: "Id da regra (veja listar_regras)." },
      ativa: { type: "boolean", description: "true liga, false desliga." },
    },
    required: ["webinar_id", "regra_id", "ativa"],
    additionalProperties: false,
  },
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    if (typeof args.ativa !== "boolean") return erro("Informe ativa (true ou false).");
    const db = dbAdmin();
    if (!(await nomeDoWebinar(db, args.webinar_id))) return erro(WEBINAR_NAO_ENCONTRADO);
    const webinarId = args.webinar_id as string;
    const atual = await lerRegra(db, webinarId, args.regra_id);
    if (!atual) return erro(NAO_ENCONTRADA);
    if (atual.ativa === args.ativa) return texto({ ok: true, ativa: atual.ativa, mensagem: `A regra já estava ${atual.ativa ? "ativa" : "desativada"}.` });

    const { error } = await db.from("regras").update({ ativa: args.ativa }).eq("id", atual.id).eq("webinar_id", webinarId);
    if (error) return erro("Não deu para salvar a regra.");
    await auditar(chave, {
      webinarId,
      acao: "editou",
      descricao: `${args.ativa ? "Ativou" : "Desativou"} a regra de webhook "${atual.gatilho}"`,
      antes: { ativa: atual.ativa },
      depois: { ativa: args.ativa },
    });
    return texto({ ok: true, ativa: args.ativa });
  },
};

const excluirRegra: Ferramenta = {
  name: "excluir_regra",
  title: "Excluir regra de webhook",
  description: "Exclui de vez uma regra de webhook do webinar (o log de disparos dela some junto). Pra só pausar, use ligar_desligar_regra.",
  inputSchema: {
    type: "object",
    properties: { webinar_id: WEBINAR, regra_id: { ...UUID, description: "Id da regra (veja listar_regras)." } },
    required: ["webinar_id", "regra_id"],
    additionalProperties: false,
  },
  annotations: APAGA,
  escrita: true,
  async executar(chave, args) {
    const db = dbAdmin();
    if (!(await nomeDoWebinar(db, args.webinar_id))) return erro(WEBINAR_NAO_ENCONTRADO);
    const webinarId = args.webinar_id as string;
    const atual = await lerRegra(db, webinarId, args.regra_id);
    if (!atual) return erro(NAO_ENCONTRADA);

    const { error } = await db.from("regras").delete().eq("id", atual.id).eq("webinar_id", webinarId);
    if (error) return erro("Não deu para excluir a regra.");
    await auditar(chave, { webinarId, acao: "excluiu", descricao: "Excluiu uma regra de webhook" });
    return texto({ ok: true });
  },
};

const testarRegra: Ferramenta = {
  name: "testar_regra",
  title: "Enviar teste da regra",
  description:
    'Idêntico ao botão "Enviar teste" do painel: dispara a regra agora com dados fictícios (participante "Teste Vórtex Webinar") e devolve o status e o corpo da resposta. Não grava nada no log de disparos.',
  inputSchema: {
    type: "object",
    properties: { webinar_id: WEBINAR, regra_id: { ...UUID, description: "Id da regra (veja listar_regras)." } },
    required: ["webinar_id", "regra_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  escrita: true,
  async executar(_chave, args) {
    const db = dbAdmin();
    if (!(await nomeDoWebinar(db, args.webinar_id))) return erro(WEBINAR_NAO_ENCONTRADO);
    const atual = await lerRegra(db, args.webinar_id as string, args.regra_id);
    if (!atual) return erro(NAO_ENCONTRADA);
    const r = await enviarTeste(atual.id);
    if ("erro" in r) return erro(r.erro);
    return texto({ status: r.status, corpo: r.corpo.slice(0, 2000) });
  },
};

type LinhaDisparo = {
  id: string;
  status: "fila" | "ok" | "erro";
  tentativas: number;
  resposta: { status?: number; corpo?: string | null } | null;
  erro: string | null;
  enviar_apos: string;
  created_at: string;
  regra_id: string;
  regras: { gatilho: Gatilho } | null;
  sessoes: { participantes: { nome: string } | null } | null;
};

const verDisparos: Ferramenta = {
  name: "ver_disparos",
  title: "Ver disparos das regras",
  description:
    "Log dos disparos de webhook do webinar (o mesmo de Integrações → Log), mais recente primeiro: data, gatilho, participante, status (fila/ok/erro), tentativas, resposta e erro. Filtra por regra e status; paginado (20 por página).",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      regra_id: { ...UUID, description: "Só os disparos desta regra (opcional)." },
      status: { type: "string", enum: ["todos", "ok", "erro", "fila"], description: "Filtro de status (padrão todos)." },
      pagina: { type: "integer", minimum: 1, description: "Página (padrão 1)." },
    },
    required: ["webinar_id"],
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const db = dbAdmin();
    if (!(await nomeDoWebinar(db, args.webinar_id))) return erro(WEBINAR_NAO_ENCONTRADO);
    const webinarId = args.webinar_id as string;
    if (args.regra_id !== undefined && !ehUuid(args.regra_id)) return erro(NAO_ENCONTRADA);
    const porPagina = 20;
    const pagina = inteiro(args.pagina, 1, 1, 100000);
    const inicio = (pagina - 1) * porPagina;

    let consulta = db
      .from("disparos")
      .select("id, status, tentativas, resposta, erro, enviar_apos, created_at, regra_id, regras!inner(gatilho, webinar_id), sessoes(participantes(nome))", { count: "exact" })
      .eq("regras.webinar_id", webinarId)
      .order("created_at", { ascending: false })
      .range(inicio, inicio + porPagina - 1);
    if (args.regra_id) consulta = consulta.eq("regra_id", args.regra_id as string);
    if (args.status === "ok" || args.status === "erro" || args.status === "fila") consulta = consulta.eq("status", args.status);

    const { data, count, error } = await consulta;
    if (error) return erro("Não deu para ler os disparos.");
    const itens = ((data ?? []) as unknown as LinhaDisparo[]).map((d) => ({
      id: d.id,
      data: d.created_at,
      regra_id: d.regra_id,
      gatilho: d.regras ? rotuloGatilho(d.regras.gatilho) : null,
      participante: d.sessoes?.participantes?.nome ?? null,
      status: d.status,
      tentativas: d.tentativas,
      ...(d.status === "fila" ? { proxima_tentativa: d.enviar_apos } : {}),
      resposta: d.resposta ? { status: d.resposta.status ?? null, corpo: (d.resposta.corpo ?? "").slice(0, 500) } : null,
      erro: d.erro,
    }));
    return texto({ total: count ?? 0, pagina, por_pagina: porPagina, disparos: itens, painel: linkPainel(`/configuracoes/integracoes/${webinarId}/log`) });
  },
};

export const FERRAMENTAS_REGRAS: Ferramenta[] = [listarRegras, criarRegra, editarRegra, ligarDesligarRegra, excluirRegra, testarRegra, verDisparos];
