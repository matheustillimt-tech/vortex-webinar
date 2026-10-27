import "server-only";
import { testarAgente as testarAgenteLib } from "../../agente";
import { iaConfig } from "../../env";
import { iniciarGeracao } from "../../geracao";
import {
  validarAgente,
  validarMensagemSimulada,
  validarOpcoesGeracao,
  validarTituloNotificacaoCompra,
  validarVendaSimulada,
} from "../../regras/passos";
import { formatarDuracao } from "../../regras/video";
import { dbAdmin } from "../../supabase/admin";
import {
  ALTERA,
  APAGA,
  auditar,
  camposDeArgs,
  CRIA,
  ehUuid,
  erro,
  inteiro,
  linkPainel,
  SO_LEITURA,
  texto,
  UUID,
  WEBINAR,
  type Ferramenta,
} from "../comum";
import {
  checkboxOuAtual,
  descreverIntervalo,
  excluirDaLinhaDoTempo,
  inserirTudoOuNada,
  INTERVALO,
  intervaloDeArgs,
  MAX_ERROS_EXIBIDOS,
  MAX_LOTE,
  MOMENTO,
  momentoDeArgs,
  segundoDoFiltro,
  textoOuAtual,
  webinarExiste,
} from "./conteudo-comum";

/** Ferramentas dos passos Agente de IA, Chat (simulado e gerado por IA) e Vendas do webinar. Cada uma faz
 *  o mesmo que a server action do passo (`app/(painel)/webinars/[id]/{agente,chat,vendas}/actions.ts`):
 *  mesmos validadores, mesmas colunas e a mesma descrição no Histórico de ações. A sala lê estas tabelas por um
 *  cache curto em memória (10–15 s, `cacheCurto`), sem invalidação: como no painel, a mudança chega na sala em
 *  alguns segundos. */

const NAO_ENCONTRADO = "Webinar não encontrado.";

type LinhaAgente = { ligado: boolean; nome: string | null; instrucoes: string | null; contexto: string | null; faq: string | null };
type LinhaMensagem = { id: string; segundo: number; nome: string; texto: string; suporte: boolean };
type LinhaVenda = { id: string; segundo: number; texto: string };

/** Webinar válido e existente; senão devolve o erro pronto. */
async function conferirWebinar(args: Record<string, unknown>): Promise<{ db: ReturnType<typeof dbAdmin>; id: string } | { falha: ReturnType<typeof erro> }> {
  if (!ehUuid(args.webinar_id)) return { falha: erro(NAO_ENCONTRADO) };
  const db = dbAdmin();
  if (!(await webinarExiste(db, args.webinar_id))) return { falha: erro(NAO_ENCONTRADO) };
  return { db, id: args.webinar_id };
}

// ---------------------------------------------------------------------------------------------------------------
// Agente de IA
// ---------------------------------------------------------------------------------------------------------------

const CONDICOES_AGENTE =
  "O agente responde no próprio chat da sala, marcando a pessoa com @Nome (só ela vê a pergunta e a resposta), as mensagens dos participantes na sala, só quando: o agente está ligado, a IA está " +
  "configurada no servidor (OPENROUTER_API_KEY + OPENROUTER_TEXT_MODEL), a sessão é ao vivo (nunca em teste, replay ou depois do " +
  "fim da transmissão) e não é de participante provisório, nenhum atendente humano está atendendo essa pessoa agora, a mensagem parece pergunta (texto com menos de 8 caracteres sem \"?\" é " +
  "ignorado) e dentro dos tetos de custo: até 20 respostas da IA e 30 mensagens processadas por sessão/hora, e 120 por " +
  "webinar/minuto. O próprio modelo também pode decidir não responder. Links na resposta só saem se estiverem nas instruções, " +
  "contexto ou FAQ.";

function avisoIa(): string | undefined {
  return iaConfig() ? undefined : "A IA não está configurada no servidor (OPENROUTER_API_KEY / OPENROUTER_TEXT_MODEL): o agente não responde ninguém, mesmo ligado.";
}

