"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  CORES_TARJA,
  DURACAO_TARJA_MAX,
  DURACAO_TARJA_MIN,
  DURACAO_TARJA_PADRAO,
  ESTILO_COR_TARJA,
  formatarMomentoTarja,
  LIMITE_TARJAS,
  TEXTO_TARJA_MAX,
  type CorTarja,
  type PosicaoTarja,
} from "@/src/lib/regras/tarjas";
import { formatarDuracao } from "@/src/lib/regras/video";
import { Botao, Campo, estiloBotaoIcone, estiloInput } from "../../../_componentes/ui";
import { Modal } from "../../../_componentes/modal";
import { useToast } from "../../../_componentes/toast";
import { AvisoFormulario } from "../../_componentes/campos";
import { adicionarTarja, alternarTarja, editarTarja, excluirTarja, type Resultado } from "./actions";

export type ItemTarja = {
  id: string;
  texto: string;
  aparece_seg: number;
  duracao_seg: number;
  posicao: PosicaoTarja;
  cor: CorTarja;
  ligada: boolean;
};

type Valores = { texto: string; aparece: string; duracaoSeg: string; posicao: PosicaoTarja; cor: CorTarja };

const VAZIO: Valores = { texto: "", aparece: "0:00:02", duracaoSeg: String(DURACAO_TARJA_PADRAO), posicao: "topo", cor: "vermelho" };
const ROTULO_POSICAO: Record<PosicaoTarja, string> = { topo: "Topo", base: "Base" };

/** A tarja como aparece na sala, sobre um retângulo 16:9 com o selo AO VIVO (prévia do modal). */
function PreviaTarja({ texto, posicao, cor }: { texto: string; posicao: PosicaoTarja; cor: CorTarja }) {
  const estilo = ESTILO_COR_TARJA[cor];
  return (
    <div aria-hidden className="relative aspect-video w-full max-w-[400px] overflow-hidden rounded-md bg-[#111827]">
      <span className="absolute left-2 top-2 inline-flex h-4 items-center gap-1 rounded-[2px] bg-[#DC2626] px-1.5 text-[8px] font-semibold uppercase tracking-wide text-white">
        <span className="size-1 rounded-full bg-white" />
        Ao vivo
      </span>
      <span className="absolute inset-x-6 top-1/2 h-px bg-white/10" />
      <div
        className={`absolute inset-x-0 flex items-center justify-center gap-1.5 px-3 py-1.5 shadow-md ${posicao === "topo" ? "top-8" : "bottom-2"}`}
        style={{ backgroundColor: estilo.fundo, color: estilo.texto }}
      >
        <TriangleAlert size={14} strokeWidth={2.5} className="shrink-0" />
        <p className="line-clamp-2 text-center text-xs font-bold leading-tight break-words">{texto || "Nós vamos fechar a sala, não saia dela!"}</p>
      </div>
    </div>
  );
}

