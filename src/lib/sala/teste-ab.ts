import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbAdmin } from "../supabase/admin";
import { verificarTokenAb } from "../regras/sessao-token";
import { dentroDoPeriodo } from "../regras/teste-ab";
import type { Idioma } from "../regras/textos-sala";

export type VariacaoAtivaAb = { ordem: number; webinarId: string; percentual: number; slug: string; idioma: Idioma };

/** Teste A/B pela entrada `/t/<slug>`. `variacoes` só traz as de webinar ativo, na ordem A, B, C, D. */
export type TesteAbSala = {
  id: string;
  inicio: Date;
  fim: Date;
  arquivado: boolean;
  variacoes: VariacaoAtivaAb[];
  /** Idioma da página "link indisponível": o do primeiro webinar do teste (pt-BR sem nenhum). */
  idioma: Idioma;
};

type LinhaVariacao = {
  ordem: number;
  percentual: number;
  webinar_id: string;
  webinars: { slug: string; status: string; idioma: Idioma | null } | null;
};

/** `null` se o teste não existe (ou a consulta falhou: loga e trata como inexistente). */
export async function carregarTesteAb(slug: string): Promise<TesteAbSala | null> {
  const { data, error } = await dbAdmin()
    .from("testes_ab")
    .select("id, inicio, fim, arquivado, testes_ab_variacoes(ordem, percentual, webinar_id, webinars(slug, status, idioma))")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error(`sala/teste-ab: não deu para ler o teste "${slug}": ${(error as { message?: string }).message ?? error}`);
    return null;
  }
  if (!data) return null;
  const linha = data as unknown as { id: string; inicio: string; fim: string; arquivado: boolean; testes_ab_variacoes: LinhaVariacao[] | null };
  const todas = [...(linha.testes_ab_variacoes ?? [])].sort((a, b) => a.ordem - b.ordem);
  const idioma = todas.find((v) => v.webinars?.idioma)?.webinars?.idioma ?? "pt-BR";
  return {
    id: linha.id,
    inicio: new Date(linha.inicio),
    fim: new Date(linha.fim),
    arquivado: !!linha.arquivado,
    idioma,
    variacoes: todas
      .filter((v) => v.webinars && v.webinars.status === "ativo")
      .map((v) => ({ ordem: v.ordem, webinarId: v.webinar_id, percentual: v.percentual, slug: v.webinars!.slug, idioma: v.webinars!.idioma ?? "pt-BR" })),
  };
}

/** Teste A/B que trouxe a pessoa a este webinar, pelo cookie de marcação `vw_abw_<webinarId>` (gravado pelo
 *  `/t/<slug>`): assinatura do A/B válida, não expirado, do mesmo webinar, o teste ainda existe com esse webinar
 *  como variação e está valendo agora (não arquivado e dentro do período, as mesmas regras do `/t/<slug>`). Qualquer falha → null (a sessão nasce sem teste; nunca derruba a entrada). */
export async function testeAbDoCookie(
  db: SupabaseClient,
  valorCookie: string | undefined,
  webinarId: string,
  segredo: string,
  agora: Date,
): Promise<string | null> {
  if (!valorCookie) return null;
  const dados = verificarTokenAb(valorCookie, segredo, Math.floor(agora.getTime() / 1000));
  if (!dados || dados.w !== webinarId) return null;
  try {
    const { data, error } = await db
      .from("testes_ab_variacoes")
      .select("teste_id, testes_ab(inicio, fim, arquivado)")
      .eq("teste_id", dados.t)
      .eq("webinar_id", webinarId)
      .maybeSingle();
    if (error || !data) return null;
    const teste = (data as unknown as { testes_ab: { inicio: string; fim: string; arquivado: boolean } | null }).testes_ab;
    if (!teste) return null;
    if (!dentroDoPeriodo({ inicio: new Date(teste.inicio), fim: new Date(teste.fim), arquivado: !!teste.arquivado }, agora)) return null;
    return dados.t;
  } catch {
    return null;
  }
}