const verAgente: Ferramenta = {
  name: "ver_agente",
  title: "Ver agente de IA",
  description:
    "Mostra a configuração do agente de IA do webinar (ligado, nome, instruções, contexto do produto e FAQ) e se a IA está " +
    `configurada no servidor (ia_configurada). ${CONDICOES_AGENTE}`,
  inputSchema: { type: "object", properties: { webinar_id: WEBINAR }, required: ["webinar_id"], additionalProperties: false },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    const { data } = await w.db.from("agentes_ia").select("ligado, nome, instrucoes, contexto, faq").eq("webinar_id", w.id).maybeSingle();
    const a = data as LinhaAgente | null;
    return texto({
      ligado: a?.ligado ?? false,
      nome: a?.nome ?? null,
      instrucoes: a?.instrucoes ?? null,
      contexto: a?.contexto ?? null,
      faq: a?.faq ?? null,
      configurado: !!a,
      ia_configurada: !!iaConfig(),
      aviso: avisoIa(),
      painel: linkPainel(`/webinars/${w.id}/agente`),
    });
  },
};

const salvarAgente: Ferramenta = {
  name: "salvar_agente",
  title: "Salvar agente de IA",
  description:
    "Liga/desliga e edita o agente de IA do webinar. Mescla com o que já está salvo: só os campos enviados mudam (mande null ou \"\" " +
    `pra limpar um texto). Limites: nome até 60 caracteres; instruções, contexto e FAQ até 4000 cada. ${CONDICOES_AGENTE}`,
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      ligado: { type: "boolean", description: "Liga (true) ou desliga (false) o agente." },
      nome: { type: ["string", "null"], description: "Nome que aparece nas respostas (até 60). Vazio = padrão da sala." },
      instrucoes: { type: ["string", "null"], description: "Como o agente deve se comportar: tom, o que pode e não pode dizer (até 4000)." },
      contexto: { type: ["string", "null"], description: "Contexto do produto/oferta: o que é, preço, bônus, links permitidos (até 4000)." },
      faq: { type: ["string", "null"], description: "Perguntas frequentes e respostas (até 4000)." },
    },
    required: ["webinar_id"],
    additionalProperties: false,
  },
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    const { data } = await w.db.from("agentes_ia").select("ligado, nome, instrucoes, contexto, faq").eq("webinar_id", w.id).maybeSingle();
    const atual = data as LinhaAgente | null;

    const campos: Record<string, string> = {
      nome: textoOuAtual(args, "nome", atual?.nome),
      instrucoes: textoOuAtual(args, "instrucoes", atual?.instrucoes),
      contexto: textoOuAtual(args, "contexto", atual?.contexto),
      faq: textoOuAtual(args, "faq", atual?.faq),
    };
    if (checkboxOuAtual(args, "ligado", atual?.ligado)) campos.ligado = "on";

    const r = validarAgente(campos);
    if ("erro" in r) return erro(r.erro);
    const d = r.dados;

    const depois = { webinar_id: w.id, ligado: d.ligado, nome: d.nome, instrucoes: d.instrucoes, contexto: d.contexto, faq: d.faq };
    const { error } = await w.db.from("agentes_ia").upsert(depois, { onConflict: "webinar_id" });
    if (error) return erro("Não deu para salvar o agente.");

    await auditar(chave, { webinarId: w.id, acao: "editou", descricao: "Editou o agente de IA", antes: atual, depois });
    return texto({ ok: true, ligado: d.ligado, nome: d.nome, instrucoes: d.instrucoes, contexto: d.contexto, faq: d.faq, ia_configurada: !!iaConfig(), aviso: avisoIa() });
  },
};

