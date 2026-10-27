import "server-only";
import { temFormulario, validarVinculoPagina, type TipoPagina } from "@/src/lib/regras/paginas";
import { idValido } from "@/src/lib/regras/midia";
import type { dbUsuario } from "@/src/lib/supabase/usuario";

type DB = Awaited<ReturnType<typeof dbUsuario>>;

/** Id de página vindo de um seletor: "" (Padrão) → null. */
export function idPaginaDoCampo(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

/** Confere no servidor se a página pode ir neste lugar (`validarVinculoPagina`). `null` (Padrão) sempre pode. */
export async function erroVinculo(db: DB, paginaId: string | null, lugar: TipoPagina): Promise<string | null> {
  if (!paginaId) return null;
  if (!idValido(paginaId)) return "Página não encontrada.";
  const { data, error } = await db.from("paginas").select("tipo, html").eq("id", paginaId).maybeSingle();
  if (error) return "Não deu para conferir a página.";
  if (!data) return "Página não encontrada.";
  return validarVinculoPagina(data as { tipo: string; html: string }, lugar);
}

export type Vinculo = { webinarId: string; nome: string; lugar: TipoPagina };

type LinhaJit = { webinar_id: string; pagina_registro_id: string | null; pagina_espera_id: string | null; webinars: { nome: string } | null };
type LinhaAgenda = { webinar_id: string; webinars: { nome: string } | null };

/** Webinars que usam a página (just in time: registro/espera; agenda: espera). */
export async function vinculosDaPagina(db: DB, paginaId: string): Promise<Vinculo[] | null> {
  if (!idValido(paginaId)) return []; // o id vai num filtro `or(...)`: só UUID
  const [jit, agendas] = await Promise.all([
    db
      .from("jit_config")
      .select("webinar_id, pagina_registro_id, pagina_espera_id, webinars(nome)")
      .or(`pagina_registro_id.eq.${paginaId},pagina_espera_id.eq.${paginaId}`),
    db.from("agendas").select("webinar_id, webinars(nome)").eq("pagina_espera_id", paginaId),
  ]);
  if (jit.error || agendas.error) return null;
  const lista: Vinculo[] = [];
  for (const l of (jit.data ?? []) as unknown as LinhaJit[]) {
    const nome = l.webinars?.nome ?? "Webinar";
    if (l.pagina_registro_id === paginaId) lista.push({ webinarId: l.webinar_id, nome, lugar: "registro_jit" });
    if (l.pagina_espera_id === paginaId) lista.push({ webinarId: l.webinar_id, nome, lugar: "espera_jit" });
  }
  for (const l of (agendas.data ?? []) as unknown as LinhaAgenda[]) {
    lista.push({ webinarId: l.webinar_id, nome: l.webinars?.nome ?? "Webinar", lugar: "espera_unica" });
  }
  return lista;
}

export type OpcaoDePagina = { id: string; nome: string; semFormulario?: boolean };

/** Páginas que podem ir nos seletores, por tipo (as de registro sem o bloco `formulario` vêm marcadas). */
export async function opcoesDePaginas(db: DB, tipos: TipoPagina[]): Promise<Record<TipoPagina, OpcaoDePagina[]>> {
  const saida: Record<TipoPagina, OpcaoDePagina[]> = { registro_jit: [], espera_jit: [], espera_unica: [] };
  const { data } = await db.from("paginas").select("id, nome, tipo, html").in("tipo", tipos).order("nome", { ascending: true });
  for (const p of (data ?? []) as { id: string; nome: string; tipo: TipoPagina; html: string }[]) {
    if (!saida[p.tipo]) continue;
    saida[p.tipo].push(p.tipo === "registro_jit" && !temFormulario(p.html) ? { id: p.id, nome: p.nome, semFormulario: true } : { id: p.id, nome: p.nome });
  }
  return saida;
}
