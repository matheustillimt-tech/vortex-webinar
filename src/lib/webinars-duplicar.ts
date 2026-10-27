import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugUnico } from "@/src/lib/regras/slug";
import { lerTudo } from "@/src/lib/supabase/paginar";

/** Duplicar webinar: usada pela action do painel (`duplicarWebinar`, cliente do usuário) e pelo MCP (service role). */

/** 0 ou 1 linha por webinar. */
const TABELAS_UNICAS = ["agendas", "telas_login", "webinar_video", "ofertas", "audiencias", "agentes_ia", "jit_config"] as const;
/** Várias linhas por webinar: inseridas em lotes de 500. */
const TABELAS_MULTIPLAS = ["mensagens_simuladas", "vendas_simuladas", "regras", "jit_horarios", "emails_jit", "tarjas_aviso"] as const;
const TABELAS_SIMULADAS = new Set<string>(["mensagens_simuladas", "vendas_simuladas"]);
const LOTE = 500;

function semColunasGeradas(linha: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, webinar_id: _w, created_at: _c, updated_at: _u, ...resto } = linha;
  return resto;
}

async function copiarTabelasRelacionadas(db: SupabaseClient, origemId: string, destinoId: string): Promise<boolean> {
  for (const tabela of TABELAS_UNICAS) {
    const { data, error } = await db.from(tabela).select("*").eq("webinar_id", origemId).maybeSingle();
    if (error) return false;
    if (!data) continue;
    const { error: erroInsercao } = await db.from(tabela).insert({ ...semColunasGeradas(data), webinar_id: destinoId });
    if (erroInsercao) return false;
  }

  for (const tabela of TABELAS_MULTIPLAS) {
    const simulada = TABELAS_SIMULADAS.has(tabela);
    const { data, error } = await lerTudo(() => {
      const q = db.from(tabela).select("*").eq("webinar_id", origemId);
      return simulada ? q.order("segundo", { ascending: true }).order("id", { ascending: true }) : q.order("id", { ascending: true });
    });
    if (error) return false;
    const linhas = data as Record<string, unknown>[];
    for (let i = 0; i < linhas.length; i += LOTE) {
      const lote = linhas.slice(i, i + LOTE).map((l) => ({ ...semColunasGeradas(l), webinar_id: destinoId }));
      const { error: erroInsercao } = await db.from(tabela).insert(lote);
      if (erroInsercao) return false;
    }
  }
  return true;
}

/** Cria uma cópia ativa do webinar com "(cópia)" no nome e um slug novo, copiando a configuração (agenda, login,
 *  vídeo, oferta, audiência, agente de IA, chat/vendas simulados, tarjas de aviso, integrações e o just in time). Não copia
 *  participantes, sessões, eventos, vendas reais, disparos ou mensagens de suporte. As páginas do editor vinculadas
 *  são compartilhadas: a cópia aponta para as mesmas. Falhou no meio → apaga a cópia (o cascade leva o que já foi
 *  copiado). */
export async function copiarWebinar(
  db: SupabaseClient,
  id: string,
): Promise<{ erro: string } | { id: string; nome: string; slug: string; nomeOriginal: string }> {
  const ERRO = "Não deu para duplicar o webinar.";
  const { data: original, error: erroOriginal } = await db.from("webinars").select("*").eq("id", id).single();
  // PGRST116: nenhuma linha com esse id.
  if ((erroOriginal as { code?: string } | null)?.code === "PGRST116") return { erro: "Webinar não encontrado." };
  if (erroOriginal || !original) return { erro: ERRO };

  const nomeOriginal = original.nome as string;
  const nome = `${nomeOriginal} (cópia)`;
  const baseSlug = `${original.slug as string}-copia`.slice(0, 60).replace(/-+$/, "");
  const parecidosCom = async (prefixo: string) => {
    const { data } = await db.from("webinars").select("slug").like("slug", `${prefixo}%`);
    return ((data ?? []) as { slug: string }[]).map((p) => p.slug);
  };

  const { id: _id, nome: _nome, slug: _slug, status: _status, created_at: _c, updated_at: _u, ...dadosWebinar } = original as Record<string, unknown>;

  let slug = slugUnico(baseSlug, await parecidosCom(baseSlug));
  let { data: novo, error } = await db.from("webinars").insert({ ...dadosWebinar, nome, slug, status: "ativo" }).select("id").single();
  if ((error as { code?: string } | null)?.code === "23505") {
    slug = slugUnico(baseSlug, await parecidosCom(baseSlug.slice(0, 50)));
    ({ data: novo, error } = await db.from("webinars").insert({ ...dadosWebinar, nome, slug, status: "ativo" }).select("id").single());
  }
  if (error || !novo) return { erro: ERRO };
  const novoId = (novo as { id: string }).id;

  if (!(await copiarTabelasRelacionadas(db, id, novoId))) {
    const { error: erroRollback } = await db.from("webinars").delete().eq("id", novoId);
    if (erroRollback) return { erro: "Não deu para duplicar. Uma cópia incompleta ficou na lista: arquive ou apague." };
    return { erro: ERRO };
  }
  return { id: novoId, nome, slug, nomeOriginal };
}