const testarAgente: Ferramenta = {
  name: "testar_agente",
  title: "Testar agente de IA",
  description:
    "Faz uma pergunta ao agente de IA e devolve a resposta, sem gravar nada (idêntico ao playground do passo Agente). Usa a " +
    "configuração salva; nome/instruções/contexto/faq enviados aqui substituem os salvos só neste teste, pra testar antes de " +
    "salvar. Funciona mesmo com o agente desligado. resposta null = o modelo decidiu não responder (ex.: não parece pergunta).",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      pergunta: { type: "string", description: "Mensagem de um participante, como chegaria na sala." },
      nome: { type: "string", description: "Nome a testar (não salva)." },
      instrucoes: { type: "string", description: "Instruções a testar (não salva)." },
      contexto: { type: "string", description: "Contexto a testar (não salva)." },
      faq: { type: "string", description: "FAQ a testar (não salva)." },
      momento: {
        type: ["string", "integer"],
        description: 'Em que ponto da aula a pessoa estaria ("h:mm:ss" ou segundos), como a sala manda pro agente. Ex.: "0:20:00" antes da oferta, "1:20:00" depois.',
      },
    },
    required: ["webinar_id", "pergunta"],
    additionalProperties: false,
  },
  annotations: { ...SO_LEITURA, openWorldHint: true },
  escrita: false,
  async executar(_chave, args) {
    const pergunta = typeof args.pergunta === "string" ? args.pergunta.trim() : "";
    if (!pergunta) return erro("Escreva uma pergunta para testar.");
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    const { data } = await w.db.from("agentes_ia").select("ligado, nome, instrucoes, contexto, faq").eq("webinar_id", w.id).maybeSingle();
    const atual = data as LinhaAgente | null;

    const cfg = {
      nome: textoOuAtual(args, "nome", atual?.nome) || null,
      instrucoes: textoOuAtual(args, "instrucoes", atual?.instrucoes) || null,
      contexto: textoOuAtual(args, "contexto", atual?.contexto) || null,
      faq: textoOuAtual(args, "faq", atual?.faq) || null,
    };
    const momentoSeg = segundoDoFiltro(args.momento) ?? null;
    if (momentoSeg === null && args.momento !== undefined && args.momento !== "") return erro('Momento inválido: use "h:mm:ss" ou segundos.');
    const r = await testarAgenteLib(cfg, pergunta, { momentoSeg });
    if (r.erro) return erro(r.erro);
    return texto({
      pergunta,
      resposta: r.resposta,
      respondeu: r.resposta !== null,
      observacao: r.resposta === null ? "O agente decidiu não responder a essa mensagem." : undefined,
      agente_ligado: atual?.ligado ?? false,
    });
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Chat simulado
// ---------------------------------------------------------------------------------------------------------------

const VARIAVEIS_CHAT = "No texto, #nome, #sobrenome e #nomecompleto viram o nome de quem está assistindo.";

const listarChatSimulado: Ferramenta = {
  name: "listar_chat_simulado",
  title: "Listar chat simulado",
  description:
    "Lista as mensagens do chat simulado (as que aparecem na aba Chat da sala no momento do vídeo), em ordem de segundo, " +
    "paginadas (`limite` até 1000, `offset`), com filtro opcional de intervalo de segundos. Devolve `total` (com o filtro).",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      ...INTERVALO,
      limite: { type: "integer", minimum: 1, maximum: 1000, description: "Quantas por página (padrão 200, máx. 1000)." },
      offset: { type: "integer", minimum: 0, description: "Quantas pular (padrão 0). Próxima página: offset + limite." },
    },
    required: ["webinar_id"],
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    const intervalo = intervaloDeArgs(args);
    if ("erro" in intervalo) return erro(intervalo.erro);
    const limite = inteiro(args.limite, 200, 1, 1000);
    const offset = inteiro(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    let q = w.db.from("mensagens_simuladas").select("id, segundo, nome, texto, suporte", { count: "exact" }).eq("webinar_id", w.id);
    if (intervalo.de !== undefined) q = q.gte("segundo", intervalo.de);
    if (intervalo.ate !== undefined) q = q.lte("segundo", intervalo.ate);
    const { data, count, error } = await q.order("segundo", { ascending: true }).order("id", { ascending: true }).range(offset, offset + limite - 1);
    if (error) return erro("Não deu para ler o chat simulado.");

    const linhas = (data ?? []) as LinhaMensagem[];
    const total = count ?? linhas.length;
    return texto({
      total,
      offset,
      mostrando: linhas.length,
      proximo_offset: offset + linhas.length < total ? offset + linhas.length : null,
      mensagens: linhas.map((l) => ({ id: l.id, momento: formatarDuracao(l.segundo), segundo: l.segundo, nome: l.nome, texto: l.texto, suporte: l.suporte })),
    });
  },
};

