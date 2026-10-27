"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { idValido } from "@/src/lib/regras/midia";
import { validarTesteAb, type DadosTesteAb, type EntradaTesteAb, type VariacaoAb } from "@/src/lib/regras/teste-ab";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; valores?: Record<string, string> };

type Db = Awaited<ReturnType<typeof dbUsuario>>;

const NAO_ENCONTRADO = "Teste não encontrado.";
const LINK_EM_USO = "Este link já está em uso.";

/** Campos do formulário. As variações vêm em listas paralelas (`variacao_webinar`, `variacao_percentual`), na ordem
 *  A, B, C, D; sem nenhuma (campos travados/desabilitados no formulário) = `null` (mantém as atuais). */
function lerFormulario(form: FormData): { entrada: EntradaTesteAb; valores: Record<string, string> } {
  const texto = (k: string) => String(form.get(k) ?? "");
  const webinars = form.getAll("variacao_webinar").map(String);
  const percentuais = form.getAll("variacao_percentual").map(String);
  const variacoes = webinars.length ? webinars.map((w, i) => ({ webinar_id: w, percentual: percentuais[i] ?? "" })) : null;
  const valores = { nome: texto("nome"), slug: texto("slug"), inicio: texto("inicio"), fim: texto("fim"), fuso: texto("fuso") };
  return { entrada: { ...valores, variacoes }, valores };
}

/** Slug já usado por um webinar ou por outro teste (o próprio teste não conta, na edição). */
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

/** Ids, entre os escolhidos, de webinars ativos. */
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

const linhasVariacoes = (testeId: string, vs: VariacaoAb[]) =>
  vs.map((v, ordem) => ({ teste_id: testeId, webinar_id: v.webinarId, ordem, percentual: v.percentual }));

const resumo = (d: DadosTesteAb) => ({
  nome: d.nome,
  slug: d.slug,
  inicio: d.inicio.toISOString(),
  fim: d.fim.toISOString(),
  fuso: d.fuso,
  variacoes: d.variacoes,
});

const ehSlugDuplicado = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "23505";

function revalidar(id?: string) {
  revalidatePath("/testes-ab");
  if (id) revalidatePath(`/testes-ab/${id}`);
}

export async function criarTesteAb(_: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const { entrada, valores } = lerFormulario(form);
  const db = await dbUsuario();
  const r = validarTesteAb(entrada, {
    slugsOcupados: await slugsOcupados(db, valores.slug, null),
    webinarsAtivos: await webinarsAtivos(db, entrada),
  });
  if ("erro" in r) return { erro: r.erro, valores };
  const d = r.dados;

  const { data, error } = await db
    .from("testes_ab")
    .insert({ nome: d.nome, slug: d.slug, inicio: d.inicio.toISOString(), fim: d.fim.toISOString(), fuso: d.fuso })
    .select("id")
    .single();
  if (error || !data) return { erro: ehSlugDuplicado(error) ? LINK_EM_USO : "Não deu para criar o teste.", valores };
  const id = (data as { id: string }).id;

  const { error: erroVariacoes } = await db.from("testes_ab_variacoes").insert(linhasVariacoes(id, d.variacoes));
  if (erroVariacoes) {
    // Sem as variações o link não funciona: desfaz o teste em vez de deixar um teste vazio.
    await db.from("testes_ab").delete().eq("id", id);
    return { erro: "Não deu para salvar as variações do teste.", valores };
  }

  revalidar();
  await registrarAuditoria({ usuarioId: eu.id, acao: "criou", descricao: `Criou o teste A/B "${d.nome}"`, depois: { id, ...resumo(d) } });
  redirect(`/testes-ab/${id}?criado=1`);
}

/** Edição. Com participantes, só nome, link e datas mudam: as variações ficam como estão (o formulário não as
 *  envia; se enviar diferentes, recusa). Sem participantes, as variações são trocadas (apaga e insere). */
export async function editarTesteAb(id: string, _: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const { entrada, valores } = lerFormulario(form);
  if (!idValido(id)) return { erro: NAO_ENCONTRADO, valores };
  const db = await dbUsuario();

  const { data: antes } = await db.from("testes_ab").select("nome, slug, inicio, fim, fuso").eq("id", id).maybeSingle();
  if (!antes) return { erro: NAO_ENCONTRADO, valores };
  const comParticipantes = await temParticipantes(db, id);
  const atuais = await variacoesAtuais(db, id);

  const r = validarTesteAb(entrada, {
    slugsOcupados: await slugsOcupados(db, valores.slug, id),
    webinarsAtivos: await webinarsAtivos(db, entrada),
    temParticipantes: comParticipantes,
    variacoesAtuais: atuais,
  });
  if ("erro" in r) return { erro: r.erro, valores };
  const d = r.dados;

  const { error } = await db
    .from("testes_ab")
    .update({ nome: d.nome, slug: d.slug, inicio: d.inicio.toISOString(), fim: d.fim.toISOString(), fuso: d.fuso })
    .eq("id", id);
  if (error) return { erro: ehSlugDuplicado(error) ? LINK_EM_USO : "Não deu para salvar o teste.", valores };

  if (!comParticipantes) {
    const { error: erroApagar } = await db.from("testes_ab_variacoes").delete().eq("teste_id", id);
    if (erroApagar) return { erro: "Não deu para salvar as variações do teste.", valores };
    const { error: erroInserir } = await db.from("testes_ab_variacoes").insert(linhasVariacoes(id, d.variacoes));
    if (erroInserir) {
      // Volta as anteriores para o link não ficar sem variação.
      if (atuais.length) await db.from("testes_ab_variacoes").insert(linhasVariacoes(id, atuais));
      return { erro: "Não deu para salvar as variações do teste.", valores };
    }
  }

  revalidar(id);
  await registrarAuditoria({
    usuarioId: eu.id,
    acao: "editou",
    descricao: `Editou o teste A/B "${d.nome}"`,
    antes: { ...(antes as Record<string, unknown>), variacoes: atuais },
    depois: resumo(d),
  });
  redirect(`/testes-ab/${id}`);
}

async function mudarArquivado(id: string, arquivado: boolean): Promise<{ erro?: string }> {
  const eu = await exigirAdmin();
  if (!idValido(id)) return { erro: NAO_ENCONTRADO };
  const db = await dbUsuario();
  const { data: antes } = await db.from("testes_ab").select("nome, arquivado").eq("id", id).maybeSingle();
  if (!antes) return { erro: NAO_ENCONTRADO };
  const { error } = await db.from("testes_ab").update({ arquivado }).eq("id", id);
  if (error) return { erro: arquivado ? "Não deu para arquivar o teste." : "Não deu para reativar o teste." };

  revalidar(id);
  const nome = (antes as { nome: string }).nome;
  await registrarAuditoria({
    usuarioId: eu.id,
    acao: "editou",
    descricao: `${arquivado ? "Arquivou" : "Reativou"} o teste A/B "${nome}"`,
    antes: { arquivado: (antes as { arquivado: boolean }).arquivado },
    depois: { arquivado },
  });
  return {};
}

/** Arquivar tira o link do ar ("Este link não está disponível agora."); as sessões e métricas continuam. */
export async function arquivarTesteAb(id: string): Promise<{ erro?: string }> {
  return mudarArquivado(id, true);
}

export async function reativarTesteAb(id: string): Promise<{ erro?: string }> {
  return mudarArquivado(id, false);
}
