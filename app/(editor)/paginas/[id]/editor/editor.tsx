"use client";
import grapesjs, { type Editor } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { validarImagemPagina } from "@/src/lib/regras/midia";
import { cssDosAjustes, FONTES_PAGINA, MAX_DESCRICAO_PAGINA, MAX_TITULO_ABA, urlFontes, type ConfigPagina } from "@/src/lib/regras/paginas-editor";
import { enviarImagemPagina, previaPagina, renomearPagina, salvarPagina } from "@/app/(painel)/paginas/actions";
import { ArrowLeft, Eye, LoaderCircle, Monitor, Redo2, Save, Smartphone, Undo2, X } from "lucide-react";
import { Modal } from "@/app/(painel)/_componentes/modal";
import { useToast } from "@/app/(painel)/_componentes/toast";
import { Botao, CampoTexto, estiloBotao, estiloInput, estiloSelect, estiloTextarea } from "@/app/(painel)/_componentes/ui";
import { CSS_CANVAS, pluginVw } from "./plugin-vw";

export type PropsEditor = {
  id: string;
  nome: string;
  tipo: string;
  registro: boolean;
  projeto: Record<string, unknown>;
  config: ConfigPagina;
};

type AbaEsquerda = "blocos" | "camadas";
type AbaDireita = "estilos" | "propriedades" | "ajustes" | "css";

/** Moldura do editor no tema claro do painel (botões secundários de 32 px, campos do painel). */
const botaoTopo = estiloBotao("secundario", "pequeno");
const botaoTopoAtivo = "border-marca text-marca";
const estiloCampo = estiloInput;

/** Ajustes e CSS personalizado aplicados ao canvas (só para ver; o salvar soma no CSS publicado). */
function cssAjustesCanvas(c: ConfigPagina): string {
  return `${cssDosAjustes(c)}\n${c.css_personalizado}`;
}