const adicionarMensagensChat: Ferramenta = {
  name: "adicionar_mensagens_chat",
  title: "Adicionar mensagens ao chat simulado",
  description:
    `Acrescenta uma ou muitas mensagens ao chat simulado (até ${MAX_LOTE} por chamada; não apaga as existentes). Cada uma: ` +
    '`momento` ("h:mm:ss" ou "m:ss", ex.: "0:05:30") OU `segundo` (inteiro, ex.: 330), `nome` (até 60), `texto` (até 400) e ' +
    "`suporte` (true = aparece destacada como mensagem do suporte). Tudo ou nada: se uma for inválida, nenhuma é gravada e " +
    `volta a lista de erros por posição. ${VARIAVEIS_CHAT}`,
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      mensagens: {
        type: "array",
        minItems: 1,
        maxItems: MAX_LOTE,
        description: "Mensagens a acrescentar.",
        items: {
          type: "object",
          properties: {
            ...MOMENTO,
            nome: { type: "string", description: "Nome de quem \"escreveu\" (até 60)." },
            texto: { type: "string", description: "Texto da mensagem (até 400)." },
            suporte: { type: "boolean", description: "Mensagem do suporte (destacada). Padrão false." },
          },
          required: ["nome", "texto"],
          additionalProperties: false,
        },
      },
    },
    required: ["webinar_id", "mensagens"],
    additionalProperties: false,
  },
  annotations: CRIA,
  escrita: true,
  async executar(chave, args) {
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    const lista = Array.isArray(args.mensagens) ? args.mensagens : [];
    if (lista.length === 0) return erro("Mande pelo menos uma mensagem.");
    if (lista.length > MAX_LOTE) return erro(`No máximo ${MAX_LOTE} mensagens por chamada.`);

    const linhas: Record<string, unknown>[] = [];
    const erros: string[] = [];
    lista.forEach((item, i) => {
      const m = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const r = validarMensagemSimulada({ ...camposDeArgs(m, ["momento", "segundo"]), momento: momentoDeArgs(m) });
      if ("erro" in r) erros.push(`Mensagem ${i + 1}: ${r.erro}`);
      else linhas.push({ webinar_id: w.id, segundo: r.dados.segundo, nome: r.dados.nome, texto: r.dados.texto, suporte: r.dados.suporte });
    });
    if (erros.length > 0) {
      return erro(`Nada foi gravado: ${erros.length} mensagem(ns) com erro.\n${erros.slice(0, MAX_ERROS_EXIBIDOS).join("\n")}${erros.length > MAX_ERROS_EXIBIDOS ? "\n…" : ""}`);
    }

    const g = await inserirTudoOuNada(w.db, "mensagens_simuladas", linhas, "mensagens");
    if ("erro" in g) return erro(g.erro);

    await auditar(chave, {
      webinarId: w.id,
      acao: "criou",
      descricao: linhas.length === 1 ? "Adicionou uma mensagem no chat simulado" : `Adicionou ${linhas.length} mensagens no chat simulado`,
    });
    return texto({ ok: true, adicionadas: linhas.length, painel: linkPainel(`/webinars/${w.id}/chat`) });
  },
};

const editarMensagemChat: Ferramenta = {
  name: "editar_mensagem_chat",
  title: "Editar mensagem do chat simulado",
  description: `Edita uma mensagem do chat simulado (veja listar_chat_simulado). Só os campos enviados mudam. ${VARIAVEIS_CHAT}`,
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      id: { ...UUID, description: "Id da mensagem (listar_chat_simulado)." },
      ...MOMENTO,
      nome: { type: "string", description: "Nome (até 60)." },
      texto: { type: "string", description: "Texto (até 400)." },
      suporte: { type: "boolean", description: "Mensagem do suporte (destacada)." },
    },
    required: ["webinar_id", "id"],
    additionalProperties: false,
  },
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    if (!ehUuid(args.id)) return erro("Mensagem não encontrada.");
    const { data } = await w.db.from("mensagens_simuladas").select("id, segundo, nome, texto, suporte").eq("id", args.id).eq("webinar_id", w.id).maybeSingle();
    const atual = data as LinhaMensagem | null;
    if (!atual) return erro("Mensagem não encontrada.");

    const r = validarMensagemSimulada({
      momento: momentoDeArgs(args, formatarDuracao(atual.segundo)),
      nome: textoOuAtual(args, "nome", atual.nome),
      texto: textoOuAtual(args, "texto", atual.texto),
      suporte: checkboxOuAtual(args, "suporte", atual.suporte),
    });
    if ("erro" in r) return erro(r.erro);
    const d = r.dados;

    const depois = { segundo: d.segundo, nome: d.nome, texto: d.texto, suporte: d.suporte };
    const { error } = await w.db.from("mensagens_simuladas").update(depois).eq("id", atual.id).eq("webinar_id", w.id);
    if (error) return erro("Não deu para salvar a mensagem.");

    const { id: _id, ...antes } = atual;
    await auditar(chave, { webinarId: w.id, acao: "editou", descricao: "Editou uma mensagem do chat simulado", antes, depois });
    return texto({ ok: true, mensagem: { id: atual.id, momento: formatarDuracao(d.segundo), ...depois } });
  },
};

