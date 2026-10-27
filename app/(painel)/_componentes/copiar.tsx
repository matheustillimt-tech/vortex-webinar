"use client";
// Copiar com toast "Link copiado!": botão de ícone das tabelas, botão com texto e a caixa de link do
// passo Pronto (e do modal "Links" da lista de webinars).
import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";
import type { LinkSala } from "@/src/lib/regras/links-sala";
import { useToast } from "./toast";
import { estiloBotao, estiloBotaoIcone } from "./ui";

/** Copia pela API do navegador; se ela falhar (página sem foco, contexto sem HTTPS), tenta o `execCommand` antigo. */
async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

export function useCopiar() {
  const toast = useToast();
  return async function copiar(texto: string, aviso = "Link copiado!") {
    if (await copiarTexto(texto)) {
      toast.sucesso(aviso);
      return true;
    }
    toast.erro("Não deu para copiar.", "Selecione o texto e copie na mão.");
    return false;
  };
}

/** `icone` = botão 50×40 da tabela (ícone de link na cor de marca); `botao` = botão secundário "Copiar". */
export function BotaoCopiar({ texto, rotulo = "Copiar link", formato = "icone", aviso }: { texto: string; rotulo?: string; formato?: "icone" | "botao"; aviso?: string }) {
  const copiar = useCopiar();
  const [ok, setOk] = useState(false);
  async function clicar() {
    if (await copiar(texto, aviso)) {
      setOk(true);
      window.setTimeout(() => setOk(false), 2000);
    }
  }
  if (formato === "botao") {
    return (
      <button type="button" onClick={() => void clicar()} className={estiloBotao("secundario")}>
        {ok ? <Check aria-hidden /> : <Copy aria-hidden />}
        {ok ? "Copiado!" : "Copiar"}
      </button>
    );
  }
  return (
    <button type="button" aria-label={rotulo} title={rotulo} onClick={() => void clicar()} className={estiloBotaoIcone("tabela", "marca")}>
      {ok ? <Check size={20} aria-hidden /> : <Link2 size={20} aria-hidden />}
    </button>
  );
}

/** Caixa cinza de largura total (38 px) com o link e o botão de copiar, e a descrição embaixo (passo Pronto
 *  do assistente). */
export function CaixaLink({ link }: { link: LinkSala }) {
  const copiar = useCopiar();
  const [ok, setOk] = useState(false);

  async function clicar() {
    if (await copiar(link.url)) {
      setOk(true);
      window.setTimeout(() => setOk(false), 2000);
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-rotulo">{link.rotulo}</p>
      <div className="flex h-[38px] min-w-0 items-center gap-2 rounded-md border border-linha bg-suave pl-3 pr-1">
        <input
          readOnly
          value={link.url}
          aria-label={link.rotulo}
          onFocus={(e) => e.currentTarget.select()}
          className="h-full min-w-0 flex-1 truncate bg-transparent text-sm text-texto-2 outline-none"
        />
        <button
          type="button"
          onClick={() => void clicar()}
          aria-label={`Copiar: ${link.rotulo}`}
          title="Copiar"
          className="inline-grid size-8 shrink-0 place-items-center rounded-md text-marca transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40"
        >
          {ok ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        </button>
      </div>
      {link.descricao && <p className="text-xs text-texto-3">{link.descricao}</p>}
    </div>
  );
}
