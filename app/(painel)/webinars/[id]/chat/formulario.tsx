"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { FileDown, FileSpreadsheet, Pencil, PlayCircle, Search, Trash2 } from "lucide-react";
import { ERRO_LIMITE_BYTES_PLANILHA, LIMITE_BYTES_PLANILHA } from "@/src/lib/regras/planilha";
import { Botao, Campo, estiloAcao, estiloBotao, estiloBotaoIcone, estiloInput, estiloTextarea } from "../../../_componentes/ui";
import { BotaoEnvio } from "../../../_componentes/botao-envio";
import { useToast } from "../../../_componentes/toast";
import { Interruptor } from "../../_componentes/campos";
import { LinhaChat } from "../../_componentes/previa-sala";
import { adicionarMensagem, apagarChat, editarMensagem, excluirMensagem, importarMensagens, type Resultado, type ResultadoImportacao } from "./actions";
import type { ItemMensagem } from "./page";

type Valores = { momento: string; nome: string; texto: string; suporte: boolean };

const VAZIO: Valores = { momento: "", nome: "", texto: "", suporte: false };

/** Formulário de uma mensagem (criar ou editar). Depois de criar, limpa os campos (remonta com uma chave nova). */
function FormularioItem({
  action,
  valores,
  rotuloBotao,
  aoSalvar,
  aoCancelar,
  compacto = false,
}: {
  action: (prev: Resultado, form: FormData) => Promise<Resultado>;
  valores: Valores;
  rotuloBotao: string;
  aoSalvar?: () => void;
  aoCancelar?: () => void;
  compacto?: boolean;
}) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(action, {});
  const [salvos, setSalvos] = useState(0);
  const v = estado.valores;
  const efetivos: Valores = v
    ? { momento: v.momento ?? valores.momento, nome: v.nome ?? valores.nome, texto: v.texto ?? valores.texto, suporte: v.suporte === "on" }
    : valores;
  const chaveTentativa = estado.erro ?? `ok-${salvos}`;

  useEffect(() => {
    if (!estado.ok) return;
    setSalvos((n) => n + 1);
    aoSalvar?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={enviar} className="space-y-3" key={chaveTentativa}>
      <div className={`grid gap-3 ${compacto ? "grid-cols-[100px_1fr]" : "tela-md:grid-cols-[140px_1fr]"}`}>
        <Campo rotulo="Hora de envio" dica={compacto ? undefined : "h:mm:ss do vídeo"}>
          <input name="momento" className={estiloInput} defaultValue={efetivos.momento} placeholder="0:05" />
        </Campo>
        <Campo rotulo="Nome do usuário">
          <input name="nome" className={estiloInput} defaultValue={efetivos.nome} maxLength={60} />
        </Campo>
      </div>
      <Campo rotulo="Mensagem">
        <textarea name="texto" className={estiloTextarea} rows={2} defaultValue={efetivos.texto} maxLength={400} />
      </Campo>
      <Interruptor name="suporte" defaultChecked={efetivos.suporte} rotulo="Enviar mensagem como suporte" />
      <div className="flex flex-wrap items-center gap-3">
        <Botao disabled={enviando} tamanho={compacto ? "pequeno" : "padrao"}>{enviando ? "Salvando…" : rotuloBotao}</Botao>
        {aoCancelar && (
          <button type="button" onClick={aoCancelar} className={estiloAcao.neutro}>
            Cancelar
          </button>
        )}
        {estado.erro && <p className="text-sm text-erro">{estado.erro}</p>}
      </div>
    </form>
  );
}

