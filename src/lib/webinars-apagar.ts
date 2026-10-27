import "server-only";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { idValido } from "@/src/lib/regras/midia";

type Db = ReturnType<typeof dbAdmin>;

type LinhaWebinar = { id: string; nome: string; status: string };
type LinhaVariacao = { testes_ab: { nome: string } | null };
type ItemStorage = { name: string; id: string | null };

const BUCKET = "midias";
const PAGINA_STORAGE = 1000;

/** Todos os arquivos debaixo de `pasta` no bucket `midias` (desce nas subpastas: no Storage, pasta é item sem `id`). */
async function listarArquivos(db: Db, pasta: string): Promise<string[]> {
  const caminhos: string[] = [];
  for (let offset = 0; ; offset += PAGINA_STORAGE) {
    const { data, error } = await db.storage.from(BUCKET).list(pasta, { limit: PAGINA_STORAGE, offset });
    if (error) throw new Error(`storage: ${error.message}`);
    const itens = (data ?? []) as ItemStorage[];
    for (const item of itens) {
      const caminho = `${pasta}/${item.name}`;
      if (item.id === null) caminhos.push(...(await listarArquivos(db, caminho)));
      else caminhos.push(caminho);
    }
    if (itens.length < PAGINA_STORAGE) return caminhos;
  }
}

/** Apaga o webinar de vez, com tudo que é dele: agenda, tela de login, oferta, agente, chat e vendas simuladas,
 *  regras e disparos, integrações, participantes, sessões, mensagens, eventos, retenção, vendas, e-mails (tudo em
 *  cascata no banco) e as imagens em `midias/webinars/<id>/`. Fica de fora o que é compartilhado: os vídeos da
 *  biblioteca, as páginas e o histórico de ações (que perde o vínculo, mas guarda o registro).
 *
 *  Só apaga webinar **arquivado** (pra nunca apagar sem querer um que está no ar) e que não seja variação de um
 *  teste A/B (o banco não deixa; tem que tirar do teste antes). As imagens saem antes da linha do webinar: se o
 *  Storage falhar, nada foi apagado e dá pra tentar de novo. */
export async function apagarWebinarDeVez(id: string, deps: { db?: Db } = {}): Promise<{ nome: string } | { erro: string }> {
  if (!idValido(id)) return { erro: "Webinar não encontrado." };
  const db = deps.db ?? dbAdmin();

  const { data: webinarData } = await db.from("webinars").select("id, nome, status").eq("id", id).maybeSingle();
  const webinar = webinarData as LinhaWebinar | null;
  if (!webinar) return { erro: "Webinar não encontrado." };
  if (webinar.status !== "arquivado") return { erro: "Arquive o webinar antes de apagar." };

  const { data: variacoesData } = await db.from("testes_ab_variacoes").select("testes_ab(nome)").eq("webinar_id", id);
  const variacoes = (variacoesData ?? []) as unknown as LinhaVariacao[];
  if (variacoes.length > 0) {
    const nomes = [...new Set(variacoes.map((v) => v.testes_ab?.nome).filter(Boolean))].join(", ");
    return { erro: `Este webinar está no teste A/B${nomes ? ` “${nomes}”` : ""}. Tire ele do teste antes de apagar.` };
  }

  try {
    const arquivos = await listarArquivos(db, `webinars/${id}`);
    for (let i = 0; i < arquivos.length; i += PAGINA_STORAGE) {
      const { error } = await db.storage.from(BUCKET).remove(arquivos.slice(i, i + PAGINA_STORAGE));
      if (error) throw new Error(`storage: ${error.message}`);
    }
  } catch (e) {
    console.error("[apagar webinar] imagens:", e);
    return { erro: "Não deu para apagar as imagens do webinar. Nada foi apagado; tente de novo." };
  }

  const { error } = await db.from("webinars").delete().eq("id", id);
  if (error) {
    console.error("[apagar webinar] banco:", error);
    return { erro: "Não deu para apagar o webinar." };
  }
  return { nome: webinar.nome };
}
