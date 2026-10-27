"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { FileDown, FileSpreadsheet, Pencil, Search, Trash2 } from "lucide-react";
import { ERRO_LIMITE_BYTES_PLANILHA, LIMITE_BYTES_PLANILHA } from "@/src/lib/regras/planilha";
import { Botao, Campo, estiloAcao, estiloBotao, estiloBotaoIcone, estiloInput } from "../../../_componentes/ui";
import { BotaoEnvio } from "../../../_componentes/botao-envio";
import { AvisoFormulario } from "../../_componentes/campos";
import { useEnvioPasso } from "../../_componentes/assistente";
import { LinhaVenda as LinhaVendaPrevia } from "../../_componentes/previa-sala";
import {
  adicionarVenda,
  apagarVendas,
  editarVenda,
  excluirVenda,
  importarVendas,
  salvarTituloNotificacaoCompra,
  type Resultado,
  type ResultadoImportacao,
} from "./actions";
import type { ItemVenda } from "./page";
import { useToast } from "../../../_componentes/toast";

type Valores = { momento: string; texto: string };

const VAZIO: Valores = { momento: "", texto: "" };

/** Formulário principal do passo (o "Continuar" salva): título da notificação de compra. Controlado de fora, pra a
 *  prévia mostrar o título enquanto a pessoa digita. */
function FormularioTitulo({ idFormulario, webinarId, titulo, aoMudar }: { idFormulario: string; webinarId: string; titulo: string; aoMudar: (v: string) => void }) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(salvarTituloNotificacaoCompra.bind(null, webinarId), {});
  useEnvioPasso(enviando);

  return (
    <form id={idFormulario} action={enviar} className="space-y-3">
      <Campo rotulo="Título da notificação de compra" dica="Aparece em cima de cada venda, no chat da sala." contador={`${titulo.length} de 150`}>
        <input name="titulo_notificacao_compra" className={estiloInput} value={titulo} onChange={(e) => aoMudar(e.target.value)} maxLength={150} placeholder="Venda confirmada!" />
      </Campo>
      <AvisoFormulario erro={estado.erro} ok={estado.ok ? "Título salvo." : null} />
    </form>
  );
}

