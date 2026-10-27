import type { Metadata, Viewport } from "next";
import { metadadosCompartilhamento } from "@/src/lib/sala/metadados";
import { carregarSalaCached as carregarSala } from "@/src/lib/sala/dados";
import Diagnostico from "./_ui/Diagnostico";

/** No celular, o teclado encolhe a área do layout (Android/Chrome) em vez de só cobrir a página: a sala, que ocupa
 *  `100dvh` com o campo de mensagem preso embaixo, continua com o campo visível acima do teclado. No iOS, que ignora
 *  isso, a sala acompanha o `visualViewport` (ver `useAlturaVisivel` na sala). */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  themeColor: "#F9F9F9",
};

/** Título padrão de toda página da sala (espera, inscrito, cheia, erro…): o da aula, nunca o nome do sistema — quem
 *  entra não pode ler "Webinar" na aba. Cada página ainda pode sobrescrever (prévia configurada, página do editor). */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const sala = await carregarSala(slug).catch(() => null);
  return sala ? metadadosCompartilhamento(sala) : { title: "Aula" };
}

/** Tema claro (fundo #F9F9F9, Inter 16 px, texto escuro) e `lang` da sala (o idioma do webinar,
 *  não necessariamente o do painel). O `<html>` em si é definido só no layout raiz — Next não deixa um layout
 *  aninhado redefini-lo —, então o `lang` aqui fica no wrapper (ainda assim válido e respeitado por leitores de
 *  tela). */
export default async function LayoutSala({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sala = await carregarSala(slug);
  const idioma = sala?.webinar.idioma ?? "pt-BR";

  return (
    <div lang={idioma} className="min-h-dvh bg-[#F9F9F9] font-sans text-base text-texto">
      <Diagnostico />
      {children}
    </div>
  );
}
