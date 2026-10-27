import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { iaConfig } from "@/src/lib/env";
import { tokenTeste } from "@/src/lib/sala/sessao";
import { formatarDuracao } from "@/src/lib/regras/video";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { TelaPasso } from "../_passos";
import { GeracaoIA } from "./geracao";
import { PainelChat } from "./formulario";

export const metadata: Metadata = { title: `Chat simulado · ${NOME_SISTEMA}` };

export type ItemMensagem = {
  id: string;
  momento: string;
  segundo: number;
  nome: string;
  texto: string;
  suporte: boolean;
};

const LIMITE_LISTA = 200;

export default async function ChatWebinar({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();

  const { data: webinar } = await db.from("webinars").select("id, nome, slug").eq("id", id).maybeSingle();
  if (!webinar) notFound();

  const { count } = await db.from("mensagens_simuladas").select("id", { count: "exact", head: true }).eq("webinar_id", id);
  const total = count ?? 0;

  const { data } = await db
    .from("mensagens_simuladas")
    .select("id, segundo, nome, texto, suporte")
    .eq("webinar_id", id)
    .order("segundo", { ascending: true })
    .limit(LIMITE_LISTA);
  const linhas = (data ?? []) as { id: string; segundo: number; nome: string; texto: string; suporte: boolean }[];
  const itens: ItemMensagem[] = linhas.map((l) => ({ ...l, momento: formatarDuracao(l.segundo) }));

  const cfgIa = iaConfig();
  const iaLigada = !!cfgIa && !!cfgIa.elevenlabsKey;
  // "Testar no player": a própria sala no modo teste (controles liberados, sem contar métricas), com o chat
  // simulado, a oferta e o suporte na linha do tempo do vídeo. Mesmo link "Sala teste" do passo Pronto (24 h).
  const salaUrl = (process.env.NEXT_PUBLIC_SALA_URL ?? "").replace(/\/+$/, "");
  const urlTeste = `${salaUrl}/${webinar.slug as string}?teste=${tokenTeste(id, new Date())}`;

  return (
    <TelaPasso webinarId={id} nome={webinar.nome} atual="chat">
      <PainelChat
        webinarId={id}
        itens={itens}
        total={total}
        limite={LIMITE_LISTA}
        urlTeste={urlTeste}
        geracao={<GeracaoIA webinarId={id} iaLigada={iaLigada} />}
      />
    </TelaPasso>
  );
}
