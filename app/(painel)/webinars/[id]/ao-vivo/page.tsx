import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Pagina } from "../../../_componentes/ui";
import { PainelAoVivo } from "./PainelAoVivo";

export const metadata: Metadata = { title: `Ao vivo · ${NOME_SISTEMA}` };

export default async function AoVivoWebinar({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();

  const { data: webinar } = await db.from("webinars").select("id, nome, slug").eq("id", id).maybeSingle();
  if (!webinar) notFound();

  return (
    <Pagina titulo={webinar.nome} subtitulo={`Ao vivo · /${webinar.slug}`}>
      <PainelAoVivo webinarId={id} />
    </Pagina>
  );
}