/** Mensagem na prévia do chat: como aparece na sala, com editar/excluir à direita. */
function LinhaMensagem({ webinarId, item }: { webinarId: string; item: ItemMensagem }) {
  const [editando, setEditando] = useState(false);
  const excluirAction = excluirMensagem.bind(null, webinarId);

  if (editando) {
    return (
      <li className="rounded-md border border-borda bg-superficie p-3">
        <FormularioItem
          compacto
          action={editarMensagem.bind(null, webinarId, item.id)}
          valores={{ momento: item.momento, nome: item.nome, texto: item.texto, suporte: item.suporte }}
          rotuloBotao="Salvar"
          aoSalvar={() => setEditando(false)}
          aoCancelar={() => setEditando(false)}
        />
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-1 rounded-md hover:bg-suave/60">
      <div className="min-w-0 flex-1">
        <LinhaChat m={{ nome: item.nome, texto: item.texto, suporte: item.suporte, momento: item.momento }} />
      </div>
      <div className="flex shrink-0 items-center opacity-70 transition-opacity group-hover:opacity-100">
        <button type="button" onClick={() => setEditando(true)} className={estiloBotaoIcone("quadrado", "marca")} aria-label={`Editar mensagem de ${item.nome}`} title="Editar">
          <Pencil size={16} aria-hidden />
        </button>
        <form action={excluirAction}>
          <input type="hidden" name="id" value={item.id} />
          <BotaoEnvio className={estiloBotaoIcone("quadrado", "perigo")} pendente="…" aria-label={`Excluir mensagem de ${item.nome}`} title="Excluir">
            <Trash2 size={16} aria-hidden />
          </BotaoEnvio>
        </form>
      </div>
    </li>
  );
}

function ImportarPlanilha({ webinarId }: { webinarId: string }) {
  const [estado, enviar, enviando] = useActionState<ResultadoImportacao, FormData>(importarMensagens.bind(null, webinarId), {});
  const [erroCliente, setErroCliente] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado.importadas !== undefined) formRef.current?.reset();
  }, [estado.importadas]);

  // Confere o tamanho antes de mandar pro servidor: evita subir um arquivo grande só pra levar o mesmo erro de volta.
  function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    const arquivo = (e.currentTarget.elements.namedItem("arquivo") as HTMLInputElement | null)?.files?.[0];
    if (arquivo && arquivo.size > LIMITE_BYTES_PLANILHA) {
      e.preventDefault();
      setErroCliente(ERRO_LIMITE_BYTES_PLANILHA);
      return;
    }
    setErroCliente(null);
  }

  return (
    <form ref={formRef} action={enviar} onSubmit={aoEnviar} className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-borda bg-fundo px-4 py-6 text-center transition-colors hover:border-marca">
        <FileSpreadsheet size={24} aria-hidden className="text-marca" />
        <span className="text-sm font-medium text-texto">Escolha a planilha (.xlsx)</span>
        <span className="text-xs text-texto-3">Até 5000 mensagens e 4 MB. Acrescenta às existentes, não apaga.</span>
        <input type="file" name="arquivo" accept=".xlsx" required className={`${estiloInput} mt-1 max-w-xs`} onChange={() => setErroCliente(null)} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Botao variante="secundario" disabled={enviando}>
          {enviando ? "Importando…" : "Importar planilha"}
        </Botao>
        <a href={`/api/webinars/${webinarId}/chat.xlsx?modelo=1`} className={estiloAcao.normal}>
          Baixar planilha modelo
        </a>
      </div>
      {erroCliente && <p className="text-sm text-erro">{erroCliente}</p>}
      {!erroCliente && estado.erro && <p className="text-sm text-erro">{estado.erro}</p>}
      {!erroCliente && estado.erros && (
        <ul className="list-inside list-disc text-sm text-erro">
          {estado.erros.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {!erroCliente && estado.importadas !== undefined && <p className="text-sm text-ok">{estado.importadas} mensagens importadas.</p>}
    </form>
  );
}

function BotaoApagarChat({ webinarId }: { webinarId: string }) {
  const toast = useToast();
  const router = useRouter();
  const [processando, setProcessando] = useState(false);

  async function apagar() {
    if (!(await toast.confirmar({ titulo: "Excluir todo o chat?", descricao: "Apaga todas as mensagens simuladas deste webinar. Essa ação não pode ser desfeita.", confirmar: "Excluir", perigo: true }))) return;
    setProcessando(true);
    const r = await apagarChat(webinarId);
    setProcessando(false);
    if (r.erro) {
      toast.erro(r.erro);
      return;
    }
    toast.sucesso("Chat excluído.");
    router.refresh();
  }

  return (
    <Botao type="button" variante="secundario" tamanho="pequeno" className="text-erro" onClick={apagar} carregando={processando} icone={<Trash2 aria-hidden />}>
      Excluir todo o chat
    </Botao>
  );
}

/** Passo Chat: à esquerda a automação com IA, a planilha e a mensagem individual; à direita a prévia
 *  do chat (busca, editar/excluir, exportar, excluir tudo e "Testar no player"). Cada ação salva na hora. */
export function PainelChat({ webinarId, itens, total, limite, urlTeste, geracao }: {
  webinarId: string;
  itens: ItemMensagem[];
  total: number;
  limite: number;
  urlTeste: string;
  geracao: React.ReactNode;
}) {
  const [busca, setBusca] = useState("");
  const filtrados = useMemo(() => {
    const t = busca.trim().toLocaleLowerCase("pt-BR");
    if (!t) return itens;
    return itens.filter((i) => `${i.nome} ${i.texto} ${i.momento}`.toLocaleLowerCase("pt-BR").includes(t));
  }, [busca, itens]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 tela-slg:grid-cols-[minmax(0,1fr)_504px]">
      <div className="min-w-0 space-y-8">
        <section>{geracao}</section>

        <section className="space-y-4 border-t border-linha pt-8">
          <h2 className="text-base font-semibold text-titulo">Crie o chat via arquivo</h2>
          <ImportarPlanilha webinarId={webinarId} />
        </section>

        <section className="space-y-4 border-t border-linha pt-8">
          <h2 className="text-base font-semibold text-titulo">Crie o chat individual</h2>
          <FormularioItem action={adicionarMensagem.bind(null, webinarId)} valores={VAZIO} rotuloBotao="Adicionar mensagem" />
        </section>
      </div>

      <aside className="min-w-0 rounded-lg border border-borda tela-slg:sticky tela-slg:top-4">
        <div className="space-y-3 border-b border-linha p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-titulo">Prévia do chat</h2>
            <span className="text-sm text-texto-3">{total} mensagens</span>
          </div>
          <div className="relative">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-apagado" />
            <input type="search" aria-label="Buscar no chat" placeholder="Buscar mensagem ou nome" value={busca} onChange={(e) => setBusca(e.target.value)} className={`${estiloInput} pl-9`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={urlTeste} target="_blank" rel="noreferrer" className={estiloBotao("principal", "pequeno")}>
              <PlayCircle aria-hidden /> Testar no player
            </a>
            <a href={`/api/webinars/${webinarId}/chat.xlsx`} className={estiloBotao("secundario", "pequeno")}>
              <FileDown aria-hidden /> Exportar XLSX
            </a>
            {itens.length > 0 && <BotaoApagarChat webinarId={webinarId} />}
          </div>
        </div>
        <div className="max-h-[560px] overflow-y-auto bg-white p-3">
          {itens.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-texto-3">Nenhuma mensagem ainda. Gere com IA, importe a planilha ou crie uma a uma.</p>
          ) : filtrados.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-texto-3">Sem resultados.</p>
          ) : (
            <ul className="space-y-1">
              {filtrados.map((item) => (
                <LinhaMensagem key={item.id} webinarId={webinarId} item={item} />
              ))}
            </ul>
          )}
        </div>
        {total > limite && (
          <p className="border-t border-linha px-4 py-2 text-xs text-texto-3">
            Mostrando as {limite} primeiras de {total}. Exporte a planilha para ver todas.
          </p>
        )}
      </aside>
    </div>
  );
}
