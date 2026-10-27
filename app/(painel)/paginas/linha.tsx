"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, Pencil, TextCursorInput, Trash2 } from "lucide-react";
import { Modal } from "../_componentes/modal";
import { useToast } from "../_componentes/toast";
import { Botao, CampoTexto, estiloCelula } from "../_componentes/ui";
import { MenuAcoes } from "../_componentes/menu-acoes";
import { duplicarPagina, excluirPagina, renomearPagina, webinarsVinculados, type VinculoComRotulo } from "./actions";

export type PaginaLinha = { id: string; nome: string; tipo: string; criadoEm: string };

/** Linha da tabela "Suas páginas": nome (abre o editor), tipo, data e o menu ⋮ (Editar, Duplicar,
 *  Renomear, Webinars vinculados, Excluir). Renomear e vinculados abrem modal; excluir confirma em modal. */
export function LinhaPagina({ pagina }: { pagina: PaginaLinha }) {
  const toast = useToast();
  const router = useRouter();
  const [processando, setProcessando] = useState(false);
  const [renomeando, setRenomeando] = useState(false);
  const [nome, setNome] = useState(pagina.nome);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [vinculos, setVinculos] = useState<VinculoComRotulo[] | null>(null);

  async function executar(fn: () => Promise<{ erro?: string } | void>, falha: string, sucesso?: string): Promise<boolean> {
    setProcessando(true);
    try {
      const r = await fn();
      if (r && r.erro) {
        toast.erro(r.erro);
        return false;
      }
      if (r !== undefined && sucesso) toast.sucesso(sucesso);
      router.refresh();
      return true;
    } catch {
      toast.erro(falha);
      return false;
    } finally {
      setProcessando(false);
    }
  }

  async function salvarNome() {
    const novo = nome.trim();
    if (novo === pagina.nome) {
      setRenomeando(false);
      return;
    }
    setProcessando(true);
    setErroNome(null);
    try {
      const r = await renomearPagina(pagina.id, novo);
      if (r.erro) setErroNome(r.erro);
      else {
        setRenomeando(false);
        toast.sucesso("Página renomeada.");
        router.refresh();
      }
    } catch {
      setErroNome("Não deu para renomear a página.");
    } finally {
      setProcessando(false);
    }
  }

  async function verVinculos() {
    const r = await webinarsVinculados(pagina.id).catch(() => ({ erro: "Não deu para ler os webinars vinculados." }) as { erro: string; vinculos?: undefined });
    if (r.erro) toast.erro(r.erro);
    else setVinculos(r.vinculos ?? []);
  }

  function excluir() {
    void executar(
      async () => {
        const r = await webinarsVinculados(pagina.id);
        if (r.erro) return r;
        const v = r.vinculos ?? [];
        const aviso = v.length
          ? `A página "${pagina.nome}" está vinculada a ${v.length === 1 ? "1 lugar" : `${v.length} lugares`}:\n\n${v.map((x) => `• ${x.nome} (${x.rotulo})`).join("\n")}\n\nAo excluir, esses webinars voltam a usar a página padrão.`
          : `A página "${pagina.nome}" será excluída. Não dá para desfazer.`;
        if (!(await toast.confirmar({ descricao: aviso, perigo: true }))) return;
        return excluirPagina(pagina.id);
      },
      "Não deu para excluir a página.",
      "Página excluída.",
    );
  }

  return (
    <tr>
      <td className={`${estiloCelula} min-w-[220px] py-3`}>
        <Link href={`/paginas/${pagina.id}/editor`} className="font-medium text-texto hover:text-marca hover:underline">
          {pagina.nome}
        </Link>
      </td>
      <td className={`${estiloCelula} whitespace-nowrap text-texto-2`}>{pagina.tipo}</td>
      <td className={`${estiloCelula} whitespace-nowrap text-texto-2`}>{pagina.criadoEm}</td>
      <td className={`${estiloCelula} text-right`}>
        <MenuAcoes
          itens={[
            { rotulo: "Editar", icone: Pencil, href: `/paginas/${pagina.id}/editor` },
            { rotulo: "Duplicar", icone: Copy, desativado: processando, aoClicar: () => void executar(() => duplicarPagina(pagina.id), "Não deu para duplicar a página.", "Página duplicada.") },
            {
              rotulo: "Renomear",
              icone: TextCursorInput,
              desativado: processando,
              aoClicar: () => {
                setNome(pagina.nome);
                setErroNome(null);
                setRenomeando(true);
              },
            },
            { rotulo: "Webinars vinculados", icone: Link2, aoClicar: () => void verVinculos() },
            { rotulo: "Excluir", icone: Trash2, perigo: true, desativado: processando, aoClicar: excluir },
          ]}
        />

        <Modal
          aberto={renomeando}
          aoFechar={() => setRenomeando(false)}
          travado={processando}
          titulo="Renomear página"
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
            <CampoTexto rotulo="Nome da página" required maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} erro={erroNome} contador={`${nome.length} de 120`} />
          </form>
        </Modal>

        <Modal aberto={vinculos !== null} aoFechar={() => setVinculos(null)} titulo="Webinars vinculados" descricao={`Onde a página "${pagina.nome}" está em uso.`}>
          {vinculos && vinculos.length === 0 ? (
            <p className="text-left text-sm text-texto-3">Nenhum webinar usa esta página.</p>
          ) : (
            <ul className="divide-y divide-linha rounded-md border border-linha text-left">
              {vinculos?.map((v) => (
                <li key={`${v.webinarId}-${v.lugar}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <Link href={`/webinars/${v.webinarId}/agenda`} className="min-w-0 truncate font-medium hover:text-marca hover:underline">
                    {v.nome}
                  </Link>
                  <span className="shrink-0 text-xs text-texto-3">{v.rotulo}</span>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      </td>
    </tr>
  );
}
