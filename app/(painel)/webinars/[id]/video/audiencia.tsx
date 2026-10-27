"use client";
import { useState } from "react";
import { Campo, estiloInput, Segmentos } from "../../../_componentes/ui";
import { AvisoFormulario, Interruptor } from "../../_componentes/campos";
import { GraficoAudiencia } from "../../_componentes/grafico-audiencia";

type Modo = "oculto" | "fixo" | "dinamico";

export type ValoresAudiencia = { modo: Modo; minimo: string; maximo: string; seloAoVivo: boolean };

/** Campo numérico com o sufixo "Participantes" dentro. */
function CampoParticipantes({ rotulo, nome, valor, aoMudar, form }: { rotulo: string; nome: string; valor: string; aoMudar: (v: string) => void; form: string }) {
  return (
    <Campo rotulo={rotulo} obrigatorio>
      <span className="relative block">
        <input form={form} name={nome} inputMode="numeric" className={`${estiloInput} pr-28`} value={valor} onChange={(e) => aoMudar(e.target.value)} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-texto-3">Participantes</span>
      </span>
    </Campo>
  );
}

/**
 * Audiência exibida na sala, dentro do passo Vídeo (embaixo das tarjas de aviso). Fica fora do `<form>` do passo
 * (as tarjas no meio têm formulários próprios), mas os campos apontam pra ele pelo atributo `form`: o "Continuar"
 * salva o vídeo e a audiência juntos (`salvarVideoWebinar`).
 */
export function CamposAudiencia({ form, valores, erro, duracaoVideoSeg }: { form: string; valores: ValoresAudiencia; erro?: string; duracaoVideoSeg: number | null }) {
  const [modo, setModo] = useState(valores.modo);
  const [minimo, setMinimo] = useState(valores.minimo);
  const [maximo, setMaximo] = useState(valores.maximo);

  const min = Number(minimo) || 0;
  const max = Number(maximo) || 0;
  const temGrafico = modo !== "oculto" && max > 0 && (modo === "fixo" || min <= max);

  return (
    <section className="space-y-4 border-t border-linha pt-8">
      <h2 className="text-base font-semibold text-titulo">Audiência</h2>
      <div className="space-y-6">
        <div className="min-w-0 space-y-6">
          <input form={form} type="hidden" name="modo" value={modo} />
          <Campo rotulo="Audiência exibida na sala">
            <Segmentos
              opcoes={[
                { valor: "oculto", rotulo: "Não exibir audiência" },
                { valor: "fixo", rotulo: "Audiência fixa" },
                { valor: "dinamico", rotulo: "Audiência dinâmica" },
              ]}
              valor={modo}
              aoMudar={setModo}
            />
          </Campo>

          {modo === "fixo" && <CampoParticipantes form={form} rotulo="Número de participantes" nome="maximo" valor={maximo} aoMudar={setMaximo} />}

          {modo === "dinamico" && (
            <div className="grid gap-4 tela-md:grid-cols-2">
              <CampoParticipantes form={form} rotulo="Número mínimo" nome="minimo" valor={minimo} aoMudar={setMinimo} />
              <CampoParticipantes form={form} rotulo="Número máximo" nome="maximo" valor={maximo} aoMudar={setMaximo} />
            </div>
          )}

          <Interruptor form={form} name="selo_ao_vivo" defaultChecked={valores.seloAoVivo} rotulo="Mostrar botão ao vivo" descricao="O selo “Ao Vivo” no canto do vídeo." />

          <AvisoFormulario erro={erro} />
        </div>

        <div className="min-w-0">
          {temGrafico ? (
            <GraficoAudiencia audiencia={{ modo, minimo: modo === "fixo" ? max : min, maximo: max }} duracaoSeg={duracaoVideoSeg} />
          ) : (
            <div className="flex min-h-48 items-center justify-center rounded-lg border-2 border-dashed border-borda p-6 text-center text-sm text-texto-3">
              {modo === "oculto" ? "Com “Não exibir audiência”, a sala não mostra o contador." : "Preencha os números para simular a audiência."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
