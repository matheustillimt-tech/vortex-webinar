"use client";
// "Enviar novo vídeo": modal com o arquivo (ou um link) e, durante o envio, um aviso flutuante no canto
// da tela com o progresso e o tempo restante (dá pra trocar o canto). Um envio por vez; fechar a aba cancela.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { ArrowLeftRight, CloudUpload, Plus, X } from "lucide-react";
import { Modal } from "../_componentes/modal";
import { useToast } from "../_componentes/toast";
import { Botao, CampoTexto, Segmentos } from "../_componentes/ui";
import { iniciarEnvio, marcarEnviado } from "./actions";
import { VideoExterno } from "./externo";

type Envio = { nome: string; progresso: number; inicio: number; enviados: number; total: number };

function tempoRestante(e: Envio): string | null {
  const decorrido = (Date.now() - e.inicio) / 1000;
  if (e.enviados <= 0 || decorrido < 2) return null;
  const seg = Math.max(0, Math.round(((e.total - e.enviados) / e.enviados) * decorrido));
  if (seg < 60) return `${seg} s restantes`;
  const min = Math.floor(seg / 60);
  return min < 60 ? `${min} min restantes` : `${Math.floor(min / 60)} h ${min % 60} min restantes`;
}

export function EnviarVideo({ ligado }: { ligado: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<tus.Upload | null>(null);
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<"arquivo" | "link">(ligado ? "arquivo" : "link");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [nome, setNome] = useState("");
  const [arrastando, setArrastando] = useState(false);
  const [envio, setEnvio] = useState<Envio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [canto, setCanto] = useState<"esquerda" | "direita">("esquerda");

  // Fechar a aba no meio do envio cancela: avisa antes.
  useEffect(() => {
    if (!envio) return;
    function antes(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", antes);
    return () => window.removeEventListener("beforeunload", antes);
  }, [envio]);

  function escolher(f: File | null) {
    setArquivo(f);
    setErro(null);
    if (f) setNome(f.name.replace(/\.[^./]+$/, ""));
  }

  async function enviar() {
    if (!arquivo || !nome.trim() || envio) return;
    setErro(null);
    const nomeFinal = nome.trim();
    const r = await iniciarEnvio(nomeFinal, arquivo.size).catch(() => ({ erro: "Não deu para começar o envio." }) as const);
    if ("erro" in r) {
      setErro(r.erro);
      return;
    }

    setAberto(false);
    setEnvio({ nome: nomeFinal, progresso: 0, inicio: Date.now(), enviados: 0, total: arquivo.size });
    const upload = new tus.Upload(arquivo, {
      endpoint: r.tus.endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        AuthorizationSignature: r.tus.assinatura,
        AuthorizationExpire: String(r.tus.expira),
        VideoId: r.tus.videoId,
        LibraryId: r.tus.libraryId,
      },
      metadata: { filetype: arquivo.type, title: nomeFinal },
      removeFingerprintOnSuccess: true,
      onProgress: (enviados, total) => setEnvio((e) => (e ? { ...e, enviados, total, progresso: Math.floor((enviados / total) * 100) } : e)),
      onSuccess: async () => {
        const m = await marcarEnviado(r.videoId).catch(() => ({ erro: "O vídeo subiu, mas não deu para marcar como enviado." }));
        setEnvio(null);
        uploadRef.current = null;
        if (m.erro) {
          toast.erro(m.erro);
          return;
        }
        toast.sucesso("Vídeo enviado.", "A conversão continua no provedor; a prévia já funciona.");
        setArquivo(null);
        setNome("");
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      },
      onError: () => {
        setEnvio(null);
        uploadRef.current = null;
        toast.erro("O envio falhou.", "Tente de novo.");
      },
    });
    uploadRef.current = upload;
    upload.start();
    router.refresh();
  }

  async function cancelar() {
    if (!(await toast.confirmar({ titulo: "Cancelar o envio?", descricao: "O que já subiu é descartado.", confirmar: "Cancelar envio", cancelar: "Continuar enviando", perigo: true }))) return;
    await uploadRef.current?.abort(true).catch(() => undefined);
    uploadRef.current = null;
    setEnvio(null);
    toast.aviso("Envio cancelado.");
  }

  return (
    <>
      <Botao
        tamanho="pequeno"
        className="h-9"
        icone={<Plus aria-hidden />}
        onClick={() => {
          if (envio) toast.aviso("Já existe um vídeo sendo enviado.", "Espere terminar para enviar outro.");
          else setAberto(true);
        }}
      >
        Enviar novo vídeo
      </Botao>

      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Enviar novo vídeo" descricao="MP4, MOV ou MKV. Não feche a aba enquanto o envio estiver em andamento." largura="lg">
        <Segmentos
          opcoes={[
            { valor: "arquivo", rotulo: "Enviar arquivo" },
            { valor: "link", rotulo: "Usar um link" },
          ]}
          valor={aba}
          aoMudar={setAba}
        />
        {aba === "link" ? (
          <VideoExterno aoAdicionar={() => setAberto(false)} />
        ) : !ligado ? (
          <p className="rounded-md border border-aviso/30 bg-aviso-fundo px-3 py-2 text-sm text-aviso">Envio desligado: falta configurar o Bunny Stream. Por enquanto, use um link.</p>
        ) : (
          <div className="space-y-4">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastando(false);
                const f = e.dataTransfer.files?.[0];
                if (f && f.type.startsWith("video/")) escolher(f);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${arrastando ? "border-marca bg-marca-linha" : "border-borda hover:bg-suave"}`}
            >
              <CloudUpload size={32} aria-hidden className="text-marca" />
              <span className="text-sm font-medium text-texto">{arquivo ? arquivo.name : "Arraste o vídeo ou clique para escolher"}</span>
              <span className="text-xs text-texto-3">MP4, MOV ou MKV</span>
              <input ref={inputRef} type="file" accept="video/*" className="sr-only" onChange={(e) => escolher(e.target.files?.[0] ?? null)} />
            </label>
            <CampoTexto rotulo="Nome do vídeo" value={nome} onChange={(e) => setNome(e.target.value)} erro={erro} />
            <div className="flex flex-col-reverse gap-2 tela-sm:flex-row tela-sm:justify-end">
              <Botao variante="secundario" onClick={() => setAberto(false)}>
                Cancelar
              </Botao>
              <Botao onClick={() => void enviar()} disabled={!arquivo || !nome.trim()}>
                Enviar
              </Botao>
            </div>
          </div>
        )}
      </Modal>

      {envio && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 z-[55] w-[340px] max-w-[calc(100vw-2rem)] rounded-lg border border-linha bg-superficie p-4 shadow-lg ${canto === "esquerda" ? "left-4" : "right-4"}`}
        >
          <div className="mb-2 flex items-start gap-2">
            <CloudUpload size={18} aria-hidden className="mt-0.5 shrink-0 text-marca" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-texto">Enviando “{envio.nome}”</p>
              <p className="text-xs text-texto-3">
                {envio.progresso}%{tempoRestante(envio) ? ` · ${tempoRestante(envio)}` : ""} · não feche a aba
              </p>
            </div>
            <button type="button" aria-label="Trocar de canto" title="Trocar de canto" onClick={() => setCanto((c) => (c === "esquerda" ? "direita" : "esquerda"))} className="rounded-md p-1 text-texto-3 hover:bg-suave hover:text-texto">
              <ArrowLeftRight size={16} aria-hidden />
            </button>
            <button type="button" aria-label="Cancelar envio" title="Cancelar envio" onClick={() => void cancelar()} className="rounded-md p-1 text-texto-3 hover:bg-suave hover:text-erro">
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-suave" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={envio.progresso}>
            <div className="h-full rounded-full bg-marca transition-all" style={{ width: `${envio.progresso}%` }} />
          </div>
        </div>
      )}
    </>
  );
}
