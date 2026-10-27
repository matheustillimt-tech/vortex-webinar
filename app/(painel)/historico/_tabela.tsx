"use client";
import { useState } from "react";
import { Eye } from "lucide-react";
import { camposAlterados } from "@/src/lib/regras/auditoria";
import { Modal } from "../_componentes/modal";
import { BotaoIcone, estiloCelula, Selo, Tabela, type CorSelo } from "../_componentes/ui";

export type LinhaHistorico = {
  id: string;
  criado_em: string;
  acao: "criou" | "editou" | "excluiu";
  descricao: string;
  usuario_nome: string | null;
  webinar_nome: string | null;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
};

const ACAO_COR: Record<LinhaHistorico["acao"], CorSelo> = { criou: "ok", editou: "destaque", excluiu: "erro" };
const ACAO_TEXTO: Record<LinhaHistorico["acao"], string> = { criou: "Criou", editou: "Editou", excluiu: "Deletou" };

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function Valor({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-texto-4">—</span>;
  if (typeof v === "boolean") return <>{v ? "Sim" : "Não"}</>;
  if (typeof v === "object") return <code className="break-all text-xs">{JSON.stringify(v)}</code>;
  return <>{String(v)}</>;
}

function Detalhe({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 border-b border-linha py-2 last:border-0 max-tela-sm:grid-cols-1">
      <dt className="text-texto-3">{rotulo}</dt>
      <dd className="min-w-0 break-words text-texto">{children}</dd>
    </div>
  );
}

/** Linha do histórico; o olho abre o modal de detalhes (código, data, descrição e, se houver, o antes/depois de cada
 *  campo que mudou). */
function LinhaDetalhavel({ linha, comWebinar }: { linha: LinhaHistorico; comWebinar: boolean }) {
  const [aberto, setAberto] = useState(false);
  const alterados = aberto ? camposAlterados(linha.antes, linha.depois) : [];

  return (
    <tr>
      <td className={`${estiloCelula} py-3`}>{linha.usuario_nome ?? "—"}</td>
      <td className={`${estiloCelula} whitespace-nowrap`}>{formatarData(linha.criado_em)}</td>
      {comWebinar && <td className={`${estiloCelula} max-w-[220px] truncate`}>{linha.webinar_nome ?? "—"}</td>}
      <td className={estiloCelula}>
        <Selo cor={ACAO_COR[linha.acao]}>{ACAO_TEXTO[linha.acao]}</Selo>
      </td>
      <td className={`${estiloCelula} min-w-[240px]`}>{linha.descricao}</td>
      <td className={`${estiloCelula} text-right`}>
        <BotaoIcone rotulo="Ver detalhes" icone={Eye} formato="tabela" cor="marca" onClick={() => setAberto(true)} />
        <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Detalhes da ação" largura="lg">
          <dl className="text-left text-sm">
            <Detalhe rotulo="Código">
              <code className="text-xs">{linha.id}</code>
            </Detalhe>
            <Detalhe rotulo="Criado em">{formatarData(linha.criado_em)}</Detalhe>
            <Detalhe rotulo="Usuário">{linha.usuario_nome ?? "—"}</Detalhe>
            {comWebinar && <Detalhe rotulo="Webinar">{linha.webinar_nome ?? "—"}</Detalhe>}
            <Detalhe rotulo="Descrição">{linha.descricao}</Detalhe>
          </dl>
          {alterados.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-linha text-left">
              <table className="w-full text-xs">
                <thead className="bg-suave text-left text-texto-4">
                  <tr>
                    <th className="px-3 py-2 font-medium">Campo</th>
                    <th className="px-3 py-2 font-medium">Antes</th>
                    <th className="px-3 py-2 font-medium">Novas informações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-linha">
                  {alterados.map((c) => (
                    <tr key={c.campo}>
                      <td className="px-3 py-2 font-medium">{c.campo}</td>
                      <td className="px-3 py-2">
                        <Valor v={c.antes} />
                      </td>
                      <td className="px-3 py-2">
                        <Valor v={c.depois} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-left text-sm text-texto-3">Esta ação não guardou campos alterados.</p>
          )}
        </Modal>
      </td>
    </tr>
  );
}

export function TabelaHistorico({ linhas, comWebinar = true }: { linhas: LinhaHistorico[]; comWebinar?: boolean }) {
  const acao = <span key="acao" className="block text-right">Ação</span>;
  const colunas = comWebinar ? ["Usuário", "Data", "Webinar", "Histórico de ação", "Descrição", acao] : ["Usuário", "Data", "Histórico de ação", "Descrição", acao];
  return (
    <Tabela semBorda colunas={colunas} vazio={linhas.length === 0 ? "Sem resultados." : undefined}>
      {linhas.map((l) => (
        <LinhaDetalhavel key={l.id} linha={l} comWebinar={comWebinar} />
      ))}
    </Tabela>
  );
}
