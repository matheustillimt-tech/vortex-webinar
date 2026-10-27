import { estiloSegmento, estiloSegmentos } from "../../../_componentes/ui";
import { escolherTipoAgenda } from "./actions";

/** Topo do passo Webinar: abas segmentadas "Webinar único" × "Just in time" (salva `tipo_agenda` e troca de tela). */
export function TipoAgenda({ webinarId, jit }: { webinarId: string; jit: boolean }) {
  const opcoes = [
    { valor: "agenda", rotulo: "Webinar único", ativo: !jit },
    { valor: "jit", rotulo: "Just in time", ativo: jit },
  ];
  return (
    <form action={escolherTipoAgenda.bind(null, webinarId)} role="tablist" className={`${estiloSegmentos} max-tela-sm:flex max-tela-sm:w-full`}>
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="submit"
          name="tipo"
          value={o.valor}
          role="tab"
          aria-selected={o.ativo}
          className={`${estiloSegmento(o.ativo)} max-tela-sm:flex-1`}
        >
          {o.rotulo}
        </button>
      ))}
    </form>
  );
}
