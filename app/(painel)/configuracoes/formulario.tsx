"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "../_componentes/toast";
import { Botao, BotaoIcone, Campo, CampoTexto, estiloInput, estiloSelect } from "../_componentes/ui";
import { BotaoCopiar } from "../_componentes/copiar";
import { adicionarWebhook, removerWebhook, salvarCheckout, salvarFiltroWebhook, trocarWebinarWebhook, type Resultado } from "./actions";
import type { DadosPlataforma, ItemCheckout, ItemWebhook } from "./dados";

/** Segredo e liga/desliga da plataforma (página `checkouts/[plataforma]`). */
export function FormularioCheckout({ dados, item }: { dados: DadosPlataforma; item: ItemCheckout }) {
  const toast = useToast();
  const router = useRouter();
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(salvarCheckout.bind(null, dados.valor), {});

  useEffect(() => {
    if (estado.ok) {
      toast.sucesso("Checkout salvo.");
      router.refresh();
    } else if (estado.erro) toast.erro(estado.erro);
    // Só reage a um novo resultado da action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={enviar} className="max-w-2xl space-y-5">
      <label className="flex items-center gap-3 text-sm font-medium text-rotulo">
        <input type="checkbox" name="ligado" defaultChecked={item.ligado} className="size-4" />
        Receber vendas desta plataforma
      </label>
      <CampoTexto
        rotulo="Segredo do webhook"
        name="segredo"
        type="password"
        autoComplete="off"
        placeholder={item.temSegredo ? "Segredo salvo — deixe em branco para manter" : "Cole o segredo aqui"}
        dica={
          <>
            Cadastre só o evento <code className="rounded bg-suave px-1 text-texto-2">{dados.evento}</code> em {dados.ondeFicaSegredo}.
          </>
        }
      />
      {item.ligado && !item.temSegredo && (
        <p className="rounded-md border border-aviso/30 bg-aviso-fundo px-3 py-2 text-sm text-aviso">
          Ligado sem segredo: qualquer um com o link do webhook consegue registrar uma venda. Cadastre o segredo.
        </p>
      )}
      <Botao carregando={enviando}>Salvar</Botao>
    </form>
  );
}

/** Um webhook (uma URL por sala): copiar, trocar a sala, filtro de src/UTM e remover. */
function LinhaWebhook({ webinars, item, painelUrl }: { webinars: { id: string; nome: string }[]; item: ItemWebhook; painelUrl: string }) {
  const toast = useToast();
  const router = useRouter();
  const url = `${painelUrl}/api/checkout/${item.plataforma}/${item.token}`;

  async function rodar(fn: () => Promise<void>, sucesso: string) {
    try {
      await fn();
      toast.sucesso(sucesso);
      router.refresh();
    } catch {
      toast.erro("Não deu para salvar. Tente de novo.");
    }
  }

  async function remover() {
    if (!(await toast.confirmar({ descricao: "As vendas que chegarem nesta URL deixam de ser registradas.", confirmar: "Remover", perigo: true }))) return;
    const fd = new FormData();
    fd.set("id", item.id);
    await rodar(() => removerWebhook(fd), "Webhook removido.");
  }

  return (
    <li className="space-y-4 rounded-lg border border-borda p-4">
      <div className="flex items-end gap-2">
        <Campo rotulo="URL do webhook" className="min-w-0 flex-1">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={`${estiloInput} font-mono text-xs`} />
        </Campo>
        <BotaoCopiar texto={url} formato="botao" aviso="URL copiada!" />
        <BotaoIcone rotulo="Remover webhook" icone={Trash2} cor="perigo" onClick={() => void remover()} />
      </div>
      <div className="grid grid-cols-2 gap-4 max-tela-md:grid-cols-1">
        <form action={(fd) => rodar(() => trocarWebinarWebhook(item.id, fd), "Sala trocada.")} className="flex items-end gap-2">
          <Campo rotulo="Sala (webinar)" className="min-w-0 flex-1">
            <select name="webinar_id" defaultValue={item.webinarId} className={estiloSelect}>
              {webinars.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Botao variante="secundario">Trocar</Botao>
        </form>
        <form action={(fd) => rodar(() => salvarFiltroWebhook(item.id, fd), "Filtro salvo.")} className="flex items-end gap-2">
          <Campo rotulo="Filtro de src / UTM" info="Opcional. Só conta a venda se o src, o sck ou uma UTM tiver esse texto (ex.: webinar)." className="min-w-0 flex-1">
            <input name="filtro_src" className={estiloInput} defaultValue={item.filtroSrc ?? ""} placeholder="Ex.: webinar" />
          </Campo>
          <Botao variante="secundario">Salvar</Botao>
        </form>
      </div>
    </li>
  );
}

function NovoWebhook({ plataforma, webinars }: { plataforma: string; webinars: { id: string; nome: string }[] }) {
  const toast = useToast();
  const router = useRouter();
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(adicionarWebhook, {});
  const [webinar, setWebinar] = useState(webinars[0]?.id ?? "");

  useEffect(() => {
    if (estado.ok) {
      toast.sucesso("Webhook adicionado.", "Copie a URL e cadastre na plataforma.");
      router.refresh();
    } else if (estado.erro) toast.erro(estado.erro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={enviar} className="flex items-end gap-2 max-tela-sm:flex-col max-tela-sm:items-stretch">
      <input type="hidden" name="plataforma" value={plataforma} />
      <Campo rotulo="Nova URL para a sala" className="min-w-0 flex-1">
        <select name="webinar_id" value={webinar} onChange={(e) => setWebinar(e.target.value)} className={estiloSelect}>
          {webinars.map((w) => (
            <option key={w.id} value={w.id}>
              {w.nome}
            </option>
          ))}
        </select>
      </Campo>
      <Botao carregando={enviando} disabled={!webinar} icone={<Plus aria-hidden />}>
        Adicionar webhook
      </Botao>
    </form>
  );
}

export function ListaWebhooks({ plataforma, webinars, itens, painelUrl }: { plataforma: string; webinars: { id: string; nome: string }[]; itens: ItemWebhook[]; painelUrl: string }) {
  return (
    <div className="space-y-4">
      {itens.length > 0 ? (
        <ul className="space-y-3">
          {itens.map((item) => (
            <LinhaWebhook key={item.id} webinars={webinars} item={item} painelUrl={painelUrl} />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-borda px-4 py-6 text-center text-sm text-texto-3">Nenhum webhook ainda.</p>
      )}
      <NovoWebhook plataforma={plataforma} webinars={webinars} />
    </div>
  );
}
