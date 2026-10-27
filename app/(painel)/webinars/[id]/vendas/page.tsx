import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatarDuracao } from "@/src/lib/regras/video";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { FORM_PASSO, TelaPasso } from "../_passos";
import { PainelVendas } from "./formulario";

export const metadata: Metadata = { title: `Vendas simuladas · ${NOME_SISTEMA}` };

export type ItemVenda = { id: string; momento: string; segundo: number; texto: string };

const LIMITE_LISTA = 200;

export default async function VendasWebinar({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();

  const { data: webinar } = await db.from("webinars").select("id, nome, slug, titulo_notificacao_compra").eq("id", id).maybeSingle();
  if (!webinar) notFound();
  const w = webinar as { id: string; nome: string; slug: string; titulo_notificacao_compra: string | null };

  const { count } = await db.from("vendas_simuladas").select("id", { count: "exact", head: true }).eq("webinar_id", id);
  const total = count ?? 0;

  const { data } = await db
    .from("vendas_simuladas")
    .select("id, segundo, texto")
    .eq("webinar_id", id)
    .order("segundo", { ascending: true })
    .limit(LIMITE_LISTA);
  const linhas = (data ?? []) as { id: string; segundo: number; texto: string }[];
  const itens: ItemVenda[] = linhas.map((l) => ({ ...l, momento: formatarDuracao(l.segundo) }));

  return (
    <TelaPasso webinarId={id} nome={w.nome} atual="vendas" formulario={FORM_PASSO}>
      <PainelVendas
        idFormulario={FORM_PASSO}
        webinarId={id}
        titulo={w.titulo_notificacao_compra ?? "Venda confirmada!"}
        itens={itens}
        total={total}
        limite={LIMITE_LISTA}
      />
    </TelaPasso>
  );
}
