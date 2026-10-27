import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { assistidoPorSessao, contarParticipantesOnline, listarConversas, listarTurmas } from "@/src/lib/atendimento";
import { turmaDe } from "@/src/lib/regras/atendimento";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario, exigirMembro } from "@/src/lib/supabase/usuario";
import { Pagina } from "../../_componentes/ui";
import { SalaAtendimento } from "./_sala/Sala";
import { conversaParaCliente } from "./_sala/types";

export const metadata: Metadata = { title: `Sala de atendimento · ${NOME_SISTEMA}` };

export default async function AtendimentoWebinar({ params }: { params: Promise<{ webinarId: string }> }) {
  const { webinarId } = await params;
  const eu = await exigirMembro();
  const db = await dbUsuario();

  const { data: webinar } = await db.from("webinars").select("id, nome").eq("id", webinarId).maybeSingle();
  if (!webinar) notFound();
  const nome = (webinar as { nome: string }).nome;

  // Abre sempre na turma de hoje (começa vazia a cada dia); as anteriores ficam no seletor de histórico.
  const turmaAtual = turmaDe(new Date());
  const [linhas, online, { data: agente }, turmas] = await Promise.all([
    listarConversas(db, webinarId, new Date(), turmaAtual),
    contarParticipantesOnline(dbAdmin(), webinarId),
    // `agentes_ia` só admin lê pela RLS; o atendente também precisa do nome (membro já conferido acima).
    dbAdmin().from("agentes_ia").select("nome").eq("webinar_id", webinarId).maybeSingle(),
    listarTurmas(db, webinarId),
  ]);
  // Nome com que a IA e a equipe humana respondem na sala (o mesmo pros dois — ver `GET /api/sala/suporte`).
  const nomeEquipe = (agente as { nome: string | null } | null)?.nome?.trim() || null;
  const assistido = await assistidoPorSessao(dbAdmin(), webinarId, linhas.map((c) => c.sessaoId));
  const conversas = linhas.map((c) => conversaParaCliente(c, assistido));

  return (
    <Pagina titulo={nome} trilha={[{ rotulo: "Salas de Atendimento", href: "/atendimento" }]}>
      <SalaAtendimento webinarId={webinarId} eu={eu} nomeEquipe={nomeEquipe} conversasIniciais={conversas} onlineInicial={online} turmasIniciais={turmas} />
    </Pagina>
  );
}
