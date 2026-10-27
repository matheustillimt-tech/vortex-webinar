"use client";
import { useActionState, useState } from "react";
import { salvarAgenda, type Resultado } from "./actions";
import { Campo, CampoSelecao, estiloInput } from "../../../_componentes/ui";
import { AvisoFormulario, Interruptor } from "../../_componentes/campos";
import { useEnvioPasso } from "../../_componentes/assistente";

type Repeticao = "nenhuma" | "diaria" | "dias_uteis" | "semanal";
type Quando = Exclude<Repeticao, "nenhuma">;

type Valores = {
  fuso: string;
  repeticao: Repeticao;
  inicio: string;
  fim: string;
  diaSemana: string;
  horaInicio: string;
  horaFim: string;
  usarSalaEspera: boolean;
  vigenciaFim: string;
};

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** Webinar único: data/hora de início e fim, fuso, switch "Ativar repetição automática" (com "Escolha
 *  quando": diário, segunda a sexta ou semanal) e switch da sala de espera. O campo `repeticao` continua o mesmo da action. */
export function FormularioAgenda({ idFormulario, webinarId, valores, fusos }: { idFormulario: string; webinarId: string; valores: Valores; fusos: { valor: string; rotulo: string }[] }) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(salvarAgenda.bind(null, webinarId), {});
  useEnvioPasso(enviando);
  // Se a última tentativa deu erro, usa o que a pessoa digitou; senão, o que está salvo.
  const v = estado.valores;
  const efetivos: Valores = v
    ? {
        fuso: v.fuso ?? valores.fuso,
        repeticao: (v.repeticao as Repeticao) ?? valores.repeticao,
        inicio: v.inicio ?? valores.inicio,
        fim: v.fim ?? valores.fim,
        diaSemana: v.dia_semana ?? valores.diaSemana,
        horaInicio: v.hora_inicio ?? valores.horaInicio,
        horaFim: v.hora_fim ?? valores.horaFim,
        usarSalaEspera: v.usar_sala_espera === "on",
        vigenciaFim: v.vigencia_fim ?? valores.vigenciaFim,
      }
    : valores;
  const [repetir, setRepetir] = useState(efetivos.repeticao !== "nenhuma");
  const [quando, setQuando] = useState<Quando>(efetivos.repeticao === "nenhuma" ? "diaria" : efetivos.repeticao);
  const repeticao: Repeticao = repetir ? quando : "nenhuma";
  // Remonta os campos (com os novos defaultValues) a cada tentativa, sem perder o que foi digitado.
  const chaveTentativa = estado.erro ?? "inicial";

  return (
    <form id={idFormulario} action={enviar} className="space-y-5" key={chaveTentativa}>
      <input type="hidden" name="repeticao" value={repeticao} />

      {!repetir && (
        <div className="grid gap-4 tela-md:grid-cols-2">
          <Campo rotulo="Data e hora de início" obrigatorio>
            <input type="datetime-local" name="inicio" className={estiloInput} defaultValue={efetivos.inicio} />
          </Campo>
          <Campo rotulo="Data e hora de finalização" obrigatorio>
            <input type="datetime-local" name="fim" className={estiloInput} defaultValue={efetivos.fim} />
          </Campo>
        </div>
      )}

      <CampoSelecao rotulo="Fuso horário" name="fuso" defaultValue={efetivos.fuso} classeCampo="tela-md:max-w-[calc(50%-0.5rem)]">
        {fusos.map((f) => (
          <option key={f.valor} value={f.valor}>
            {f.rotulo}
          </option>
        ))}
      </CampoSelecao>

      <div className="space-y-4 rounded-lg border border-borda p-4">
        <Interruptor
          checked={repetir}
          onChange={(e) => setRepetir(e.target.checked)}
          rotulo="Ativar repetição automática"
          descricao="Repete o webinar todo dia, de segunda a sexta ou toda semana no mesmo horário."
        />

        {repetir && (
          <div className="grid gap-4 tela-md:grid-cols-3">
            <Campo rotulo="Escolha quando" obrigatorio>
              <select className={estiloInput} value={quando} onChange={(e) => setQuando(e.target.value as Quando)}>
                <option value="diaria">Diário</option>
                <option value="dias_uteis">Segunda a sexta</option>
                <option value="semanal">Semanal</option>
              </select>
            </Campo>
            {quando === "semanal" && (
              <CampoSelecao rotulo="Dia da semana" name="dia_semana" defaultValue={efetivos.diaSemana} required>
                {DIAS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </CampoSelecao>
            )}
            <Campo rotulo="Horário inicial" obrigatorio>
              <input type="time" name="hora_inicio" className={estiloInput} defaultValue={efetivos.horaInicio} />
            </Campo>
            <Campo rotulo="Horário final" obrigatorio dica="Se for antes do inicial, fecha no dia seguinte.">
              <input type="time" name="hora_fim" className={estiloInput} defaultValue={efetivos.horaFim} />
            </Campo>
            <Campo rotulo="Começar em (opcional)" dica="Nenhuma sessão antes dessa data.">
              <input
                type="date"
                name="comeca_em"
                className={estiloInput}
                defaultValue={efetivos.repeticao !== "nenhuma" ? efetivos.inicio.slice(0, 10) : ""}
              />
            </Campo>
            <Campo rotulo="Repetir até (opcional)" className="tela-md:col-span-2">
              <input type="datetime-local" name="vigencia_fim" className={estiloInput} defaultValue={efetivos.vigenciaFim} />
            </Campo>
          </div>
        )}
      </div>

      <Interruptor
        name="usar_sala_espera"
        defaultChecked={efetivos.usarSalaEspera}
        rotulo="Usar sala de espera antes do início"
        descricao="Desligado num webinar com repetição, o conteúdo fica em fluxo contínuo."
      />

      <AvisoFormulario erro={estado.erro} ok={estado.ok ? "Agenda salva." : null} />
    </form>
  );
}