const EXCLUIR_PROPS = {
  ids: { type: "array", items: UUID, maxItems: MAX_LOTE, description: "Ids a excluir." },
  ...INTERVALO,
  tudo: { type: "boolean", description: "true = apaga tudo deste webinar (exige confirmar: true)." },
  confirmar: { type: "boolean", description: "Confirmação obrigatória para `tudo: true`." },
} as const;

const excluirMensagensChat: Ferramenta = {
  name: "excluir_mensagens_chat",
  title: "Excluir mensagens do chat simulado",
  description:
    "Exclui mensagens do chat simulado por UM critério: `ids` (lista), intervalo de segundos (`de_segundo`/`ate_segundo`, " +
    "inclusive; dá pra mandar só um dos dois) ou `tudo: true` + `confirmar: true` (apaga o chat inteiro). Não tem volta.",
  inputSchema: { type: "object", properties: { webinar_id: WEBINAR, ...EXCLUIR_PROPS }, required: ["webinar_id"], additionalProperties: false },
  annotations: APAGA,
  escrita: true,
  async executar(chave, args) {
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    const r = await excluirDaLinhaDoTempo(w.db, "mensagens_simuladas", w.id, args);
    if ("erro" in r) return erro(r.erro);

    const descricao =
      r.criterio === "tudo"
        ? `Apagou ${r.excluidas} mensagens do chat simulado`
        : r.criterio === "intervalo"
          ? `Excluiu ${r.excluidas} mensagens do chat simulado (${descreverIntervalo(r.de, r.ate)})`
          : r.excluidas === 1
            ? "Excluiu uma mensagem do chat simulado"
            : `Excluiu ${r.excluidas} mensagens do chat simulado`;
    if (r.excluidas > 0) await auditar(chave, { webinarId: w.id, acao: "excluiu", descricao });
    return texto({ ok: true, excluidas: r.excluidas });
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Chat gerado por IA
// ---------------------------------------------------------------------------------------------------------------

const gerarChatIa: Ferramenta = {
  name: "gerar_chat_ia",
  title: "Gerar chat com IA",
  description:
    "Pede uma geração de chat simulado por IA a partir do vídeo do webinar: transcreve o áudio e cria mensagens de espectadores " +
    "reagindo à aula, bloco a bloco (5 min). As mensagens geradas são ACRESCENTADAS ao chat atual (não apaga nada). Roda em " +
    "segundo plano pelo cron (pode levar vários minutos): acompanhe com ver_geracao_chat. Precisa da IA configurada no servidor " +
    "(OpenRouter + ElevenLabs), de um vídeo escolhido no passo Vídeo (Bunny com MP4 Fallback, ou link .mp4) e de não ter outra " +
    "geração em andamento.",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      idioma: { type: "string", enum: ["pt", "es", "en"], description: "Idioma das mensagens. Padrão pt." },
      tom: { type: "string", enum: ["formal", "natural"], description: "formal ou natural (informal, como gente digitando rápido). Padrão natural." },
      intensidade: { type: "string", enum: ["baixa", "media", "alta"], description: "Mensagens por minuto: baixa 1, media 3, alta 6. Padrão media." },
      instrucoes: { type: "string", description: "Instruções sobre o público (até 400). Ex.: \"donos de clínica, 30 a 50 anos\"." },
    },
    required: ["webinar_id"],
    additionalProperties: false,
  },
  annotations: CRIA,
  escrita: true,
  async executar(chave, args) {
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    const r = validarOpcoesGeracao({
      idioma: typeof args.idioma === "string" ? args.idioma : "pt",
      tom: typeof args.tom === "string" ? args.tom : "natural",
      intensidade: typeof args.intensidade === "string" ? args.intensidade : "media",
      instrucoes: typeof args.instrucoes === "string" ? args.instrucoes : "",
    });
    if ("erro" in r) return erro(r.erro);

    const resultado = await iniciarGeracao(w.id, r.dados);
    if ("erro" in resultado) return erro(resultado.erro);

    await auditar(chave, { webinarId: w.id, acao: "criou", descricao: "Iniciou uma geração de chat por IA" });
    return texto({ ok: true, status: "fila", opcoes: r.dados, proximo_passo: "Acompanhe com ver_geracao_chat (o cron processa em segundo plano)." });
  },
};

