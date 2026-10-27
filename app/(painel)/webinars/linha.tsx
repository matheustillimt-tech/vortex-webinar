"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ChartLine, Copy, Files, FileText, Globe, History, Link2, Pencil, Trash2, Video } from "lucide-react";
import { estiloBotaoIcone, estiloCelula, estiloLinhaMarca, Selo, type CorSelo } from "../_componentes/ui";
import { Modal } from "../_componentes/modal";
import { useToast } from "../_componentes/toast";
import { apagarWebinar, arquivarWebinar, duplicarWebinar, reativarWebinar } from "./actions";
import { linksDaSala } from "@/src/lib/regras/links-sala";
import { CaixaLink } from "../_componentes/copiar";
import { MenuAcoes } from "../_componentes/menu-acoes";

export type WebinarLinha = {
  id: string;
  nome: string;
  slug: string;
  status: "ativo" | "arquivado";
  tipo_agenda: "unica" | "recorrente" | "jit";
};

const TIPO: Record<WebinarLinha["tipo_agenda"], string> = { unica: "Único", recorrente: "Recorrente", jit: "Just in time" };
const TIPO_COR: Record<WebinarLinha["tipo_agenda"], CorSelo> = { unica: "destaque", recorrente: "destaque", jit: "neutro" };
const STATUS_COR: Record<WebinarLinha["status"], CorSelo> = { ativo: "ok", arquivado: "neutro" };
const STATUS_TEXTO: Record<WebinarLinha["status"], string> = { ativo: "Ativo", arquivado: "Arquivado" };

/** Linha da tabela de webinars: miniatura 40×40 + nome + data, status, tipo e os botões de ícone
 *  50×40 (links, editar, métricas, tempo real, duplicar, ⋮). A linha inteira abre o editor. */
