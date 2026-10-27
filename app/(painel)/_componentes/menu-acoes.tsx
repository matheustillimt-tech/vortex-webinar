"use client";
// Menu ⋮ das tabelas: botão de ícone 50×40 na cor de marca e lista de ações
// com ícone. Abre num portal com posição fixa, pra não ser cortado pela rolagem horizontal da tabela.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { EllipsisVertical } from "lucide-react";
import { Icone, type LucideIcon } from "./icone";
import { estiloBotaoIcone } from "./ui";

export type ItemMenuAcoes =
  | {
      rotulo: string;
      icone?: LucideIcon;
      /** Link interno (Next) ou externo (com `externo`). */
      href?: string;
      externo?: boolean;
      aoClicar?: () => void;
      perigo?: boolean;
      desativado?: boolean;
    }
  /** Linha divisória entre grupos (ex.: antes de "Arquivar"). */
  | { separador: true };

const ESTILO_ITEM =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-suave focus-visible:bg-suave disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4";

export function MenuAcoes({ itens, rotulo = "Mais ações", formato = "tabela", gatilho }: {
  itens: (ItemMenuAcoes | false | null | undefined)[];
  rotulo?: string;
  formato?: "tabela" | "quadrado";
  /** Conteúdo do botão no lugar do ⋮ (ex.: "Exportar" com chevron). Com ele o botão usa `classeGatilho`. */
  gatilho?: { conteudo: React.ReactNode; classe: string };
}) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const id = useId();
  const validos = itens.filter(Boolean) as ItemMenuAcoes[];

  useLayoutEffect(() => {
    if (!aberto || !botao.current) return;
    const r = botao.current.getBoundingClientRect();
    const altura = lista.current?.offsetHeight ?? 0;
    const caberEmbaixo = r.bottom + 4 + altura <= window.innerHeight || r.top - 4 - altura < 0;
    setPos({ top: caberEmbaixo ? r.bottom + 4 : r.top - 4 - altura, right: Math.max(8, window.innerWidth - r.right) });
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    // Foca o 1º item logo depois do commit: no primeiro render a lista ainda está invisível (sem posição) e não aceita foco.
    const quadro = window.setTimeout(() => lista.current?.querySelector<HTMLElement>("a, button:not([disabled])")?.focus());
    function fora(e: MouseEvent) {
      const alvo = e.target as Node;
      if (!lista.current?.contains(alvo) && !botao.current?.contains(alvo)) setAberto(false);
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAberto(false);
        botao.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const focaveis = [...(lista.current?.querySelectorAll<HTMLElement>("a, button:not([disabled])") ?? [])];
        const i = focaveis.indexOf(document.activeElement as HTMLElement);
        const prox = e.key === "ArrowDown" ? (i + 1) % focaveis.length : (i - 1 + focaveis.length) % focaveis.length;
        focaveis[prox]?.focus();
      }
    }
    function fechar() {
      setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", fechar);
    window.addEventListener("scroll", fechar, true);
    return () => {
      window.clearTimeout(quadro);
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", fechar);
      window.removeEventListener("scroll", fechar, true);
    };
  }, [aberto]);

  if (validos.length === 0) return null;

  return (
    <>
      <button
        ref={botao}
        type="button"
        aria-label={gatilho ? undefined : rotulo}
        title={gatilho ? undefined : rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setAberto((a) => !a);
        }}
        className={gatilho ? gatilho.classe : estiloBotaoIcone(formato, "marca")}
      >
        {gatilho ? gatilho.conteudo : <EllipsisVertical size={20} aria-hidden />}
      </button>
      {aberto &&
        createPortal(
          <div
            ref={lista}
            id={id}
            role="menu"
            style={{ position: "fixed", top: pos?.top ?? -9999, right: pos?.right ?? 0, visibility: pos ? "visible" : "hidden", animation: "vw-aparecer 120ms ease-out" }}
            aria-label={gatilho ? undefined : rotulo}
            className="z-50 min-w-[200px] max-w-[calc(100vw-1rem)] rounded-md border border-linha bg-superficie p-1 text-texto shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            {validos.map((item, i) => {
              if ("separador" in item) return <div key={`sep-${i}`} role="separator" className="-mx-1 my-1 h-px bg-linha" />;
              const conteudo = (
                <>
                  {item.icone && <Icone icone={item.icone} tamanho={16} className={item.perigo ? "text-erro" : "text-texto-3"} />}
                  <span className="truncate">{item.rotulo}</span>
                </>
              );
              const classe = `${ESTILO_ITEM} ${item.perigo ? "text-erro" : ""}`;
              if (item.href && !item.desativado) {
                return item.externo ? (
                  <a key={item.rotulo} role="menuitem" href={item.href} target="_blank" rel="noreferrer" className={classe} onClick={() => setAberto(false)}>
                    {conteudo}
                  </a>
                ) : (
                  <Link key={item.rotulo} role="menuitem" href={item.href} className={classe} onClick={() => setAberto(false)}>
                    {conteudo}
                  </Link>
                );
              }
              return (
                <button
                  key={item.rotulo}
                  type="button"
                  role="menuitem"
                  disabled={item.desativado}
                  className={classe}
                  onClick={() => {
                    setAberto(false);
                    item.aoClicar?.();
                  }}
                >
                  {conteudo}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
