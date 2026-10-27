"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { estiloBotao } from "../../_componentes/ui";

/* Peças cliente do assistente (12 passos). O rodapé "Voltar / Continuar" fica fora do `<form>` do passo (no fim do
 * cartão), então o "Continuar" é um `<button form="…">` que envia o formulário pelo atributo `form` e manda
 * `name="proximo"` com a rota do passo seguinte; a action salva e redireciona (ver `webinars/[id]/_proximo.ts`).
 * O formulário avisa que está enviando por `useEnvioPasso`, e o botão mostra o giro. */

type EstadoEnvio = { enviando: boolean; marcar: (v: boolean) => void };
const ContextoEnvio = createContext<EstadoEnvio | null>(null);

/** Envolve o conteúdo do cartão do passo (formulário + rodapé). */
export function ProvedorEnvioPasso({ children }: { children: React.ReactNode }) {
  const [enviando, marcar] = useState(false);
  return <ContextoEnvio.Provider value={{ enviando, marcar }}>{children}</ContextoEnvio.Provider>;
}

/** Chame no formulário principal do passo com o `enviando` do `useActionState`. */
export function useEnvioPasso(enviando: boolean) {
  const ctx = useContext(ContextoEnvio);
  const marcar = ctx?.marcar;
  useEffect(() => {
    marcar?.(enviando);
  }, [enviando, marcar]);
}

/** "Continuar" (contorno #14532D, 114 px): envia o formulário `form` com `proximo` = `destino`. */
export function BotaoContinuar({ form, destino, rotulo = "Continuar" }: { form: string; destino: string; rotulo?: string }) {
  const enviando = useContext(ContextoEnvio)?.enviando ?? false;
  return (
    <button
      type="submit"
      form={form}
      name="proximo"
      value={destino}
      disabled={enviando}
      aria-busy={enviando || undefined}
      className={`${estiloBotao("contorno")} min-w-[114px]`}
    >
      {enviando && <LoaderCircle className="animate-spin" aria-hidden />}
      {enviando ? "Salvando…" : rotulo}
    </button>
  );
}

/** No celular o stepper rola na horizontal: traz o passo atual pro meio da faixa ao abrir. */
export function RolarPassoAtual() {
  const ancora = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const nav = ancora.current?.parentElement?.querySelector("nav");
    const atual = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !atual || nav.scrollWidth <= nav.clientWidth) return;
    const a = atual.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    nav.scrollLeft += a.left + a.width / 2 - (n.left + n.width / 2);
  }, []);
  return <span ref={ancora} hidden />;
}