export function EditorDePagina({ id, nome: nomeInicial, tipo, registro, projeto, config: configInicial }: PropsEditor) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const blocosRef = useRef<HTMLDivElement>(null);
  const camadasRef = useRef<HTMLDivElement>(null);
  const seletoresRef = useRef<HTMLDivElement>(null);
  const estilosRef = useRef<HTMLDivElement>(null);
  const propriedadesRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const configRef = useRef(configInicial);

  const [nome, setNome] = useState(nomeInicial);
  const [config, setConfig] = useState(configInicial);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [esquerda, setEsquerda] = useState<AbaEsquerda>("blocos");
  const [direita, setDireita] = useState<AbaDireita>("estilos");
  const [dispositivo, setDispositivo] = useState<"Computador" | "Celular">("Computador");
  const [previa, setPrevia] = useState<string | null>(null);
  const [larguraPrevia, setLarguraPrevia] = useState<"100%" | "375px">("100%");
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const toast = useToast();

  /** Atualiza o `<style>` dos Ajustes dentro do canvas. */
  const aplicarAjustesNoCanvas = useCallback((c: ConfigPagina) => {
    const doc = editorRef.current?.Canvas.getDocument();
    if (!doc) return;
    let el = doc.getElementById("vw-ajustes");
    if (!el) {
      el = doc.createElement("style");
      el.id = "vw-ajustes";
      doc.head.appendChild(el);
    }
    el.textContent = cssAjustesCanvas(c);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    async function enviarArquivos(e: { dataTransfer?: DataTransfer | null; target?: EventTarget | null }) {
      const lista = e.dataTransfer?.files ?? (e.target as HTMLInputElement | null)?.files;
      if (!lista) return;
      for (const arquivo of Array.from(lista)) {
        const erro = validarImagemPagina(arquivo.type, arquivo.size);
        if (erro) {
          setMensagem({ tipo: "erro", texto: erro });
          continue;
        }
        const fd = new FormData();
        fd.set("arquivo", arquivo);
        try {
          const r = await enviarImagemPagina(id, fd);
          if (r.url) editorRef.current?.AssetManager.add({ src: r.url, name: arquivo.name });
          else setMensagem({ tipo: "erro", texto: r.erro ?? "Não deu para enviar a imagem." });
        } catch {
          setMensagem({ tipo: "erro", texto: "Não deu para enviar a imagem." });
        }
      }
    }

    const editor = grapesjs.init({
      container: canvasRef.current,
      height: "100%",
      width: "auto",
      fromElement: false,
      storageManager: false,
      projectData: projeto,
      protectedCss: "",
      panels: { defaults: [] },
      blockManager: { appendTo: blocosRef.current! },
      layerManager: { appendTo: camadasRef.current! },
      selectorManager: { appendTo: seletoresRef.current!, componentFirst: true },
      styleManager: { appendTo: estilosRef.current! },
      traitManager: { appendTo: propriedadesRef.current! },
      assetManager: { upload: false, embedAsBase64: false, multiUpload: false, uploadFile: enviarArquivos },
      deviceManager: {
        devices: [
          { id: "Computador", name: "Computador", width: "" },
          { id: "Celular", name: "Celular", width: "375px", widthMedia: "768px" },
        ],
      },
      canvas: { styles: [urlFontes()] },
      plugins: [pluginVw],
    });
    editorRef.current = editor;

    editor.on("canvas:frame:load", ({ window: janela }: { window: Window }) => {
      const doc = janela.document;
      const base = doc.createElement("style");
      base.id = "vw-canvas";
      base.textContent = CSS_CANVAS;
      doc.head.appendChild(base);
      aplicarAjustesNoCanvas(configRef.current);
    });
    editor.on("load", () => {
      aplicarAjustesNoCanvas(configRef.current);
      editor.UndoManager.clear();
      editor.on("update", () => setSujo(true));
    });

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // O editor nasce uma vez por página; `projeto` só vale na abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Aviso ao sair (fechar a aba, recarregar) com mudança não salva.
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  function mudarConfig(parcial: Partial<ConfigPagina>) {
    const nova = { ...configRef.current, ...parcial };
    configRef.current = nova;
    setConfig(nova);
    setSujo(true);
    aplicarAjustesNoCanvas(nova);
  }

  function conteudo() {
    const editor = editorRef.current!;
    return { html: editor.getHtml(), css: editor.getCss() ?? "", projeto: editor.getProjectData(), config: configRef.current };
  }

  async function salvar() {
    if (!editorRef.current) return;
    setSalvando(true);
    setMensagem(null);
    try {
      const r = await salvarPagina(id, conteudo());
      if (r.erro) {
        setMensagem({ tipo: "erro", texto: r.erro });
        toast.erro(r.erro);
      } else {
        setSujo(false);
        toast.sucesso("Página salva.");
      }
    } catch {
      setMensagem({ tipo: "erro", texto: "Não deu para salvar a página." });
      toast.erro("Não deu para salvar a página.");
    } finally {
      setSalvando(false);
    }
  }

  async function abrirPrevia() {
    if (!editorRef.current) return;
    setMensagem(null);
    try {
      const r = await previaPagina(conteudo());
      if (r.erro || !r.documento) setMensagem({ tipo: "erro", texto: r.erro ?? "Não deu para gerar a pré-visualização." });
      else setPrevia(r.documento);
    } catch {
      setMensagem({ tipo: "erro", texto: "Não deu para gerar a pré-visualização." });
    }
  }

  async function renomear() {
    const novo = (renomeando ?? "").trim();
    if (!novo || novo === nome) {
      setRenomeando(null);
      return;
    }
    const r = await renomearPagina(id, novo).catch(() => ({ erro: "Não deu para renomear a página." }));
    if (r.erro) setErroNome(r.erro);
    else {
      setNome(novo);
      setRenomeando(null);
      toast.sucesso("Página renomeada.");
    }
  }

  function voltar(e: React.MouseEvent) {
    if (sujo && !window.confirm("Há mudanças não salvas. Sair sem salvar?")) e.preventDefault();
  }

  function trocarDispositivo(d: "Computador" | "Celular") {
    setDispositivo(d);
    editorRef.current?.setDevice(d);
  }

  const abaClasse = (ativa: boolean) =>
    `flex-1 border-b-2 px-2 py-2.5 text-sm font-medium transition-colors ${ativa ? "border-marca text-texto" : "border-transparent text-texto-3 hover:text-texto"}`;

  return (
    <div className="vw-editor flex h-screen flex-col">
      <style>{`
        .vw-editor .gjs-cv-canvas{width:100%;height:100%;top:0;left:0}
        .vw-editor .gjs-pn-panels{display:none}
        .vw-editor .vw-lateral .gjs-block{width:calc(50% - 10px);min-height:76px;margin:5px;padding:8px 4px;font-size:11px}
        .vw-editor .vw-lateral .gjs-blocks-c{justify-content:flex-start}
        .vw-editor .vw-lateral .gjs-one-bg,.vw-editor .vw-lateral .gjs-sm-sector-title,.vw-editor .vw-lateral .gjs-layer-title{background-color:transparent}
        .vw-editor .vw-lateral .gjs-two-color{color:var(--color-texto-2)}
        .vw-editor .vw-lateral .gjs-three-bg{background-color:var(--color-marca);color:#fff}
        .vw-editor .vw-lateral .gjs-four-color,.vw-editor .vw-lateral .gjs-four-color-h:hover{color:var(--color-marca)}
        .vw-editor .vw-lateral .gjs-block{border:1px solid var(--color-borda);border-radius:6px;box-shadow:none;color:var(--color-texto-2)}
        .vw-editor .vw-lateral .gjs-block:hover{border-color:var(--color-marca);color:var(--color-marca)}
        .vw-editor .vw-lateral .gjs-sm-sector,.vw-editor .vw-lateral .gjs-layer,.vw-editor .vw-lateral .gjs-trt-trait{border-color:var(--color-linha)}
        .vw-editor .vw-lateral .gjs-field{background-color:var(--color-superficie);border:1px solid var(--color-borda);border-radius:6px;color:var(--color-texto)}
        .vw-editor .vw-lateral .gjs-clm-tag{background-color:var(--color-suave);color:var(--color-texto-2)}
        .vw-editor .vw-lateral .gjs-layer-title{border-bottom:1px solid var(--color-linha)}
        .vw-editor .vw-lateral .gjs-layer.gjs-selected .gjs-layer-item{background-color:var(--color-marca-linha)}
      `}</style>

      <header className="flex h-14 shrink-0 items-center gap-3 overflow-x-auto border-b border-linha bg-superficie px-4">
        <Link href="/paginas" onClick={voltar} className={botaoTopo}>
          <ArrowLeft aria-hidden />
          Páginas
        </Link>
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => {
              setErroNome(null);
              setRenomeando(nome);
            }}
            className="block max-w-[320px] truncate text-left text-sm font-semibold text-titulo hover:underline"
            title="Renomear"
          >
            {nome}
          </button>
          <p className="truncate text-xs text-texto-3">{tipo}</p>
        </div>
        <div className="ml-4 flex items-center gap-1.5">
          <button type="button" className={botaoTopo} onClick={() => editorRef.current?.UndoManager.undo()} title="Desfazer" aria-label="Desfazer">
            <Undo2 aria-hidden />
          </button>
          <button type="button" className={botaoTopo} onClick={() => editorRef.current?.UndoManager.redo()} title="Refazer" aria-label="Refazer">
            <Redo2 aria-hidden />
          </button>
        </div>
        <div className="ml-2 flex items-center gap-1.5">
          {(["Computador", "Celular"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={dispositivo === d} className={`${botaoTopo} ${dispositivo === d ? botaoTopoAtivo : ""}`} onClick={() => trocarDispositivo(d)}>
              {d === "Computador" ? <Monitor aria-hidden /> : <Smartphone aria-hidden />}
              {d}
            </button>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {mensagem?.tipo === "erro" && <p className="max-w-[360px] truncate text-xs text-erro" title={mensagem.texto}>{mensagem.texto}</p>}
          {sujo && mensagem?.tipo !== "erro" && <p className="text-xs text-aviso">Mudanças não salvas</p>}
          <button type="button" className={botaoTopo} onClick={abrirPrevia}>
            <Eye aria-hidden />
            Pré-visualizar
          </button>
          <button type="button" onClick={salvar} disabled={salvando} className={estiloBotao("principal", "pequeno")}>
            {salvando ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </header>

      <Modal
        aberto={renomeando !== null}
        aoFechar={() => setRenomeando(null)}
        titulo="Renomear página"
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setRenomeando(null)}>
              Cancelar
            </Botao>
            <Botao onClick={() => void renomear()} disabled={!renomeando?.trim()}>
              Salvar
            </Botao>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void renomear();
          }}
        >
          <CampoTexto rotulo="Nome da página" required maxLength={120} value={renomeando ?? ""} onChange={(e) => setRenomeando(e.target.value)} erro={erroNome} contador={`${(renomeando ?? "").length} de 120`} />
        </form>
      </Modal>

      <div className="flex min-h-0 flex-1">
        <aside className="vw-lateral flex w-64 shrink-0 flex-col border-r border-linha bg-superficie">
          <div className="flex shrink-0 border-b border-linha">
            <button type="button" className={abaClasse(esquerda === "blocos")} onClick={() => setEsquerda("blocos")}>
              Blocos
            </button>
            <button type="button" className={abaClasse(esquerda === "camadas")} onClick={() => setEsquerda("camadas")}>
              Camadas
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {registro && esquerda === "blocos" && (
              <p className="mx-2 mt-2 rounded-md border border-marca-funil bg-marca-linha p-2 text-xs text-texto-2">
                Página de registro precisa do bloco “Formulário de inscrição” para ser usada num webinar.
              </p>
            )}
            <div ref={blocosRef} className={esquerda === "blocos" ? "" : "hidden"} />
            <div ref={camadasRef} className={esquerda === "camadas" ? "" : "hidden"} />
          </div>
        </aside>

        <div className="relative min-w-0 flex-1">
          <div ref={canvasRef} className="h-full" />
        </div>

        <aside className="vw-lateral flex w-72 shrink-0 flex-col border-l border-linha bg-superficie">
          <div className="flex shrink-0 border-b border-linha">
            {(
              [
                ["estilos", "Estilos"],
                ["propriedades", "Propriedades"],
                ["ajustes", "Ajustes"],
                ["css", "CSS"],
              ] as [AbaDireita, string][]
            ).map(([aba, rotulo]) => (
              <button key={aba} type="button" className={abaClasse(direita === aba)} onClick={() => setDireita(aba)}>
                {rotulo}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={direita === "estilos" ? "" : "hidden"}>
              <div ref={seletoresRef} />
              <div ref={estilosRef} />
            </div>
            <div ref={propriedadesRef} className={direita === "propriedades" ? "" : "hidden"} />

            {direita === "ajustes" && (
              <div className="space-y-4 p-4 text-sm">
                <label className="block space-y-1">
                  <span className="font-medium text-rotulo">Cor de fundo</span>
                  <span className="flex items-center gap-2">
                    <input type="color" value={config.cor_fundo.length === 4 ? `#${[...config.cor_fundo.slice(1)].map((c) => c + c).join("")}` : config.cor_fundo} onChange={(e) => mudarConfig({ cor_fundo: e.target.value })} className="h-9 w-10 cursor-pointer rounded-md border border-borda bg-superficie" />
                    <input value={config.cor_fundo} onChange={(e) => mudarConfig({ cor_fundo: e.target.value })} className={estiloCampo} maxLength={7} />
                  </span>
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-rotulo">Título da aba</span>
                  <input value={config.titulo} onChange={(e) => mudarConfig({ titulo: e.target.value })} maxLength={MAX_TITULO_ABA} className={estiloCampo} />
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-rotulo">Descrição</span>
                  <textarea value={config.descricao} onChange={(e) => mudarConfig({ descricao: e.target.value })} maxLength={MAX_DESCRICAO_PAGINA} rows={3} className={estiloTextarea} />
                  <span className="block text-xs text-texto-3">Aparece no Google e ao compartilhar o link.</span>
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-rotulo">Fonte</span>
                  <select value={config.fonte} onChange={(e) => mudarConfig({ fonte: e.target.value as ConfigPagina["fonte"] })} className={estiloSelect}>
                    {FONTES_PAGINA.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {direita === "css" && (
              <div className="space-y-2 p-4 text-sm">
                <span className="block font-medium text-rotulo">CSS personalizado</span>
                <textarea
                  value={config.css_personalizado}
                  onChange={(e) => mudarConfig({ css_personalizado: e.target.value })}
                  rows={18}
                  spellCheck={false}
                  placeholder={".minha-classe {\n  color: #fff;\n}"}
                  className={`${estiloTextarea} font-mono text-xs`}
                />
                <p className="text-xs text-texto-3">
                  Somado ao CSS da página ao salvar. Vale só dentro da página; regras perigosas (@import, javascript:) são removidas.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {previa !== null && (
        <div className="fixed inset-0 z-50 flex flex-col bg-overlay p-4" role="dialog" aria-modal="true" aria-label="Pré-visualização">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">Pré-visualização</p>
            <p className="text-xs text-white/70">Os blocos do webinar aparecem como caixas; na sala, mostram os dados reais.</p>
            <div className="ml-auto flex gap-1.5">
              <button type="button" className={`${botaoTopo} ${larguraPrevia === "100%" ? botaoTopoAtivo : ""}`} onClick={() => setLarguraPrevia("100%")}>
                Computador
              </button>
              <button type="button" className={`${botaoTopo} ${larguraPrevia === "375px" ? botaoTopoAtivo : ""}`} onClick={() => setLarguraPrevia("375px")}>
                Celular
              </button>
              <button type="button" className={botaoTopo} onClick={() => setPrevia(null)}>
                <X aria-hidden />
                Fechar
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 justify-center">
            <iframe title="Pré-visualização da página" sandbox="" srcDoc={previa} style={{ width: larguraPrevia }} className="h-full max-w-full rounded-lg border border-linha bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}