const ROTULO_STATUS: Record<string, string> = {
  fila: "Na fila",
  transcrevendo: "Transcrevendo o vídeo",
  gerando: "Gerando mensagens",
  pronto: "Pronto",
  erro: "Erro",
};

const verGeracaoChat: Ferramenta = {
  name: "ver_geracao_chat",
  title: "Ver geração de chat com IA",
  description:
    "Mostra a última geração de chat por IA do webinar: status (fila, transcrevendo, gerando, pronto, erro), bloco atual / total " +
    "de blocos, quantas mensagens já foram geradas e o erro, se houver. Sem nenhuma geração: geracao null.",
  inputSchema: { type: "object", properties: { webinar_id: WEBINAR }, required: ["webinar_id"], additionalProperties: false },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    const { data } = await w.db
      .from("geracoes_chat")
      .select("status, idioma, tom, intensidade, instrucoes, bloco_atual, total_blocos, mensagens_geradas, erro, created_at")
      .eq("webinar_id", w.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const cfg = iaConfig();
    const ia_configurada = !!cfg && !!cfg.elevenlabsKey;
    if (!data) return texto({ geracao: null, ia_configurada });
    const l = data as {
      status: string;
      idioma: string;
      tom: string;
      intensidade: string;
      instrucoes: string | null;
      bloco_atual: number;
      total_blocos: number | null;
      mensagens_geradas: number;
      erro: string | null;
      created_at: string;
    };
    return texto({
      geracao: {
        status: l.status,
        rotulo: ROTULO_STATUS[l.status] ?? l.status,
        em_andamento: ["fila", "transcrevendo", "gerando"].includes(l.status),
        bloco_atual: l.total_blocos !== null ? Math.min(l.bloco_atual, l.total_blocos) : l.bloco_atual,
        total_blocos: l.total_blocos,
        mensagens_geradas: l.mensagens_geradas,
        erro: l.erro,
        opcoes: { idioma: l.idioma, tom: l.tom, intensidade: l.intensidade, instrucoes: l.instrucoes },
        pedida_em: l.created_at,
      },
      ia_configurada,
    });
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Vendas simuladas e notificação de compra
// ---------------------------------------------------------------------------------------------------------------

const DESCRICAO_VENDAS =
  "Vendas simuladas são as notificações de compra (\"Fulano acabou de comprar\") que aparecem na sala no momento do vídeo; o " +
  "título da notificação é o mesmo pra todas (salvar_titulo_notificacao_compra).";

const listarVendasSimuladas: Ferramenta = {
  name: "listar_vendas_simuladas",
  title: "Listar vendas simuladas",
  description: `Lista as vendas simuladas em ordem de segundo, paginadas, com filtro opcional de intervalo, e o título da notificação de compra. ${DESCRICAO_VENDAS}`,
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      ...INTERVALO,
      limite: { type: "integer", minimum: 1, maximum: 1000, description: "Quantas por página (padrão 200, máx. 1000)." },
      offset: { type: "integer", minimum: 0, description: "Quantas pular (padrão 0)." },
    },
    required: ["webinar_id"],
    additionalProperties: false,
  },
  annotations: SO_LEITURA,
  escrita: false,
  async executar(_chave, args) {
    if (!ehUuid(args.webinar_id)) return erro(NAO_ENCONTRADO);
    const db = dbAdmin();
    const { data: webinar } = await db.from("webinars").select("id, titulo_notificacao_compra").eq("id", args.webinar_id).maybeSingle();
    if (!webinar) return erro(NAO_ENCONTRADO);
    const intervalo = intervaloDeArgs(args);
    if ("erro" in intervalo) return erro(intervalo.erro);
    const limite = inteiro(args.limite, 200, 1, 1000);
    const offset = inteiro(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    let q = db.from("vendas_simuladas").select("id, segundo, texto", { count: "exact" }).eq("webinar_id", args.webinar_id);
    if (intervalo.de !== undefined) q = q.gte("segundo", intervalo.de);
    if (intervalo.ate !== undefined) q = q.lte("segundo", intervalo.ate);
    const { data, count, error } = await q.order("segundo", { ascending: true }).order("id", { ascending: true }).range(offset, offset + limite - 1);
    if (error) return erro("Não deu para ler as vendas simuladas.");

    const linhas = (data ?? []) as LinhaVenda[];
    const total = count ?? linhas.length;
    return texto({
      titulo_notificacao_compra: (webinar as { titulo_notificacao_compra: string | null }).titulo_notificacao_compra ?? "Venda confirmada!",
      total,
      offset,
      mostrando: linhas.length,
      proximo_offset: offset + linhas.length < total ? offset + linhas.length : null,
      vendas: linhas.map((l) => ({ id: l.id, momento: formatarDuracao(l.segundo), segundo: l.segundo, texto: l.texto })),
    });
  },
};

const adicionarVendasSimuladas: Ferramenta = {
  name: "adicionar_vendas_simuladas",
  title: "Adicionar vendas simuladas",
  description:
    `Acrescenta uma ou muitas vendas simuladas (até ${MAX_LOTE} por chamada; não apaga as existentes). Cada uma: \`momento\` ` +
    '("h:mm:ss" ou "m:ss") OU `segundo` (inteiro) e `texto` (até 200, ex.: "Ana de Curitiba acabou de comprar"). Tudo ou nada: ' +
    `se uma for inválida, nenhuma é gravada. ${DESCRICAO_VENDAS}`,
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      vendas: {
        type: "array",
        minItems: 1,
        maxItems: MAX_LOTE,
        description: "Vendas a acrescentar.",
        items: {
          type: "object",
          properties: { ...MOMENTO, texto: { type: "string", description: "Texto da notificação (até 200)." } },
          required: ["texto"],
          additionalProperties: false,
        },
      },
    },
    required: ["webinar_id", "vendas"],
    additionalProperties: false,
  },
  annotations: CRIA,
  escrita: true,
  async executar(chave, args) {
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    const lista = Array.isArray(args.vendas) ? args.vendas : [];
    if (lista.length === 0) return erro("Mande pelo menos uma venda.");
    if (lista.length > MAX_LOTE) return erro(`No máximo ${MAX_LOTE} vendas por chamada.`);

    const linhas: Record<string, unknown>[] = [];
    const erros: string[] = [];
    lista.forEach((item, i) => {
      const v = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const r = validarVendaSimulada({ texto: typeof v.texto === "string" ? v.texto : "", momento: momentoDeArgs(v) });
      if ("erro" in r) erros.push(`Venda ${i + 1}: ${r.erro}`);
      else linhas.push({ webinar_id: w.id, segundo: r.dados.segundo, texto: r.dados.texto });
    });
    if (erros.length > 0) {
      return erro(`Nada foi gravado: ${erros.length} venda(s) com erro.\n${erros.slice(0, MAX_ERROS_EXIBIDOS).join("\n")}${erros.length > MAX_ERROS_EXIBIDOS ? "\n…" : ""}`);
    }

    const g = await inserirTudoOuNada(w.db, "vendas_simuladas", linhas, "vendas");
    if ("erro" in g) return erro(g.erro);

    await auditar(chave, {
      webinarId: w.id,
      acao: "criou",
      descricao: linhas.length === 1 ? "Adicionou uma venda simulada" : `Adicionou ${linhas.length} vendas simuladas`,
    });
    return texto({ ok: true, adicionadas: linhas.length, painel: linkPainel(`/webinars/${w.id}/vendas`) });
  },
};

