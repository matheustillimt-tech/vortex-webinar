"use client";
import { useActionState, useState } from "react";
import { Botao, Campo, estiloAcao, estiloInput } from "../../../../_componentes/ui";
import { adicionarHorarioJit, excluirHorarioJit, type Resultado } from "./actions";

export type ItemHorario = { id: string; descricao: string };

const QUANDOS = [
  { valor: "todo_dia", rotulo: "Todo dia" },
  { valor: "a_cada", rotulo: "A cada" },
  { valor: "data", rotulo: "Data selecionada" },
  { valor: "dia_semana", rotulo: "Dia da semana" },
] as const;
type Quando = (typeof QUANDOS)[number]["valor"];

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function LinhaHorario({ webinarId, item }: { webinarId: string; item: ItemHorario }) {
  const [estado, excluir, excluindo] = useActionState<Resultado, FormData>(excluirHorarioJit.bind(null, webinarId), {});
  return (
    <li className="rounded-lg border border-vg-line p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-vg-text">{item.descricao}</span>
        <form action={excluir}>
          <input type="hidden" name="id" value={item.id} />
          <button type="submit" disabled={excluindo} className={estiloAcao.perigo}>
            {excluindo ? "Excluindo…" : "Excluir"}
          </button>
        </form>
      </div>
      {estado.erro && <p className="mt-2 text-sm text-vg-erro">{estado.erro}</p>}
    </li>
  );
}

export function HorariosJit({ webinarId, itens, max }: { webinarId: string; itens: ItemHorario[]; max: number }) {
  const [estado, adicionar, adicionando] = useActionState<Resultado, FormData>(adicionarHorarioJit.bind(null, webinarId), {});
  const v = estado.valores ?? {};
  const [quando, setQuando] = useState<Quando>((v.quando as Quando) ?? "todo_dia");
  const chaveTentativa = estado.erro ?? (estado.ok ? `ok-${itens.length}` : "inicial");

  return (
    <div className="space-y-4">
      {itens.length === 0 ? (
        <p className="text-sm text-vg-muted">Nenhum horário ainda. Adicione pelo menos um para a página de inscrição funcionar.</p>
      ) : (
        <ul className="space-y-2">
          {itens.map((item) => (
            <LinhaHorario key={item.id} webinarId={webinarId} item={item} />
          ))}
        </ul>
      )}

      {itens.length < max ? (
        <form action={adicionar} className="space-y-3 rounded-lg border border-vg-line p-3" key={chaveTentativa}>
          <div className="grid gap-3 tela-md:grid-cols-3">
            <Campo rotulo="Escolha quando">
              <select name="quando" className={estiloInput} value={quando} onChange={(e) => setQuando(e.target.value as Quando)}>
                {QUANDOS.map((q) => (
                  <option key={q.valor} value={q.valor}>
                    {q.rotulo}
                  </option>
                ))}
              </select>
            </Campo>
            {quando === "a_cada" && (
              <Campo rotulo="Intervalo">
                <select name="intervalo_min" className={estiloInput} defaultValue={v.intervalo_min ?? "30"}>
                  {[15, 30, 45, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} minutos
                    </option>
                  ))}
                </select>
              </Campo>
            )}
            {quando === "data" && (
              <Campo rotulo="Data e hora" dica="No fuso da configuração abaixo.">
                <input type="datetime-local" name="data" className={estiloInput} defaultValue={v.data ?? ""} />
              </Campo>
            )}
            {quando === "dia_semana" && (
              <Campo rotulo="Dia da semana">
                <select name="dia_semana" className={estiloInput} defaultValue={v.dia_semana ?? "1"}>
                  {DIAS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </Campo>
            )}
            {(quando === "todo_dia" || quando === "dia_semana") && (
              <Campo rotulo="Hora">
                <input type="time" name="hora" className={estiloInput} defaultValue={v.hora ?? "19:00"} />
              </Campo>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Botao disabled={adicionando}>{adicionando ? "Adicionando…" : "Adicionar horário"}</Botao>
            {estado.erro && <p className="text-sm text-vg-erro">{estado.erro}</p>}
            {estado.ok && <p className="text-sm text-vg-ok">Horário adicionado.</p>}
          </div>
        </form>
      ) : (
        <p className="text-sm text-vg-muted">Você chegou ao máximo de {max} horários.</p>
      )}
    </div>
  );
}
