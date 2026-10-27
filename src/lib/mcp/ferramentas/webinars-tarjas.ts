import "server-only";
import { CORES_TARJA, LIMITE_TARJAS, POSICOES_TARJA, formatarMomentoTarja, validarTarja, type DadosTarja } from "../../regras/tarjas";
import { dbAdmin } from "../../supabase/admin";
import { ALTERA, APAGA, CRIA, SO_LEITURA, WEBINAR, auditar, ehUuid, erro, texto, type Ferramenta } from "../comum";

/** Tarjas de aviso (faixa por cima do vídeo da sala, passo Vídeo): as mesmas regras de
 *  `app/(painel)/webinars/[id]/video/actions.ts` — `validarTarja`, até 20 por webinar, momento dentro do vídeo. */

const CAMPOS_TARJA = "texto, aparece_seg, duracao_seg, posicao, cor, ligada";
type LinhaTarja = { id?: string; texto: string; aparece_seg: number; duracao_seg: number; posicao: string; cor: string; ligada: boolean };

const ERRO_WEBINAR = "Webinar não encontrado.";
const ERRO_TARJA = "Tarja não encontrada.";

async function webinarExiste(id: unknown): Promise<boolean> {
  if (!ehUuid(id)) return false;
  const { data } = await dbAdmin().from("webinars").select("id").eq("id", id).maybeSingle();
  return !!data;
}

async function duracaoDoVideo(webinarId: string): Promise<number | null> {
  const { data } = await dbAdmin().from("webinar_video").select("videos(duracao_seg)").eq("webinar_id", webinarId).maybeSingle();
  return (data as { videos: { duracao_seg: number | null } | null } | null)?.videos?.duracao_seg ?? null;
}

const linhaDaTarja = (d: DadosTarja) => ({ texto: d.texto, aparece_seg: d.apareceSeg, duracao_seg: d.duracaoSeg, posicao: d.posicao, cor: d.cor, ligada: d.ligada });
const saida = (t: LinhaTarja) => ({ id: t.id, texto: t.texto, aparece: formatarMomentoTarja(t.aparece_seg), aparece_seg: t.aparece_seg, duracao_seg: t.duracao_seg, posicao: t.posicao, cor: t.cor, ligada: t.ligada });

/** Linha salva + args → campos do formulário do modal (`aparece` em h:mm:ss, `ligada` "on"/""). */
function campos(base: LinhaTarja | null, a: Record<string, unknown>): Record<string, string> {
  const c: Record<string, string> = base
    ? { texto: base.texto, aparece: formatarMomentoTarja(base.aparece_seg), duracao_seg: String(base.duracao_seg), posicao: base.posicao, cor: base.cor, ligada: base.ligada ? "on" : "" }
    : {};
  if (typeof a.texto === "string") c.texto = a.texto;
  if (typeof a.aparece === "string" || typeof a.aparece === "number") c.aparece = String(a.aparece);
  if (typeof a.duracao_seg === "number" || typeof a.duracao_seg === "string") c.duracao_seg = String(a.duracao_seg);
  if (typeof a.posicao === "string") c.posicao = a.posicao;
  if (typeof a.cor === "string") c.cor = a.cor;
  if (typeof a.ligada === "boolean") c.ligada = a.ligada ? "on" : "";
  return c;
}

const PROPRIEDADES = {
  texto: { type: "string", maxLength: 120, description: "Texto da tarja (uma linha, até 120 caracteres). Ex.: \"Nós vamos fechar a sala, não saia dela!\"" },
  aparece: { type: "string", description: "Momento do vídeo em que aparece: h:mm:ss, m:ss ou segundos (\"95\"). Tem que ser antes do fim do vídeo." },
  duracao_seg: { type: "integer", minimum: 3, maximum: 600, description: "Quantos segundos fica na tela (3 a 600). Padrão 15." },
  posicao: { type: "string", enum: POSICOES_TARJA, description: "Topo ou base do vídeo. Padrão topo." },
  cor: { type: "string", enum: CORES_TARJA, description: "Cor da faixa. Padrão vermelho." },
  ligada: { type: "boolean", description: "Ligada (aparece na sala) ou desligada. Padrão ligada." },
} as const;

