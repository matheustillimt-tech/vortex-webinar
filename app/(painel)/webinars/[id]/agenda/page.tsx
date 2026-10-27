import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { opcoesDePaginas } from "@/src/lib/paginas";
import { agendaDeLinha, estadoSala, proximasSessoes, type LinhaAgenda } from "@/src/lib/regras/agenda";
import { formatarHora, FUSOS, formatarSessao, utcParaLocal } from "@/src/lib/regras/fuso";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Selo } from "../../../_componentes/ui";
import { SeletoresPagina } from "../../../paginas/seletor";
import { FORM_PASSO, TelaPasso, TituloSecao } from "../_passos";
import { salvarPaginaEspera } from "./actions";
import { FormularioAgenda } from "./formulario";
import { TipoAgenda } from "./tipo-agenda";

export const metadata: Metadata = { title: `Agenda · ${NOME_SISTEMA}` };

const ESTADO = { espera: "Sala de espera", aberta: "Sala aberta agora", encerrada: "Sem próximas sessões" } as const;

export default async function AgendaWebinar({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();
  const { data: webinar } = await db.from("webinars").select("id, nome, slug, tipo_agenda").eq("id", id).maybeSingle();
  if (!webinar) notFound();
  if (webinar.tipo_agenda === "jit") redirect(`/webinars/${id}/agenda/jit`);
  const { data: linha } = await db
    .from("agendas")
    .select("fuso, inicio, fim, repeticao, dia_semana, hora_inicio, hora_fim, vigencia_fim, usar_sala_espera, pagina_espera_id")
    .eq("webinar_id", id)
    .maybeSingle();

  const paginas = await opcoesDePaginas(db, ["espera_unica"]);
  const paginaEspera = (linha as { pagina_espera_id?: string | null } | null)?.pagina_espera_id ?? null;
  const agenda = linha ? agendaDeLinha(linha as LinhaAgenda) : null;
  const agora = new Date();
  const fuso = agenda?.fuso ?? FUSOS[0].valor;
  const estado = agenda ? estadoSala(agenda, agora) : null;
  const proximas = agenda ? proximasSessoes(agenda, agora, 3) : [];
  const agendaSalva = agenda !== null && (agenda.inicio !== null || agenda.horaInicio !== null);

  return (
    <TelaPasso webinarId={id} nome={webinar.nome} atual="agenda" formulario={FORM_PASSO}>
      <div className="space-y-8">
        <section>
          <TituloSecao titulo="Tipo do webinar" descricao="Webinar único (com ou sem repetição automática) ou just in time, em que a pessoa escolhe o horário." />
          <TipoAgenda webinarId={id} jit={false} />
        </section>

        <section>
          <TituloSecao titulo="Data e horário" />
          <FormularioAgenda
            idFormulario={FORM_PASSO}
            webinarId={id}
            fusos={FUSOS}
            valores={{
              fuso,
              repeticao: agenda?.repeticao ?? "nenhuma",
              inicio: agenda?.inicio ? utcParaLocal(agenda.inicio, fuso) : "",
              fim: agenda?.fim ? utcParaLocal(agenda.fim, fuso) : "",
              diaSemana: String(agenda?.diaSemana ?? 0),
              horaInicio: agenda?.horaInicio ?? "19:00",
              horaFim: agenda?.horaFim ?? "21:00",
              usarSalaEspera: (linha as { usar_sala_espera?: boolean } | null)?.usar_sala_espera ?? true,
              vigenciaFim: agenda?.vigenciaFim ? utcParaLocal(agenda.vigenciaFim, fuso) : "",
            }}
          />
        </section>

        <section className="border-t border-linha pt-8">
          <TituloSecao
            titulo="Customizar página de espera - Webinar único"
            descricao="Página feita no editor para a sala de espera. Em “Padrão”, a sala usa a tela padrão do sistema. Salva à parte."
          />
          <SeletoresPagina
            acao={salvarPaginaEspera.bind(null, id)}
            seletores={[{ campo: "pagina_espera_id", rotulo: "Página de espera", tipo: "espera_unica", valor: paginaEspera, opcoes: paginas.espera_unica }]}
          />
        </section>

        <section className="border-t border-linha pt-8">
          <TituloSecao
            titulo="Próximas sessões"
            acao={estado && <Selo cor={estado.estado === "aberta" ? "ok" : estado.estado === "espera" ? "aviso" : "neutro"}>{ESTADO[estado.estado]}</Selo>}
          />
          {!agendaSalva ? (
            <p className="text-sm text-texto-3">Salve a agenda para ver as próximas sessões.</p>
          ) : proximas.length === 0 ? (
            <p className="text-sm text-texto-3">Nenhuma sessão futura nessa agenda.</p>
          ) : (
            <ul className="divide-y divide-linha rounded-lg border border-linha text-sm">
              {proximas.map((j) => (
                <li key={j.inicio.toISOString()} className="px-4 py-2.5">
                  {formatarSessao(j.inicio, fuso)} até {formatarHora(j.fim, fuso)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </TelaPasso>
  );
}