function FormularioItem({
  action,
  valores,
  rotuloBotao,
  aoSalvar,
  aoCancelar,
}: {
  action: (prev: Resultado, form: FormData) => Promise<Resultado>;
  valores: Valores;
  rotuloBotao: string;
  aoSalvar?: () => void;
  aoCancelar?: () => void;
}) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(action, {});
  const [salvos, setSalvos] = useState(0);
  const v = estado.valores;
  const efetivos: Valores = v ? { momento: v.momento ?? valores.momento, texto: v.texto ?? valores.texto } : valores;
  const chaveTentativa = estado.erro ?? `ok-${salvos}`;

  useEffect(() => {
    if (!estado.ok) return;
    setSalvos((n) => n + 1);
    aoSalvar?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={enviar} className="space-y-3" key={chaveTentativa}>
      <div className="grid gap-3 tela-md:grid-cols-[140px_1fr]">
        <Campo rotulo="Hora de envio" dica="h:mm:ss do vídeo">
          <input name="momento" className={estiloInput} defaultValue={efetivos.momento} placeholder="0:30" />
        </Campo>
        <Campo rotulo="Mensagem" dica="Ex.: Maria, de Recife, acabou de comprar!">
          <input name="texto" className={estiloInput} defaultValue={efetivos.texto} maxLength={200} />
        </Campo>
      </div>
      <div className="flex items-center gap-3">
        <Botao disabled={enviando}>{enviando ? "Salvando…" : rotuloBotao}</Botao>
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

function LinhaVenda({ webinarId, item, titulo }: { webinarId: string; item: ItemVenda; titulo: string }) {
  const [editando, setEditando] = useState(false);
  const excluirAction = excluirVenda.bind(null, webinarId);

  if (editando) {
    return (
      <li className="rounded-md border border-borda bg-superficie p-3">
        <FormularioItem
          action={editarVenda.bind(null, webinarId, item.id)}
          valores={{ momento: item.momento, texto: item.texto }}
          rotuloBotao="Salvar"
          aoSalvar={() => setEditando(false)}
          aoCancelar={() => setEditando(false)}
        />
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <LinhaVendaPrevia titulo={titulo || "Venda confirmada!"} texto={item.texto} momento={item.momento} />
      </div>
      <div className="flex shrink-0 items-center opacity-70 transition-opacity group-hover:opacity-100">
        <button type="button" onClick={() => setEditando(true)} className={estiloBotaoIcone("quadrado", "marca")} aria-label="Editar venda" title="Editar">
          <Pencil size={16} aria-hidden />
        </button>
        <form action={excluirAction}>
          <input type="hidden" name="id" value={item.id} />
          <BotaoEnvio className={estiloBotaoIcone("quadrado", "perigo")} pendente="…" aria-label="Excluir venda" title="Excluir">
            <Trash2 size={16} aria-hidden />
          </BotaoEnvio>
        </form>
      </div>
    </li>
  );
}

function ImportarPlanilha({ webinarId }: { webinarId: string }) {
  const [estado, enviar, enviando] = useActionState<ResultadoImportacao, FormData>(importarVendas.bind(null, webinarId), {});
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
        <span className="text-xs text-texto-3">Até 4 MB. Acrescenta às vendas existentes, não apaga.</span>
        <input type="file" name="arquivo" accept=".xlsx" required className={`${estiloInput} mt-1 max-w-xs`} onChange={() => setErroCliente(null)} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Botao variante="secundario" disabled={enviando}>
          {enviando ? "Importando…" : "Importar planilha"}
        </Botao>
        <a href={`/api/webinars/${webinarId}/vendas.xlsx?modelo=1`} className={estiloAcao.normal}>
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
      {!erroCliente && estado.importadas !== undefined && <p className="text-sm text-ok">{estado.importadas} vendas importadas</p>}
    </form>
  );
}

function BotaoApagarVendas({ webinarId }: { webinarId: string }) {
  const toast = useToast();
  const router = useRouter();
  const [processando, setProcessando] = useState(false);

  async function apagar() {
    if (!(await toast.confirmar({ titulo: "Excluir todas as vendas simuladas?", descricao: "Essa ação não pode ser desfeita.", confirmar: "Excluir", perigo: true }))) return;
    setProcessando(true);
    const r = await apagarVendas(webinarId);
    setProcessando(false);
    if (r.erro) {
      toast.erro(r.erro);
      return;
    }
    toast.sucesso("Vendas excluídas.");
    router.refresh();
  }

  return (
    <Botao type="button" variante="secundario" tamanho="pequeno" className="text-erro" onClick={apagar} carregando={processando} icone={<Trash2 aria-hidden />}>
      Excluir todas
    </Botao>
  );
}

/** Passo Vendas: título da notificação (salvo pelo "Continuar"), planilha e venda individual à
 *  esquerda; prévia das vendas como aparecem no chat da sala à direita. As ações da lista salvam na hora. */
export function PainelVendas({ idFormulario, webinarId, titulo: tituloInicial, itens, total, limite }: {
  idFormulario: string;
  webinarId: string;
  titulo: string;
  itens: ItemVenda[];
  total: number;
  limite: number;
}) {
  const [titulo, setTitulo] = useState(tituloInicial);
  const [busca, setBusca] = useState("");
  const filtrados = useMemo(() => {
    const t = busca.trim().toLocaleLowerCase("pt-BR");
    if (!t) return itens;
    return itens.filter((i) => `${i.texto} ${i.momento}`.toLocaleLowerCase("pt-BR").includes(t));
  }, [busca, itens]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 tela-slg:grid-cols-[minmax(0,1fr)_504px]">
      <div className="min-w-0 space-y-8">
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-titulo">Notificação de compra</h2>
          <FormularioTitulo idFormulario={idFormulario} webinarId={webinarId} titulo={titulo} aoMudar={setTitulo} />
        </section>

        <section className="space-y-4 border-t border-linha pt-8">
          <h2 className="text-base font-semibold text-titulo">Crie as vendas via arquivo</h2>
          <ImportarPlanilha webinarId={webinarId} />
        </section>

        <section className="space-y-4 border-t border-linha pt-8">
          <h2 className="text-base font-semibold text-titulo">Crie a venda individual</h2>
          <FormularioItem action={adicionarVenda.bind(null, webinarId)} valores={VAZIO} rotuloBotao="Adicionar venda" />
        </section>
      </div>

      <aside className="min-w-0 rounded-lg border border-borda tela-slg:sticky tela-slg:top-4">
        <div className="space-y-3 border-b border-linha p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-titulo">Prévia das vendas</h2>
            <span className="text-sm text-texto-3">{total} vendas</span>
          </div>
          <div className="relative">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-apagado" />
            <input type="search" aria-label="Buscar venda" placeholder="Buscar venda" value={busca} onChange={(e) => setBusca(e.target.value)} className={`${estiloInput} pl-9`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/webinars/${webinarId}/vendas.xlsx`} className={estiloBotao("secundario", "pequeno")}>
              <FileDown aria-hidden /> Exportar XLSX
            </a>
            {itens.length > 0 && <BotaoApagarVendas webinarId={webinarId} />}
          </div>
        </div>
        <div className="max-h-[560px] overflow-y-auto bg-white p-3">
          {itens.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-texto-3">Nenhuma venda ainda. Importe a planilha ou crie uma a uma.</p>
          ) : filtrados.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-texto-3">Sem resultados.</p>
          ) : (
            <ul className="space-y-2">
              {filtrados.map((item) => (
                <LinhaVenda key={item.id} webinarId={webinarId} item={item} titulo={titulo} />
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