export const FERRAMENTAS_TARJAS: Ferramenta[] = [
  {
    name: "listar_tarjas",
    title: "Listar tarjas de aviso",
    description: "Lista as tarjas de aviso do webinar (faixas por cima do vídeo que seguram a retenção), na ordem em que aparecem, com momento, duração, posição, cor e se está ligada.",
    inputSchema: { type: "object", properties: { webinar_id: WEBINAR }, required: ["webinar_id"], additionalProperties: false },
    annotations: SO_LEITURA,
    escrita: false,
    executar: async (_c, a) => {
      if (!(await webinarExiste(a.webinar_id))) return erro(ERRO_WEBINAR);
      const { data, error } = await dbAdmin().from("tarjas_aviso").select(`id, ${CAMPOS_TARJA}`).eq("webinar_id", a.webinar_id).order("aparece_seg").order("id");
      if (error) return erro("Não deu para ler as tarjas.");
      return texto({ tarjas: ((data ?? []) as LinhaTarja[]).map(saida), limite: LIMITE_TARJAS });
    },
  },
  {
    name: "adicionar_tarja",
    title: "Adicionar tarja de aviso",
    description: `Adiciona uma tarja de aviso sobre o vídeo da sala (até ${LIMITE_TARJAS} por webinar). Muda a sala no ar: confirme com o usuário.`,
    inputSchema: { type: "object", properties: { webinar_id: WEBINAR, ...PROPRIEDADES }, required: ["webinar_id", "texto", "aparece"], additionalProperties: false },
    annotations: CRIA,
    escrita: true,
    executar: async (chave, a) => {
      if (!(await webinarExiste(a.webinar_id))) return erro(ERRO_WEBINAR);
      const webinarId = a.webinar_id as string;
      const r = validarTarja(campos(null, a), await duracaoDoVideo(webinarId));
      if ("erro" in r) return erro(r.erro);
      const db = dbAdmin();
      const { count, error: erroContagem } = await db.from("tarjas_aviso").select("id", { count: "exact", head: true }).eq("webinar_id", webinarId);
      if (erroContagem) return erro("Não deu para adicionar a tarja.");
      if ((count ?? 0) >= LIMITE_TARJAS) return erro(`Cada webinar pode ter até ${LIMITE_TARJAS} tarjas.`);
      const depois = { webinar_id: webinarId, ...linhaDaTarja(r.dados) };
      const { data, error } = await db.from("tarjas_aviso").insert(depois).select(`id, ${CAMPOS_TARJA}`).single();
      if (error || !data) return erro("Não deu para adicionar a tarja.");
      await auditar(chave, { webinarId, acao: "criou", descricao: `Adicionou a tarja de aviso "${r.dados.texto}"`, depois });
      return texto({ mensagem: "Tarja adicionada.", tarja: saida(data as LinhaTarja) });
    },
  },
  {
    name: "editar_tarja",
    title: "Editar tarja de aviso",
    description: "Edita uma tarja de aviso. Só os campos enviados mudam; o resto fica como está. Também liga/desliga (ligada).",
    inputSchema: { type: "object", properties: { webinar_id: WEBINAR, tarja_id: { type: "string", format: "uuid", description: "Id da tarja (veja listar_tarjas)." }, ...PROPRIEDADES }, required: ["webinar_id", "tarja_id"], additionalProperties: false },
    annotations: ALTERA,
    escrita: true,
    executar: async (chave, a) => {
      if (!ehUuid(a.webinar_id)) return erro(ERRO_WEBINAR);
      if (!ehUuid(a.tarja_id)) return erro(ERRO_TARJA);
      const db = dbAdmin();
      const { data: antes } = await db.from("tarjas_aviso").select(CAMPOS_TARJA).eq("id", a.tarja_id).eq("webinar_id", a.webinar_id).maybeSingle();
      if (!antes) return erro(ERRO_TARJA);
      const r = validarTarja(campos(antes as LinhaTarja, a), await duracaoDoVideo(a.webinar_id));
      if ("erro" in r) return erro(r.erro);
      const depois = linhaDaTarja(r.dados);
      const { error } = await db.from("tarjas_aviso").update(depois).eq("id", a.tarja_id).eq("webinar_id", a.webinar_id);
      if (error) return erro("Não deu para salvar a tarja.");
      await auditar(chave, { webinarId: a.webinar_id, acao: "editou", descricao: `Editou a tarja de aviso "${r.dados.texto}"`, antes: antes as Record<string, unknown>, depois });
      return texto({ mensagem: "Tarja salva.", tarja: saida({ id: a.tarja_id, ...depois }) });
    },
  },
  {
    name: "excluir_tarja",
    title: "Excluir tarja de aviso",
    description: "Exclui uma tarja de aviso do webinar. Para só esconder, use editar_tarja com ligada=false.",
    inputSchema: { type: "object", properties: { webinar_id: WEBINAR, tarja_id: { type: "string", format: "uuid", description: "Id da tarja (veja listar_tarjas)." } }, required: ["webinar_id", "tarja_id"], additionalProperties: false },
    annotations: APAGA,
    escrita: true,
    executar: async (chave, a) => {
      if (!ehUuid(a.webinar_id)) return erro(ERRO_WEBINAR);
      if (!ehUuid(a.tarja_id)) return erro(ERRO_TARJA);
      const db = dbAdmin();
      const { data: antes } = await db.from("tarjas_aviso").select(CAMPOS_TARJA).eq("id", a.tarja_id).eq("webinar_id", a.webinar_id).maybeSingle();
      if (!antes) return erro(ERRO_TARJA);
      const { error } = await db.from("tarjas_aviso").delete().eq("id", a.tarja_id).eq("webinar_id", a.webinar_id);
      if (error) return erro("Não deu para excluir a tarja.");
      await auditar(chave, { webinarId: a.webinar_id, acao: "excluiu", descricao: `Excluiu a tarja de aviso "${(antes as LinhaTarja).texto}"`, antes: antes as Record<string, unknown> });
      return texto({ mensagem: "Tarja excluída." });
    },
  },
];
