import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { iaConfig } from "@/src/lib/env";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { FORM_PASSO, TelaPasso } from "../_passos";
import { FormularioAgente, type Valores } from "./formulario";

export const metadata: Metadata = { title: `Agente de IA · ${NOME_SISTEMA}` };

export default async function AgenteWebinar({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();

  const { data: webinar } = await db.from("webinars").select("id, nome, slug").eq("id", id).maybeSingle();
  if (!webinar) notFound();

  const { data: atualData } = await db.from("agentes_ia").select("ligado, nome, instrucoes, contexto, faq").eq("webinar_id", id).maybeSingle();
  const atual = atualData as { ligado: boolean; nome: string | null; instrucoes: string | null; contexto: string | null; faq: string | null } | null;

  const valores: Valores = {
    ligado: atual?.ligado ?? false,
    nome: atual?.nome ?? "",
    instrucoes: atual?.instrucoes ?? "",
    contexto: atual?.contexto ?? "",
    faq: atual?.faq ?? "",
  };

  return (
    <TelaPasso webinarId={id} nome={webinar.nome} atual="agente" formulario={FORM_PASSO}>
      <FormularioAgente idFormulario={FORM_PASSO} webinarId={id} valores={valores} iaLigada={!!iaConfig()} />
    </TelaPasso>
  );
}