const editarVendaSimulada: Ferramenta = {
  name: "editar_venda_simulada",
  title: "Editar venda simulada",
  description: "Edita uma venda simulada (veja listar_vendas_simuladas). Só os campos enviados mudam.",
  inputSchema: {
    type: "object",
    properties: {
      webinar_id: WEBINAR,
      id: { ...UUID, description: "Id da venda (listar_vendas_simuladas)." },
      ...MOMENTO,
      texto: { type: "string", description: "Texto (até 200)." },
    },
    required: ["webinar_id", "id"],
    additionalProperties: false,
  },
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    if (!ehUuid(args.id)) return erro("Venda não encontrada.");
    const { data } = await w.db.from("vendas_simuladas").select("id, segundo, texto").eq("id", args.id).eq("webinar_id", w.id).maybeSingle();
    const atual = data as LinhaVenda | null;
    if (!atual) return erro("Venda não encontrada.");

    const r = validarVendaSimulada({ momento: momentoDeArgs(args, formatarDuracao(atual.segundo)), texto: textoOuAtual(args, "texto", atual.texto) });
    if ("erro" in r) return erro(r.erro);
    const depois = { segundo: r.dados.segundo, texto: r.dados.texto };
    const { error } = await w.db.from("vendas_simuladas").update(depois).eq("id", atual.id).eq("webinar_id", w.id);
    if (error) return erro("Não deu para salvar a venda.");

    await auditar(chave, { webinarId: w.id, acao: "editou", descricao: "Editou uma venda simulada", antes: { segundo: atual.segundo, texto: atual.texto }, depois });
    return texto({ ok: true, venda: { id: atual.id, momento: formatarDuracao(depois.segundo), ...depois } });
  },
};

