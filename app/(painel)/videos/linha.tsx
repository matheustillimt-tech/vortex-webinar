"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Film, Link2, PlayCircle, RefreshCw, TextCursorInput, Trash2 } from "lucide-react";
import { formatarDuracao, formatarTamanho } from "@/src/lib/regras/video";
import { Modal } from "../_componentes/modal";
import { useToast } from "../_componentes/toast";
import { Botao, CampoTexto, estiloCelula, Selo, type CorSelo } from "../_componentes/ui";
import { MenuAcoes } from "../_componentes/menu-acoes";
import { atualizarStatus, excluirVideo, renomearVideo } from "./actions";
import { PreviaVideo } from "./previa";

export type VideoLinha = {
  id: string;
  nome: string;
  origem: "bunny" | "externo";
  status: "enviando" | "processando" | "pronto" | "erro";
  progresso: number;
  duracao_seg: number | null;
  bytes: number | null;
  thumb_url: string | null;
  created_at: string;
};

const SELO_STATUS: Record<VideoLinha["status"], { cor: CorSelo; texto: (progresso: number) => string }> = {
  pronto: { cor: "ok", texto: () => "Publicado 100%" },
  processando: { cor: "aviso", texto: (p) => `Convertendo ${p}%` },
  enviando: { cor: "neutro", texto: () => "Enviando…" },
  erro: { cor: "erro", texto: () => "Erro no envio" },
};

function dataHora(iso: string): { data: string; hora: string } {
  const d = new Date(iso);
  return {
    data: d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    hora: d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }),
  };
}

/** Linha da tabela "Sua biblioteca de vídeos" com o menu ⋮ (Assistir prévia, Baixar, Renomear,
 *  Vinculados, Excluir). */
export function LinhaVideo({ video, vinculados, baixarUrl, previaUrl }: {
  video: VideoLinha;
  vinculados: { id: string; nome: string }[];
  baixarUrl: string | null;
  previaUrl: string | null;
}) {
  const toast = useToast();
  const router = useRouter();
  const [processando, setProcessando] = useState(false);
  const [renomeando, setRenomeando] = useState(false);
  const [nome, setNome] = useState(video.nome);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [verVinculos, setVerVinculos] = useState(false);
  const [previa, setPrevia] = useState(false);

  async function salvarNome() {
    const novo = nome.trim();
    if (!novo || novo === video.nome) {
      setRenomeando(false);
      return;
    }
    setProcessando(true);
    setErroNome(null);
    try {
      const r = await renomearVideo(video.id, novo);
      if (r.erro) setErroNome(r.erro);
      else {
        setRenomeando(false);
        toast.sucesso("Vídeo renomeado.");
        router.refresh();
      }
    } catch {
      setErroNome("Não deu para renomear o vídeo.");
    } finally {
      setProcessando(false);
    }
  }

  async function executar(fn: () => Promise<{ erro?: string }>, sucesso: string, falha: string) {
    setProcessando(true);
    try {
      const r = await fn();
      if (r.erro) toast.erro(r.erro);
      else {
        toast.sucesso(sucesso);
        router.refresh();
      }
    } catch {
      toast.erro(falha);
    } finally {
      setProcessando(false);
    }
  }

  async function excluir() {
    if (vinculados.length) {
      toast.erro("Este vídeo está em uso.", `Troque o vídeo de ${vinculados.map((w) => w.nome).join(", ")} antes de excluir.`);
      return;
    }
    if (!(await toast.confirmar({ descricao: `"${video.nome}" será excluído. Essa ação não pode ser desfeita.`, perigo: true }))) return;
    await executar(() => excluirVideo(video.id), "Vídeo excluído.", "Não deu para excluir o vídeo.");
  }

  const selo = SELO_STATUS[video.status];
  const tamanho = formatarTamanho(video.bytes);
  const { data, hora } = dataHora(video.created_at);

  return (
    <tr>
      <td className={`${estiloCelula} min-w-[260px] py-3`}>
        <div className="flex min-w-0 items-center gap-3">
          {video.thumb_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={video.thumb_url} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-suave text-apagado">
              <Film size={20} aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <p className="max-w-[360px] truncate font-medium text-texto" title={video.nome}>
              {video.nome}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-texto-3">
              <Selo cor={selo.cor}>{selo.texto(video.progresso)}</Selo>
              {video.origem === "externo" && <Selo cor="neutro">Link externo</Selo>}
              {video.duracao_seg != null && <span>{formatarDuracao(video.duracao_seg)}</span>}
            </div>
          </div>
        </div>
      </td>
      <td className={`${estiloCelula} whitespace-nowrap`}>
        <p className="text-texto">{data}</p>
        <p className="text-xs text-texto-3">{hora}</p>
      </td>
      <td className={`${estiloCelula} whitespace-nowrap text-texto-2`}>{tamanho ?? "—"}</td>
      <td className={`${estiloCelula} text-right`}>
        <MenuAcoes
          itens={[
            !!previaUrl && { rotulo: "Assistir prévia", icone: PlayCircle, aoClicar: () => setPrevia(true) },
            !!baixarUrl && { rotulo: "Baixar", icone: Download, href: baixarUrl, externo: true },
            {
              rotulo: "Renomear",
              icone: TextCursorInput,
              desativado: processando,
              aoClicar: () => {
                setNome(video.nome);
                setErroNome(null);
                setRenomeando(true);
              },
            },
            { rotulo: `Vinculados (${vinculados.length})`, icone: Link2, aoClicar: () => setVerVinculos(true) },
            video.origem === "bunny" &&
              video.status !== "pronto" && { rotulo: "Atualizar status", icone: RefreshCw, desativado: processando, aoClicar: () => void executar(() => atualizarStatus(video.id), "Status atualizado.", "Não deu para atualizar o status.") },
            { rotulo: "Excluir", icone: Trash2, perigo: true, desativado: processando, aoClicar: () => void excluir() },
          ]}
        />

        {previaUrl && <PreviaVideo aberto={previa} aoFechar={() => setPrevia(false)} nome={video.nome} url={previaUrl} />}

        <Modal
          aberto={renomeando}
          aoFechar={() => setRenomeando(false)}
          travado={processando}
          titulo="Renomear vídeo"
          rodape={
            <>
              <Botao variante="secundario" onClick={() => setRenomeando(false)} disabled={processando}>
                Cancelar
              </Botao>
              <Botao onClick={() => void salvarNome()} carregando={processando} disabled={!nome.trim()}>
                Salvar
              </Botao>
            </>
          }
        >
          <form
            className="text-left"
            onSubmit={(e) => {
              e.preventDefault();
              void salvarNome();
            }}
          >
            <CampoTexto rotulo="Nome do vídeo" required value={nome} onChange={(e) => setNome(e.target.value)} erro={erroNome} />
          </form>
        </Modal>

        <Modal aberto={verVinculos} aoFechar={() => setVerVinculos(false)} titulo="Webinars vinculados" descricao={`Webinars que usam "${video.nome}".`}>
          {vinculados.length === 0 ? (
            <p className="text-left text-sm text-texto-3">Nenhum webinar usa este vídeo.</p>
          ) : (
            <ul className="divide-y divide-linha rounded-md border border-linha text-left">
              {vinculados.map((w) => (
                <li key={w.id} className="px-3 py-2 text-sm">
                  <a href={`/webinars/${w.id}/video`} className="font-medium hover:text-marca hover:underline">
                    {w.nome}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      </td>
    </tr>
  );
}
