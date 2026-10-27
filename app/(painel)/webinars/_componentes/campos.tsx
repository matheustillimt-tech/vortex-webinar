// Campos dos formulários do assistente que os primitivos do painel (`_componentes/ui.tsx`) ainda
// não têm: interruptor (switch do shadcn), cartões de opção (rádio em cartão ilustrado) e acordeão "Opções
// avançadas". Sem "use client": não têm estado próprio; funcionam em server e client component.
import { ChevronDown } from "lucide-react";

/** Switch do shadcn (44×24, trilho cinza → cor de marca, bolinha branca) sobre um checkbox de verdade: manda "on"
 *  no FormData como qualquer checkbox. `rotulo` à direita, `descricao` embaixo em 12 px. */
export function Interruptor({ rotulo, descricao, className = "", ...p }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  rotulo: React.ReactNode;
  descricao?: React.ReactNode;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 ${p.disabled ? "cursor-not-allowed opacity-60" : ""} ${className}`}>
      <span className="relative mt-px inline-flex h-6 w-11 shrink-0">
        <input type="checkbox" role="switch" {...p} className="peer absolute inset-0 z-10 m-0 size-full cursor-[inherit] opacity-0" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-passo transition-colors peer-checked:bg-marca peer-focus-visible:ring-2 peer-focus-visible:ring-marca/40 peer-focus-visible:ring-offset-1"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-6 text-rotulo">{rotulo}</span>
        {descricao && <span className="block text-xs text-texto-3">{descricao}</span>}
      </span>
    </label>
  );
}

export type OpcaoCartao<T extends string> = { valor: T; rotulo: string; descricao?: React.ReactNode; ilustracao?: React.ReactNode };

/** Rádio em cartões (formato do vídeo, layout da contagem…): borda slate-300, o escolhido com borda e anel na cor de
 *  marca. Grava `valor` no campo `nome` (input rádio de verdade). Controlado: passe `valor` e `aoMudar`. */
export function OpcoesCartao<T extends string>({ nome, opcoes, valor, aoMudar, colunas = 3 }: {
  nome: string;
  opcoes: OpcaoCartao<T>[];
  valor: T;
  aoMudar: (v: T) => void;
  colunas?: 2 | 3;
}) {
  return (
    <div role="radiogroup" className={`grid gap-3 ${colunas === 3 ? "grid-cols-3 max-tela-sm:grid-cols-1" : "grid-cols-2 max-tela-sm:grid-cols-1"}`}>
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <label
            key={o.valor}
            className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors ${ativo ? "border-marca bg-marca-linha ring-1 ring-marca" : "border-borda bg-superficie hover:bg-suave"}`}
          >
            <input type="radio" name={nome} value={o.valor} checked={ativo} onChange={() => aoMudar(o.valor)} className="sr-only" />
            {o.ilustracao}
            <span className="flex items-center gap-2 text-sm font-medium text-texto">
              <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded-full border ${ativo ? "border-marca" : "border-borda"}`}>
                {ativo && <span className="size-2 rounded-full bg-marca" />}
              </span>
              {o.rotulo}
            </span>
            {o.descricao && <span className="text-xs text-texto-3">{o.descricao}</span>}
          </label>
        );
      })}
    </div>
  );
}

/** Acordeão ("Opções avançadas"): linha com título e chevron, conteúdo embaixo. */
export function Acordeao({ titulo, aberto = false, children }: { titulo: string; aberto?: boolean; children: React.ReactNode }) {
  return (
    <details open={aberto} className="group rounded-lg border border-borda">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-texto [&::-webkit-details-marker]:hidden">
        {titulo}
        <ChevronDown size={16} aria-hidden className="text-texto-3 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-linha px-4 py-4">{children}</div>
    </details>
  );
}

/** Mensagem de erro/sucesso no fim do formulário do passo (logo acima do rodapé). */
export function AvisoFormulario({ erro, ok }: { erro?: string | null; ok?: string | null }) {
  if (!erro && !ok) return null;
  return (
    <p role={erro ? "alert" : "status"} className={`rounded-md px-3 py-2 text-sm ${erro ? "bg-erro-fundo text-[#991b1b]" : "bg-ok-fundo text-[#166534]"}`}>
      {erro ?? ok}
    </p>
  );
}
