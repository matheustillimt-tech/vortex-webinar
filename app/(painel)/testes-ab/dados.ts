import "server-only";
import { DateTime } from "luxon";
import { FUSOS } from "@/src/lib/regras/fuso";
import { intervaloDaPagina, POR_PAGINA_LISTA, type Ordem } from "@/src/lib/regras/filtros-lista";
import { escaparIlike } from "@/src/lib/regras/lista-webinars";
import { LETRAS_VARIACAO } from "@/src/lib/regras/teste-ab";
import type { dbUsuario } from "@/src/lib/supabase/usuario";

type Db = Awaited<ReturnType<typeof dbUsuario>>;

export type VariacaoPainel = { letra: string; webinarId: string; nome: string; slug: string; ativo: boolean; percentual: number };

export type TestePainel = {
  id: string;
  nome: string;
  slug: string;
  inicio: Date;
  fim: Date;
  fuso: string;
  arquivado: boolean;
  variacoes: VariacaoPainel[];
};

type Linha = {
  id: string;
  nome: string;
  slug: string;
  inicio: string;
  fim: string;
  fuso: string;
  arquivado: boolean;
  testes_ab_variacoes: { ordem: number; percentual: number; webinar_id: string; webinars: { nome: string; slug: string; status: string } | null }[] | null;
};

const SELECT = "id, nome, slug, inicio, fim, fuso, arquivado, testes_ab_variacoes(ordem, percentual, webinar_id, webinars(nome, slug, status))";

function paraTeste(l: Linha): TestePainel {
  const vs = [...(l.testes_ab_variacoes ?? [])].sort((a, b) => a.ordem - b.ordem);
  return {
    id: l.id,
    nome: l.nome,
    slug: l.slug,
    inicio: new Date(l.inicio),
    fim: new Date(l.fim),
    fuso: l.fuso,
    arquivado: l.arquivado,
    variacoes: vs.map((v, i) => ({
      letra: LETRAS_VARIACAO[i] ?? "?",
      webinarId: v.webinar_id,
      nome: v.webinars?.nome ?? "(webinar excluído)",
      slug: v.webinars?.slug ?? "",
      ativo: v.webinars?.status === "ativo",
      percentual: v.percentual,
    })),
  };
}

export type StatusTesteFiltro = "todos" | "no_ar" | "agendados" | "encerrados" | "arquivados";
export const STATUS_TESTE: { valor: StatusTesteFiltro; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos os status" },
  { valor: "no_ar", rotulo: "No ar" },
  { valor: "agendados", rotulo: "Agendados" },
  { valor: "encerrados", rotulo: "Encerrados" },
  { valor: "arquivados", rotulo: "Arquivados" },
];
export type FiltrosTestes = { busca: string; ordem: Ordem; status: StatusTesteFiltro; de?: Date; ate?: Date; pagina: number };

/** Uma página da lista (barra com busca, Ordenar, Status e período; 10 por página). O status "No ar /
 *  Agendado / Encerrado" sai das datas do teste, o período filtra pelo início do teste. Corta com `range()`. */
export async function listarTestesPagina(db: Db, f: FiltrosTestes, agora: Date = new Date()): Promise<{ testes: TestePainel[]; total: number; erro?: string }> {
  const agoraIso = agora.toISOString();
  let q = db.from("testes_ab").select(SELECT, { count: "exact" }).order("created_at", { ascending: f.ordem === "antigos" }).order("id");
  if (f.busca) q = q.ilike("nome", `%${escaparIlike(f.busca)}%`);
  if (f.status === "arquivados") q = q.eq("arquivado", true);
  else if (f.status !== "todos") q = q.eq("arquivado", false);
  if (f.status === "no_ar") q = q.lte("inicio", agoraIso).gte("fim", agoraIso);
  if (f.status === "agendados") q = q.gt("inicio", agoraIso);
  if (f.status === "encerrados") q = q.lt("fim", agoraIso);
  if (f.de) q = q.gte("inicio", f.de.toISOString());
  if (f.ate) q = q.lt("inicio", f.ate.toISOString());
  const { desde, ate } = intervaloDaPagina(f.pagina, POR_PAGINA_LISTA);
  const { data, error, count } = await q.range(desde, ate);
  if (error) return { testes: [], total: 0, erro: "Não deu para carregar os testes. Tente de novo." };
  return { testes: ((data ?? []) as unknown as Linha[]).map(paraTeste), total: count ?? 0 };
}

export async function carregarTeste(db: Db, id: string): Promise<TestePainel | null> {
  const { data } = await db.from("testes_ab").select(SELECT).eq("id", id).maybeSingle();
  return data ? paraTeste(data as unknown as Linha) : null;
}

export async function temParticipantesTeste(db: Db, id: string): Promise<boolean> {
  const { data } = await db.from("sessoes").select("id").eq("teste_ab_id", id).limit(1);
  return (data ?? []).length > 0;
}

/** Webinars que podem entrar numa variação (ativos), para o seletor com busca. */
export async function webinarsParaVariacao(db: Db): Promise<{ id: string; nome: string; slug: string }[]> {
  const { data } = await db.from("webinars").select("id, nome, slug").eq("status", "ativo").order("nome").limit(1000);
  return (data ?? []) as { id: string; nome: string; slug: string }[];
}

export function linkDoTeste(slug: string): string {
  return `${(process.env.NEXT_PUBLIC_SALA_URL ?? "").replace(/\/+$/, "")}/t/${slug}`;
}

export function rotuloFuso(fuso: string): string {
  return FUSOS.find((f) => f.valor === fuso)?.rotulo ?? fuso;
}

/** `20/10/2026 às 08:00`, no fuso do teste. */
export function dataHora(d: Date, fuso: string): string {
  return DateTime.fromJSDate(d, { zone: fuso }).toFormat("dd/MM/yyyy 'às' HH:mm");
}

export function periodoTexto(t: Pick<TestePainel, "inicio" | "fim" | "fuso">): string {
  return `${dataHora(t.inicio, t.fuso)} até ${dataHora(t.fim, t.fuso)}`;
}

export type SituacaoTeste = { rotulo: string; cor: "ok" | "neutro" | "aviso" | "erro" };

export function situacaoTeste(t: Pick<TestePainel, "inicio" | "fim" | "arquivado">, agora: Date): SituacaoTeste {
  if (t.arquivado) return { rotulo: "Arquivado", cor: "neutro" };
  if (agora < t.inicio) return { rotulo: "Agendado", cor: "aviso" };
  if (agora > t.fim) return { rotulo: "Encerrado", cor: "erro" };
  return { rotulo: "No ar", cor: "ok" };
}
