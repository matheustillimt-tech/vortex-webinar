"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { formatarDuracao } from "@/src/lib/regras/video";
import { CampoSelecao, estiloAcao } from "../../../_componentes/ui";
import { AvisoFormulario, Interruptor, OpcoesCartao } from "../../_componentes/campos";
import { useEnvioPasso } from "../../_componentes/assistente";
import { PreviaSala, type MensagemPrevia } from "../../_componentes/previa-sala";
import { salvarVideoWebinar, type Resultado } from "./actions";
import { CamposAudiencia, type ValoresAudiencia } from "./audiencia";

type VideoOpcao = { id: string; nome: string; duracaoSeg: number | null; capa: string | null };
type Orientacao = "horizontal" | "vertical";

type Valores = { videoId: string; autoplay: boolean; telaCheia: boolean; orientacao: Orientacao };

/** Desenho dos cartões de formato (Webinar: vídeo + chat ao lado; Live: vídeo em pé com o selo AO VIVO). */
function IlustracaoFormato({ formato }: { formato: Orientacao }) {
  if (formato === "horizontal") {
    return (
      <span aria-hidden className="flex h-20 items-center justify-center gap-1.5 rounded-md bg-suave p-2">
        <span className="h-12 w-20 rounded bg-texto-2/80" />
        <span className="flex h-12 w-8 flex-col gap-1 rounded bg-white p-1">
          <span className="h-1 rounded bg-passo" />
          <span className="h-1 rounded bg-passo" />
          <span className="h-1 w-2/3 rounded bg-passo" />
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden className="flex h-20 items-center justify-center rounded-md bg-suave p-2">
      <span className="relative h-16 w-9 rounded bg-texto-2/80">
        <span className="absolute left-0.5 top-0.5 rounded-[1px] bg-marca px-0.5 text-[5px] font-bold leading-[7px] text-white">AO VIVO</span>
        <span className="absolute inset-x-1 bottom-1 space-y-0.5">
          <span className="block h-0.5 rounded bg-white/70" />
          <span className="block h-0.5 w-2/3 rounded bg-white/70" />
        </span>
      </span>
    </span>
  );
}

export function FormularioVideo({ idFormulario, webinarId, videos, valores, titulo, mensagens, publico, depois, audiencia, duracaoVideoSeg }: {
  idFormulario: string;
  webinarId: string;
  videos: VideoOpcao[];
  valores: Valores;
  titulo: string;
  mensagens: MensagemPrevia[];
  publico: number | null;
  /** Seções que salvam sozinhas (tarjas de aviso), embaixo do formulário do passo: fora do <form>, que não pode
   *  ter outro formulário dentro. */
  depois?: React.ReactNode;
  /** Audiência salva (seção embaixo das tarjas, salva junto com o vídeo pelo "Continuar"). */
  audiencia: ValoresAudiencia;
  duracaoVideoSeg: number | null;
}) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(salvarVideoWebinar.bind(null, webinarId), {});
  useEnvioPasso(enviando);
  // Se a última tentativa deu erro, usa o que a pessoa escolheu; senão, o que está salvo.
  const v = estado.valores;
  const efetivos: Valores = v
    ? {
        videoId: v.video_id ?? valores.videoId,
        autoplay: v.autoplay === "on",
        telaCheia: v.tela_cheia === "on",
        orientacao: (v.orientacao as Orientacao) ?? valores.orientacao,
      }
    : valores;
  const [orientacao, setOrientacao] = useState<Orientacao>(efetivos.orientacao);
  const [videoId, setVideoId] = useState(efetivos.videoId);
  // Remonta os campos (com os novos defaultValues) a cada tentativa, sem perder o que foi escolhido.
  const chaveTentativa = estado.erro ?? estado.erroAudiencia ?? "inicial";
  const audienciaEfetiva: ValoresAudiencia = v?.modo !== undefined
    ? { modo: v.modo as ValoresAudiencia["modo"], minimo: v.minimo ?? "", maximo: v.maximo ?? "", seloAoVivo: v.selo_ao_vivo === "on" }
    : audiencia;
  const escolhido = videos.find((x) => x.id === videoId) ?? null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 tela-slg:grid-cols-[minmax(0,1fr)_468px]">
      <div className="min-w-0 space-y-8">
        <form id={idFormulario} action={enviar} className="min-w-0 space-y-8" key={chaveTentativa}>
          <section className="space-y-4">
            <h2 className="text-base font-semibold text-titulo">Escolha aqui o vídeo do seu webinar</h2>
            <div className="flex items-start gap-4 max-tela-sm:flex-col">
              <span
                aria-hidden
                className="aspect-video w-40 shrink-0 rounded-md border border-linha bg-[#111827] bg-cover bg-center max-tela-sm:w-full"
                style={escolhido?.capa ? { backgroundImage: `url(${JSON.stringify(escolhido.capa)})` } : undefined}
              />
              <div className="w-full min-w-0 space-y-2">
                <CampoSelecao rotulo="Vídeo da biblioteca" name="video_id" value={videoId} onChange={(e) => setVideoId(e.target.value)} required>
                  <option value="" disabled>
                    Escolha um vídeo
                  </option>
                  {videos.map((vid) => (
                    <option key={vid.id} value={vid.id}>
                      {vid.nome}
                      {vid.duracaoSeg != null ? ` · ${formatarDuracao(vid.duracaoSeg)}` : ""}
                    </option>
                  ))}
                </CampoSelecao>
                <p className="text-xs text-texto-3">
                  Vídeo novo?{" "}
                  <Link href="/videos" className={estiloAcao.normal}>
                    Envie na biblioteca de Vídeos
                  </Link>{" "}
                  e volte aqui.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4 border-t border-linha pt-8">
            <h2 className="text-base font-semibold text-titulo">Formato do vídeo</h2>
            <OpcoesCartao
              nome="orientacao"
              colunas={2}
              valor={orientacao}
              aoMudar={setOrientacao}
              opcoes={[
                { valor: "horizontal", rotulo: "Webinar", descricao: "Vídeo com o chat ao lado (no celular, embaixo).", ilustracao: <IlustracaoFormato formato="horizontal" /> },
                { valor: "vertical", rotulo: "Live", descricao: "No celular o vídeo ocupa a tela e o chat fica por cima.", ilustracao: <IlustracaoFormato formato="vertical" /> },
              ]}
            />
          </section>

          <section className="space-y-4 border-t border-linha pt-8">
            <h2 className="text-base font-semibold text-titulo">Reprodução</h2>
            <Interruptor name="autoplay" defaultChecked={efetivos.autoplay} rotulo="Definir como auto play" descricao="O vídeo começa sozinho (mudo até a pessoa clicar)." />
            <Interruptor name="tela_cheia" defaultChecked={efetivos.telaCheia} rotulo="Habilitar fullscreen" descricao="Mostra o botão de tela cheia no player." />
          </section>

          <AvisoFormulario erro={estado.erro} ok={estado.ok ? "Vídeo salvo." : null} />
        </form>
        {depois}
        <CamposAudiencia key={`audiencia-${chaveTentativa}`} form={idFormulario} valores={audienciaEfetiva} erro={estado.erroAudiencia} duracaoVideoSeg={duracaoVideoSeg} />
      </div>

      <aside className="min-w-0 tela-slg:sticky tela-slg:top-4">
        <p className="mb-3 text-sm font-medium text-texto-2">Prévia da sala</p>
        <PreviaSala orientacao={orientacao} capa={escolhido?.capa ?? null} mensagens={mensagens} publico={publico} titulo={titulo} />
      </aside>
    </div>
  );
}
