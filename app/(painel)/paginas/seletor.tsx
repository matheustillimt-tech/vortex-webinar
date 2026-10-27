"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Botao, Campo, estiloInput } from "../_componentes/ui";

export type OpcaoPagina = { id: string; nome: string; semFormulario?: boolean };
export type SeletorPagina = { campo: string; rotulo: string; tipo: string; valor: string | null; opcoes: OpcaoPagina[] };
type Resultado = { erro?: string; ok?: boolean };

/** Seletores de página vinculada (aba Just in time e Agenda). "Padrão" grava null; o servidor confere tipo e
 *  formulário (`validarVinculoPagina`). */
export function SeletoresPagina({ acao, seletores }: { acao: (estado: Resultado, form: FormData) => Promise<Resultado>; seletores: SeletorPagina[] }) {
  const [estado, salvar, salvando] = useActionState<Resultado, FormData>(acao, {});
  return (
    <form action={salvar} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {seletores.map((s) => (
          <Campo key={s.campo} rotulo={s.rotulo}>
            <select name={s.campo} className={estiloInput} defaultValue={s.valor ?? ""}>
              <option value="">Padrão (tela do sistema)</option>
              {s.opcoes.map((o) => (
                <option key={o.id} value={o.id} disabled={o.semFormulario && o.id !== s.valor}>
                  {o.nome}
                  {o.semFormulario ? " (sem formulário)" : ""}
                </option>
              ))}
            </select>
            <span className="flex gap-3 text-xs">
              <Link href={`/paginas/nova?tipo=${s.tipo}`} className="text-vg-accent hover:text-vg-accent-3">
                Criar nova página
              </Link>
              {s.valor && (
                <Link href={`/paginas/${s.valor}/editor`} className="text-vg-accent hover:text-vg-accent-3">
                  Editar a página escolhida
                </Link>
              )}
            </span>
          </Campo>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Botao disabled={salvando}>{salvando ? "Salvando…" : "Salvar páginas"}</Botao>
        {estado.erro && <p className="text-sm text-vg-erro">{estado.erro}</p>}
        {estado.ok && <p className="text-sm text-vg-ok">Páginas salvas.</p>}
      </div>
    </form>
  );
}