const excluirVendasSimuladas: Ferramenta = {
  name: "excluir_vendas_simuladas",
  title: "Excluir vendas simuladas",
  description:
    "Exclui vendas simuladas por UM critério: `ids`, intervalo de segundos (`de_segundo`/`ate_segundo`, inclusive) ou " +
    "`tudo: true` + `confirmar: true` (apaga todas). Não tem volta.",
  inputSchema: { type: "object", properties: { webinar_id: WEBINAR, ...EXCLUIR_PROPS }, required: ["webinar_id"], additionalProperties: false },
  annotations: APAGA,
  escrita: true,
  async executar(chave, args) {
    const w = await conferirWebinar(args);
    if ("falha" in w) return w.falha;
    const r = await excluirDaLinhaDoTempo(w.db, "vendas_simuladas", w.id, args);
    if ("erro" in r) return erro(r.erro);

    const descricao =
      r.criterio === "tudo"
        ? `Apagou ${r.excluidas} vendas simuladas`
        : r.criterio === "intervalo"
          ? `Excluiu ${r.excluidas} vendas simuladas (${descreverIntervalo(r.de, r.ate)})`
          : r.excluidas === 1
            ? "Excluiu uma venda simulada"
            : `Excluiu ${r.excluidas} vendas simuladas`;
    if (r.excluidas > 0) await auditar(chave, { webinarId: w.id, acao: "excluiu", descricao });
    return texto({ ok: true, excluidas: r.excluidas });
  },
};

const salvarTituloNotificacaoCompra: Ferramenta = {
  name: "salvar_titulo_notificacao_compra",
  title: "Salvar título da notificação de compra",
  description: 'Muda o título das notificações de compra da sala (até 150 caracteres). Vazio volta pro padrão "Venda confirmada!".',
  inputSchema: {
    type: "object",
    properties: { webinar_id: WEBINAR, titulo: { type: "string", description: 'Título (até 150). Ex.: "Mais uma vaga preenchida!".' } },
    required: ["webinar_id", "titulo"],
    additionalProperties: false,
  },
  annotations: ALTERA,
  escrita: true,
  async executar(chave, args) {
    if (!ehUuid(args.webinar_id)) return erro(NAO_ENCONTRADO);
    const r = validarTituloNotificacaoCompra({ titulo_notificacao_compra: typeof args.titulo === "string" ? args.titulo : "" });
    if ("erro" in r) return erro(r.erro);

    const db = dbAdmin();
    const { data: atual } = await db.from("webinars").select("titulo_notificacao_compra").eq("id", args.webinar_id).maybeSingle();
    if (!atual) return erro(NAO_ENCONTRADO);
    const { error } = await db.from("webinars").update({ titulo_notificacao_compra: r.dados.titulo }).eq("id", args.webinar_id);
    if (error) return erro("Não deu para salvar o título.");

    await auditar(chave, {
      webinarId: args.webinar_id,
      acao: "editou",
      descricao: "Editou o título da notificação de compra",
      antes: atual as Record<string, unknown>,
      depois: { titulo_notificacao_compra: r.dados.titulo },
    });
    return texto({ ok: true, titulo_notificacao_compra: r.dados.titulo });
  },
};

export const FERRAMENTAS_CONTEUDO: Ferramenta[] = [
  verAgente,
  salvarAgente,
  testarAgente,
  listarChatSimulado,
  adicionarMensagensChat,
  editarMensagemChat,
  excluirMensagensChat,
  gerarChatIa,
  verGeracaoChat,
  listarVendasSimuladas,
  adicionarVendasSimuladas,
  editarVendaSimulada,
  excluirVendasSimuladas,
  salvarTituloNotificacaoCompra,
];
