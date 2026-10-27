import "server-only";
import { cache } from "react";
import { dbAdmin } from "../supabase/admin";
import type { TipoPagina } from "../regras/paginas";
import type { LugarPagina } from "./pagina-montagem";

/** Página do editor como a sala precisa dela: só o publicado (nada do projeto do GrapesJS nem de quem editou). */
export type PaginaSala = { tipo: TipoPagina; html: string; css: string; config: unknown };

type Vinculo = {
  tabela: "jit_config" | "agendas";
  coluna: "pagina_registro_id" | "pagina_espera_id";
  tipo: TipoPagina;
};

/** Onde fica o vínculo da página de cada lugar: JIT em `jit_config` (registro e espera); sessão única/recorrente
 *  em `agendas` (só espera — não tem `/lp`). */
export function vinculoDaPagina(tipoAgenda: "unica" | "recorrente" | "jit", lugar: LugarPagina): Vinculo | null {
  if (tipoAgenda === "jit") {
    return lugar === "registro"
      ? { tabela: "jit_config", coluna: "pagina_registro_id", tipo: "registro_jit" }
      : { tabela: "jit_config", coluna: "pagina_espera_id", tipo: "espera_jit" };
  }
  return lugar === "espera" ? { tabela: "agendas", coluna: "pagina_espera_id", tipo: "espera_unica" } : null;
}

const msg = (e: unknown) => (e as { message?: string } | null)?.message ?? String(e);

/** Página vinculada ao webinar neste lugar (service role, como o resto da sala). `null` sem vínculo, com página de
 *  outro tipo ou com erro no banco (a sala cai na tela atual em vez de quebrar). */
export async function carregarPaginaDaSala(
  webinarId: string,
  tipoAgenda: "unica" | "recorrente" | "jit",
  lugar: LugarPagina,
): Promise<PaginaSala | null> {
  const vinculo = vinculoDaPagina(tipoAgenda, lugar);
  if (!vinculo) return null;
  const db = dbAdmin();
  const { data: linhaVinculo, error: erroVinculo } = await db
    .from(vinculo.tabela)
    .select(vinculo.coluna)
    .eq("webinar_id", webinarId)
    .maybeSingle();
  if (erroVinculo) {
    console.error(`sala/paginas: erro ao ler o vínculo da página (${vinculo.tabela}) do webinar "${webinarId}": ${msg(erroVinculo)}`);
    return null;
  }
  const paginaId = (linhaVinculo as Record<string, string | null> | null)?.[vinculo.coluna];
  if (!paginaId) return null;

  const { data: linha, error } = await db.from("paginas").select("tipo, html, css, config").eq("id", paginaId).maybeSingle();
  if (error) {
    console.error(`sala/paginas: erro ao carregar a página "${paginaId}": ${msg(error)}`);
    return null;
  }
  const p = linha as PaginaSala | null;
  if (!p || p.tipo !== vinculo.tipo) return null;
  return { tipo: p.tipo, html: p.html ?? "", css: p.css ?? "", config: p.config ?? {} };
}

/** Com cache por requisição: `generateMetadata` e a página carregam a mesma página uma vez só. */
export const carregarPaginaDaSalaCached = cache(carregarPaginaDaSala);