/** Formulário do modal (criar ou editar). Os campos de posição e cor são controlados pra prévia acompanhar. */
function FormularioTarja({
  action,
  valores,
  duracaoVideoSeg,
  editando,
  aoSalvar,
  aoCancelar,
  aoEnviar,
}: {
  action: (prev: Resultado, form: FormData) => Promise<Resultado>;
  valores: Valores;
  duracaoVideoSeg: number | null;
  editando: boolean;
  aoSalvar: () => void;
  aoCancelar: () => void;
  aoEnviar: (enviando: boolean) => void;
}) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(action, {});
  const v = estado.valores;
  const [texto, setTexto] = useState(v?.texto ?? valores.texto);
  const [posicao, setPosicao] = useState<PosicaoTarja>(valores.posicao);
  const [cor, setCor] = useState<CorTarja>(valores.cor);

  useEffect(() => aoEnviar(enviando), [enviando, aoEnviar]);
  useEffect(() => {
    if (estado.ok) aoSalvar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  // O React limpa o formulário depois da action: remonta a cada tentativa com o que a pessoa digitou (texto, posição
  // e cor ficam no estado deste componente, fora do <form>).
  const chaveTentativa = estado.erro ?? "inicial";

  return (
    <form action={enviar} className="space-y-4" key={chaveTentativa}>
      <Campo rotulo="Texto da tarja" obrigatorio contador={`${texto.length}/${TEXTO_TARJA_MAX}`}>
        <input
          name="texto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={TEXTO_TARJA_MAX}
          placeholder="Nós vamos fechar a sala, não saia dela!"
          className={estiloInput}
          autoFocus
        />
      </Campo>
      <div className="grid gap-4 tela-sm:grid-cols-2">
        <Campo
          rotulo="Aparece em"
          obrigatorio
          dica={duracaoVideoSeg ? `h:mm:ss do vídeo (ele tem ${formatarDuracao(duracaoVideoSeg)})` : "h:mm:ss do vídeo"}
          info="O vídeo de cada pessoa começa quando ela entra: 0:00:02 aparece 2 segundos depois que ela entra."
        >
          <input name="aparece" defaultValue={v?.aparece ?? valores.aparece} placeholder="0:00:02" className={estiloInput} inputMode="numeric" />
        </Campo>
        <Campo rotulo="Duração (segundos)" dica={`De ${DURACAO_TARJA_MIN} a ${DURACAO_TARJA_MAX}.`}>
          <input
            name="duracao_seg"
            type="number"
            min={DURACAO_TARJA_MIN}
            max={DURACAO_TARJA_MAX}
            defaultValue={v?.duracao_seg ?? valores.duracaoSeg}
            className={estiloInput}
          />
        </Campo>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none text-rotulo">Posição</legend>
        <div role="radiogroup" className="inline-flex h-9 items-center rounded-md bg-suave p-1 text-texto-3">
          {(["topo", "base"] as const).map((p) => (
            <label
              key={p}
              className={`inline-flex h-7 cursor-pointer items-center rounded-sm px-4 text-sm font-medium transition-colors has-focus-visible:ring-2 has-focus-visible:ring-marca/40 ${posicao === p ? "bg-superficie text-texto shadow-sm" : "hover:text-texto"}`}
            >
              <input type="radio" name="posicao" value={p} checked={posicao === p} onChange={() => setPosicao(p)} className="sr-only" />
              {ROTULO_POSICAO[p]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none text-rotulo">Cor</legend>
        <div role="radiogroup" className="flex flex-wrap gap-2">
          {CORES_TARJA.map((c) => {
            const ativo = cor === c;
            return (
              <label
                key={c}
                className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-marca/40 ${ativo ? "border-marca bg-marca-linha ring-1 ring-marca" : "border-borda bg-superficie hover:bg-suave"}`}
              >
                <input type="radio" name="cor" value={c} checked={ativo} onChange={() => setCor(c)} className="sr-only" />
                <span aria-hidden className="size-4 rounded-full border border-black/10" style={{ backgroundColor: ESTILO_COR_TARJA[c].fundo }} />
                {ESTILO_COR_TARJA[c].rotulo}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-2">
        <p className="text-sm font-medium leading-none text-rotulo">Prévia</p>
        <PreviaTarja texto={texto.trim()} posicao={posicao} cor={cor} />
      </div>

      <AvisoFormulario erro={estado.erro} />
      <div className="flex flex-col-reverse gap-2 tela-sm:flex-row tela-sm:justify-end">
        <Botao type="button" variante="secundario" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Botao>
        <Botao carregando={enviando}>{enviando ? "Salvando…" : editando ? "Salvar alterações" : "Adicionar tarja"}</Botao>
      </div>
    </form>
  );
}

/** Interruptor da linha: envia o formulário de liga/desliga na hora. */
function BotaoLigada({ ligada, texto }: { ligada: boolean; texto: string }) {
  const { pending } = useFormStatus();
  const valor = pending ? !ligada : ligada;
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={valor}
      aria-label={`${ligada ? "Desligar" : "Ligar"} a tarja “${texto}”`}
      title={ligada ? "Desligar" : "Ligar"}
      disabled={pending}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40 disabled:opacity-70 ${valor ? "bg-marca" : "bg-passo"}`}
    >
      <span aria-hidden className={`absolute left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${valor ? "translate-x-5" : ""}`} />
    </button>
  );
}

function BotaoExcluir({ rotulo, aoClicar }: { rotulo: string; aoClicar: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button type="button" onClick={aoClicar} disabled={pending} className={estiloBotaoIcone("quadrado", "perigo")} aria-label={rotulo} title="Excluir">
      <Trash2 size={16} aria-hidden />
    </button>
  );
}

function ExcluirTarja({ webinarId, item }: { webinarId: string; item: ItemTarja }) {
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={excluirTarja.bind(null, webinarId)}>
      <input type="hidden" name="id" value={item.id} />
      <BotaoExcluir
        rotulo={`Excluir a tarja “${item.texto}”`}
        aoClicar={async () => {
          if (await toast.confirmar({ descricao: `Excluir a tarja “${item.texto}”?`, perigo: true })) form.current?.requestSubmit();
        }}
      />
    </form>
  );
}

/** Seção "Tarjas de aviso" do passo Vídeo: lista + modal de criar/editar. Cada ação salva na hora; o "Continuar"
 *  do rodapé não mexe aqui. */
export function TarjasAviso({ webinarId, itens, duracaoVideoSeg }: { webinarId: string; itens: ItemTarja[]; duracaoVideoSeg: number | null }) {
  const toast = useToast();
  const [modal, setModal] = useState<{ item: ItemTarja | null; versao: number } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const versaoRef = useRef(0);
  const cheio = itens.length >= LIMITE_TARJAS;

  function abrir(item: ItemTarja | null) {
    versaoRef.current += 1;
    setModal({ item, versao: versaoRef.current });
  }

  const editando = modal?.item ?? null;

  return (
    <section className="space-y-4 border-t border-linha pt-8" aria-labelledby="titulo-tarjas">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id="titulo-tarjas" className="text-base font-semibold text-titulo">
            Tarjas de aviso
          </h2>
          <p className="max-w-prose text-sm text-texto-3">
            Faixa por cima do vídeo com um aviso que segura a pessoa na sala (ex.: “Nós vamos fechar a sala, não saia dela!”). O tempo conta do
            momento em que cada pessoa entra.
          </p>
        </div>
        <Botao type="button" variante="secundario" icone={<Plus aria-hidden />} onClick={() => abrir(null)} disabled={cheio} title={cheio ? `Limite de ${LIMITE_TARJAS} tarjas` : undefined}>
          Adicionar tarja
        </Botao>
      </div>

      {itens.length === 0 ? (
        <p className="rounded-lg border border-dashed border-borda px-4 py-6 text-center text-sm text-texto-3">Nenhuma tarja ainda.</p>
      ) : (
        <ul className="divide-y divide-linha rounded-lg border border-borda bg-superficie">
          {itens.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3 max-tela-sm:flex-wrap">
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-md"
                style={{ backgroundColor: ESTILO_COR_TARJA[item.cor].fundo, color: ESTILO_COR_TARJA[item.cor].texto }}
              >
                <TriangleAlert size={16} strokeWidth={2.5} />
              </span>
              <div className={`min-w-0 flex-1 ${item.ligada ? "" : "opacity-60"}`}>
                <p className="line-clamp-2 text-sm font-medium text-texto">{item.texto}</p>
                <p className="mt-0.5 text-xs text-texto-3">
                  <span className="tabular-nums">{formatarMomentoTarja(item.aparece_seg)}</span> · <span className="tabular-nums">{item.duracao_seg}s</span> ·{" "}
                  {ROTULO_POSICAO[item.posicao]} · {ESTILO_COR_TARJA[item.cor].rotulo}
                  {!item.ligada && " · Desligada"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 max-tela-sm:ml-11">
                <form action={alternarTarja.bind(null, webinarId)} className="mr-1 flex">
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="ligada" value={item.ligada ? "1" : "0"} />
                  <BotaoLigada ligada={item.ligada} texto={item.texto} />
                </form>
                <button type="button" className={estiloBotaoIcone("quadrado", "marca")} aria-label={`Editar a tarja “${item.texto}”`} title="Editar" onClick={() => abrir(item)}>
                  <Pencil size={16} aria-hidden />
                </button>
                <ExcluirTarja webinarId={webinarId} item={item} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {cheio && <p className="text-xs text-texto-3">Limite de {LIMITE_TARJAS} tarjas por webinar.</p>}

      <Modal
        aberto={modal !== null}
        aoFechar={() => setModal(null)}
        travado={salvando}
        largura="lg"
        titulo={editando ? "Editar tarja" : "Adicionar tarja"}
        descricao="A tarja aparece por cima do vídeo, no momento escolhido, durante a duração escolhida."
      >
        {modal && (
          <FormularioTarja
            key={modal.versao}
            action={editando ? editarTarja.bind(null, webinarId, editando.id) : adicionarTarja.bind(null, webinarId)}
            valores={
              editando
                ? {
                    texto: editando.texto,
                    aparece: formatarMomentoTarja(editando.aparece_seg),
                    duracaoSeg: String(editando.duracao_seg),
                    posicao: editando.posicao,
                    cor: editando.cor,
                  }
                : VAZIO
            }
            duracaoVideoSeg={duracaoVideoSeg}
            editando={!!editando}
            aoEnviar={setSalvando}
            aoSalvar={() => {
              toast.sucesso(editando ? "Tarja salva." : "Tarja adicionada.");
              setSalvando(false);
              setModal(null);
            }}
            aoCancelar={() => setModal(null)}
          />
        )}
      </Modal>
    </section>
  );
}