export function LinhaWebinar({
  webinar,
  proximaSessao,
  miniatura,
  salaUrl,
  tokenTeste,
}: {
  webinar: WebinarLinha;
  proximaSessao: string;
  miniatura: string | null;
  salaUrl: string;
  tokenTeste: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [processando, setProcessando] = useState(false);
  const [linksAbertos, setLinksAbertos] = useState(false);
  const editar = `/webinars/${webinar.id}/inicio`;

  async function duplicar() {
    const ok = await toast.confirmar({
      titulo: "Duplique o webinar",
      descricao: `Cria “${webinar.nome} (cópia)” com a mesma configuração (agenda, login, vídeo, oferta, chat, vendas, integrações…), sem participantes nem métricas.`,
      confirmar: "Duplicar",
    });
    if (!ok) return;
    setProcessando(true);
    try {
      const r = await duplicarWebinar(webinar.id);
      if (r?.erro) toast.erro(r.erro);
    } catch {
      // O redirecionamento de sucesso não cai aqui; só erro de verdade (rede etc.).
      toast.erro("Não deu para duplicar o webinar.");
    } finally {
      setProcessando(false);
    }
  }

  async function alternarArquivamento() {
    const arquivando = webinar.status === "ativo";
    if (
      arquivando &&
      !(await toast.confirmar({ titulo: `Arquivar “${webinar.nome}”?`, descricao: "Ele sai da lista de ativos e vai para Arquivados, de onde dá pra reativar.", confirmar: "Arquivar", perigo: true }))
    )
      return;

    setProcessando(true);
    try {
      const r = await (arquivando ? arquivarWebinar : reativarWebinar)(webinar.id);
      if (r.erro) {
        toast.erro(r.erro);
        return;
      }
      toast.sucesso(arquivando ? "Webinar arquivado." : "Webinar reativado.");
      router.refresh();
    } catch {
      toast.erro(arquivando ? "Não deu para arquivar o webinar." : "Não deu para reativar o webinar.");
    } finally {
      setProcessando(false);
    }
  }

  async function apagar() {
    const ok = await toast.confirmar({
      titulo: `Apagar “${webinar.nome}” de vez?`,
      descricao:
        "Apaga o webinar e tudo dele: participantes, sessões, mensagens, vendas, métricas, configurações e imagens. Não tem como desfazer. Os vídeos da biblioteca continuam.",
      confirmar: "Apagar de vez",
      perigo: true,
    });
    if (!ok) return;
    setProcessando(true);
    try {
      const r = await apagarWebinar(webinar.id);
      if (r.erro) {
        toast.erro(r.erro);
        return;
      }
      toast.sucesso("Webinar apagado.");
      router.refresh();
    } catch {
      toast.erro("Não deu para apagar o webinar.");
    } finally {
      setProcessando(false);
    }
  }

  /** Clique na linha abre o editor, menos quando foi num botão ou link, ou dentro do modal/menu (que estão num
   *  portal: o evento sobe pela árvore do React, mas o nó não fica dentro da linha no DOM). */
  function aoClicarLinha(e: React.MouseEvent<HTMLTableRowElement>) {
    const alvo = e.target as HTMLElement;
    if (!e.currentTarget.contains(alvo) || alvo.closest("a,button,input")) return;
    router.push(editar);
  }

  return (
    <tr className={`h-[65px] cursor-pointer ${estiloLinhaMarca}`} onClick={aoClicarLinha} aria-busy={processando || undefined}>
      <td className={estiloCelula}>
        <div className="flex min-w-[240px] items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-suave bg-cover bg-center text-apagado"
            style={miniatura ? { backgroundImage: `url(${JSON.stringify(miniatura)})` } : undefined}
          >
            {!miniatura && <Video size={18} />}
          </span>
          <div className="min-w-0">
            <Link href={editar} className="block max-w-[320px] truncate font-medium text-texto hover:underline">
              {webinar.nome}
            </Link>
            <p className="truncate text-xs text-texto-3">{proximaSessao}</p>
          </div>
        </div>
      </td>
      <td className={estiloCelula}>
        <Selo cor={STATUS_COR[webinar.status]}>{STATUS_TEXTO[webinar.status]}</Selo>
      </td>
      <td className={estiloCelula}>
        <Selo cor={TIPO_COR[webinar.tipo_agenda]}>{TIPO[webinar.tipo_agenda]}</Selo>
      </td>
      <td className={estiloCelula}>
        <div className="flex items-center justify-end gap-0.5">
          <button type="button" className={estiloBotaoIcone("tabela", "marca")} aria-label="Links" title="Links" onClick={() => setLinksAbertos(true)}>
            <Link2 size={20} aria-hidden />
          </button>
          <Link href={editar} className={estiloBotaoIcone("tabela", "marca")} aria-label="Editar" title="Editar">
            <Pencil size={20} aria-hidden />
          </Link>
          <Link href={`/webinars/${webinar.id}/metricas`} className={estiloBotaoIcone("tabela", "marca")} aria-label="Métricas" title="Métricas">
            <ChartLine size={20} aria-hidden />
          </Link>
          <Link href={`/webinars/${webinar.id}/ao-vivo`} className={estiloBotaoIcone("tabela", "marca")} aria-label="Métricas em tempo real" title="Métricas em tempo real">
            <Globe size={20} aria-hidden />
          </Link>
          <button type="button" className={estiloBotaoIcone("tabela", "marca")} aria-label="Duplique o webinar" title="Duplique o webinar" onClick={duplicar} disabled={processando}>
            <Files size={20} aria-hidden />
          </button>
          <MenuAcoes
            itens={[
              { rotulo: "Links", icone: Link2, aoClicar: () => setLinksAbertos(true) },
              { rotulo: "Editar", icone: Pencil, href: editar },
              { rotulo: "Duplique o webinar", icone: Copy, aoClicar: () => void duplicar(), desativado: processando },
              { rotulo: "Métricas", icone: ChartLine, href: `/webinars/${webinar.id}/metricas` },
              { rotulo: "Métricas em tempo real", icone: Globe, href: `/webinars/${webinar.id}/ao-vivo` },
              { rotulo: "Histórico de ações", icone: History, href: `/webinars/${webinar.id}/historico` },
              { rotulo: "Logs de integrações", icone: FileText, href: `/configuracoes/integracoes/${webinar.id}/log` },
              { separador: true },
              webinar.status === "ativo"
                ? { rotulo: "Arquivar", icone: Archive, aoClicar: () => void alternarArquivamento(), perigo: true, desativado: processando }
                : { rotulo: "Reativar", icone: ArchiveRestore, aoClicar: () => void alternarArquivamento(), desativado: processando },
              // Apagar de vez só pra arquivado: quem quer apagar um ativo arquiva primeiro.
              ...(webinar.status === "arquivado"
                ? [{ rotulo: "Apagar de vez", icone: Trash2, aoClicar: () => void apagar(), perigo: true, desativado: processando }]
                : []),
            ]}
          />
        </div>
        <Modal aberto={linksAbertos} aoFechar={() => setLinksAbertos(false)} titulo="Links" descricao={webinar.nome} largura="lg">
          <div className="space-y-4">
            {linksDaSala(salaUrl, webinar.slug, webinar.tipo_agenda === "jit").map((l) => (
              <CaixaLink key={l.rotulo} link={l} />
            ))}
            <CaixaLink
              link={{
                rotulo: "Sala teste",
                url: `${salaUrl.replace(/\/+$/, "")}/${webinar.slug}?teste=${tokenTeste}`,
                descricao: "Controles do vídeo liberados e sem contar métricas. Abre a tela de login em modo teste: preencha nome e telefone pra testar os webhooks com dados. Vale por 24 horas.",
              }}
            />
          </div>
        </Modal>
      </td>
    </tr>
  );
}
