"use client";
// Ações de cada linha da lista de testes A/B (ícones 50×40 + menu ⋮), no padrão da lista de webinars.
// Arquivar/Reativar não exclui: as sessões e as métricas do teste continuam.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ChartNoAxesColumn, Eye, ExternalLink, Pencil } from "lucide-react";
import { useToast } from "../_componentes/toast";
import { estiloBotaoIcone } from "../_componentes/ui";
import { BotaoCopiar } from "../_componentes/copiar";
import { MenuAcoes } from "../_componentes/menu-acoes";
import { arquivarTesteAb, reativarTesteAb } from "./actions";

export function AcoesTeste({ id, nome, link, arquivado }: { id: string; nome: string; link: string; arquivado: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [processando, setProcessando] = useState(false);

  async function alternar() {
    if (!arquivado && !(await toast.confirmar({ titulo: `Arquivar o teste "${nome}"?`, descricao: "O link deixa de funcionar até você reativar.", confirmar: "Arquivar", perigo: true }))) return;
    setProcessando(true);
    try {
      const r = arquivado ? await reativarTesteAb(id) : await arquivarTesteAb(id);
      if (r.erro) toast.erro(r.erro);
      else {
        toast.sucesso(arquivado ? "Teste reativado." : "Teste arquivado.");
        router.refresh();
      }
    } catch {
      toast.erro("Não deu para salvar. Tente de novo.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="flex items-center justify-end">
      <BotaoCopiar texto={link} />
      <Link href={`/testes-ab/${id}/editar`} aria-label="Editar" title="Editar" className={estiloBotaoIcone("tabela", "marca")}>
        <Pencil size={20} aria-hidden />
      </Link>
      <Link href={`/testes-ab/${id}/metricas`} aria-label="Métricas" title="Métricas" className={estiloBotaoIcone("tabela", "marca")}>
        <ChartNoAxesColumn size={20} aria-hidden />
      </Link>
      <MenuAcoes
        itens={[
          { rotulo: "Ver resumo", icone: Eye, href: `/testes-ab/${id}` },
          { rotulo: "Abrir link", icone: ExternalLink, href: link, externo: true },
          { rotulo: "Editar", icone: Pencil, href: `/testes-ab/${id}/editar` },
          { rotulo: "Métricas", icone: ChartNoAxesColumn, href: `/testes-ab/${id}/metricas` },
          arquivado
            ? { rotulo: "Reativar", icone: ArchiveRestore, aoClicar: () => void alternar(), desativado: processando }
            : { rotulo: "Arquivar", icone: Archive, aoClicar: () => void alternar(), perigo: true, desativado: processando },
        ]}
      />
    </div>
  );
}
