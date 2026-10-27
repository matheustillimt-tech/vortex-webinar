"use client";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { estiloBotao, type TamanhoBotao, type VarianteBotao } from "./ui";

/** Botão de envio dos formulários com server action direta (`<form action={...}>` sem `useActionState`): fica
 *  desativado e troca o texto enquanto o formulário envia, pra ninguém clicar duas vezes.
 *  Com `variante` (ou sem `className`), tem a cara do `Botao`; com só `className`, usa a classe dada (ações em texto
 *  de tabela, ex.: `estiloAcao.perigo`). */
export function BotaoEnvio({ children, pendente = "Salvando…", className, variante, tamanho, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pendente?: string;
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
}) {
  const { pending } = useFormStatus();
  const comCaraDeBotao = !!variante || !className;
  const classe = comCaraDeBotao ? `${estiloBotao(variante ?? "principal", tamanho)} ${className ?? ""}` : className;
  return (
    <button type="submit" {...p} disabled={pending || p.disabled} aria-busy={pending || undefined} className={`${classe} disabled:pointer-events-none disabled:opacity-50`}>
      {pending && comCaraDeBotao && <LoaderCircle className="animate-spin" aria-hidden />}
      {pending ? pendente : children}
    </button>
  );
}
