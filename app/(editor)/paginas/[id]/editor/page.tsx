import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { idValido } from "@/src/lib/regras/midia";
import type { TipoPagina } from "@/src/lib/regras/paginas";
import { configDeLinha, ROTULO_TIPO_PAGINA } from "@/src/lib/regras/paginas-editor";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { CarregadorEditor } from "./carregador";

export const metadata: Metadata = { title: `Editor de página · ${NOME_SISTEMA}` };

/** Projeto do GrapesJS guardado em `componentes`. Linha antiga (sem projeto, `[]`) abre a partir do HTML publicado. */
function projetoInicial(componentes: unknown, html: string): Record<string, unknown> {
  if (componentes && typeof componentes === "object" && !Array.isArray(componentes) && Array.isArray((componentes as { pages?: unknown }).pages)) {
    return componentes as Record<string, unknown>;
  }
  return { pages: [{ component: html || "" }], styles: "" };
}

export default async function EditorPagina({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  if (!idValido(id)) notFound();
  const db = await dbUsuario();
  const { data } = await db.from("paginas").select("id, nome, tipo, componentes, config, html").eq("id", id).maybeSingle();
  if (!data) notFound();
  const p = data as { id: string; nome: string; tipo: TipoPagina; componentes: unknown; config: unknown; html: string };

  return (
    <CarregadorEditor
      id={p.id}
      nome={p.nome}
      tipo={ROTULO_TIPO_PAGINA[p.tipo] ?? p.tipo}
      registro={p.tipo === "registro_jit"}
      projeto={projetoInicial(p.componentes, p.html)}
      config={configDeLinha(p.config)}
    />
  );
}
