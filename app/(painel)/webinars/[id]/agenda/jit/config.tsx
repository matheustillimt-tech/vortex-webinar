"use client";
import { useActionState } from "react";
import { Campo, estiloInput } from "../../../../_componentes/ui";
import { AvisoFormulario } from "../../../_componentes/campos";
import { useEnvioPasso } from "../../../_componentes/assistente";
import { salvarConfigJit, type Resultado } from "./actions";

export type ValoresConfigJit = { fuso: string; esconderDe: string; esconderAte: string; exibicao: string; fim: string };

const HORAS = Array.from({ length: 24 }, (_, i) => i);

export function ConfigJit({
  idFormulario,
  webinarId,
  valores,
  fusos,
  exibicoes,
}: {
  idFormulario: string;
  webinarId: string;
  valores: ValoresConfigJit;
  fusos: { valor: string; rotulo: string }[];
  exibicoes: { valor: string; rotulo: string }[];
}) {
  const [estado, salvar, salvando] = useActionState<Resultado, FormData>(salvarConfigJit.bind(null, webinarId), {});
  useEnvioPasso(salvando);
  const v = estado.valores;
  const e: ValoresConfigJit = v
    ? {
        fuso: v.fuso ?? valores.fuso,
        esconderDe: v.esconder_de ?? valores.esconderDe,
        esconderAte: v.esconder_ate ?? valores.esconderAte,
        exibicao: v.exibicao ?? valores.exibicao,
        fim: v.fim ?? valores.fim,
      }
    : valores;
  const chaveTentativa = estado.erro ?? "inicial";

  return (
    <form id={idFormulario} action={salvar} className="space-y-4" key={chaveTentativa}>
      <div className="grid gap-3 tela-md:grid-cols-2">
        <Campo rotulo="Fuso horário" dica="Vale para os horários, a madrugada escondida e a data final.">
          <select name="fuso" className={estiloInput} defaultValue={e.fuso}>
            <option value="participante">O fuso de cada participante (detectado no navegador)</option>
            {fusos.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Horários exibidos">
          <select name="exibicao" className={estiloInput} defaultValue={e.exibicao}>
            {exibicoes.map((x) => (
              <option key={x.valor} value={x.valor}>
                {x.rotulo}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <div className="grid gap-3 tela-md:grid-cols-3">
        <Campo rotulo="Esconder horários a partir de" dica="Deixe em branco para mostrar todos.">
          <select name="esconder_de" className={estiloInput} defaultValue={e.esconderDe}>
            <option value="">Não esconder</option>
            {HORAS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}h
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Até">
          <select name="esconder_ate" className={estiloInput} defaultValue={e.esconderAte}>
            <option value="">Não esconder</option>
            {HORAS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}h
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Data final (opcional)" dica="Depois dela, nenhum horário aparece.">
          <input type="datetime-local" name="fim" className={estiloInput} defaultValue={e.fim} />
        </Campo>
      </div>
      <AvisoFormulario erro={estado.erro} ok={estado.ok ? "Configuração salva." : null} />
    </form>
  );
}
