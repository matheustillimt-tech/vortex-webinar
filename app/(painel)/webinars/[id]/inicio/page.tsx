import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { FORM_PASSO, TelaPasso } from "../_passos";
import { FormularioInicio } from "./formulario";

export const metadata: Metadata = { title: `Início do webinar · ${NOME_SISTEMA}` };

type Linha = {
  id: string;
  nome: string;
  titulo: string | null;
  slug: string;
  idioma: "pt-BR" | "es" | "en";
  apresentador_nome: string | null;
  apresentador_avatar_url: string | null;
  acesso_facilitado: boolean;
  login_na_sala: boolean;
  sincronizar_video: boolean;
};

export default async function InicioWebinar({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();
  const { data } = await db
    .from("webinars")
    .select(
      "id, nome, titulo, slug, idioma, apresentador_nome, apresentador_avatar_url, acesso_facilitado, login_na_sala, sincronizar_video",
    )
    .eq("id", id)
    .maybeSingle();
  const webinar = data as Linha | null;
  if (!webinar) notFound();

  const salaUrl = process.env.NEXT_PUBLIC_SALA_URL ?? "";

  return (
    <TelaPasso webinarId={id} nome={webinar.nome} atual="inicio" formulario={FORM_PASSO}>
      <FormularioInicio
        idFormulario={FORM_PASSO}
        webinarId={id}
        salaUrl={salaUrl}
        valores={{
          nome: webinar.nome,
          titulo: webinar.titulo ?? "",
          slug: webinar.slug,
          idioma: webinar.idioma,
          apresentadorNome: webinar.apresentador_nome ?? "",
          apresentadorAvatarUrl: webinar.apresentador_avatar_url,
          acessoFacilitado: webinar.acesso_facilitado,
          loginNaSala: webinar.login_na_sala,
          sincronizarVideo: webinar.sincronizar_video,
        }}
      />
    </TelaPasso>
  );
}
