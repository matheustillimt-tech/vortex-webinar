import type { Metadata } from "next";
// Material Icons: só os blocos do GrapesJS (plugin-vw.ts) ainda usam. O painel usa lucide-react.
import "@fontsource/material-icons/400.css";
import { exigirUsuario, membroAtual } from "@/src/lib/supabase/usuario";
import { ProvedorToast } from "../(painel)/_componentes/toast";

export const dynamic = "force-dynamic";

/** Painel é interno: nunca indexar (o layout raiz já diz isso; aqui fica explícito para não depender dele). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Telas de tela cheia do painel (editor de páginas): mesma autenticação do layout do painel, sem o menu lateral.
 *  Quem não é admin para no `exigirAdmin` da própria página. */
export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const usuario = await exigirUsuario();
  const membro = await membroAtual();
  if (!membro) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-fundo p-6 text-center text-sm text-texto-2">
        <p>Seu acesso ({usuario.email}) ainda não foi liberado. Fale com um administrador do sistema.</p>
      </main>
    );
  }
  return (
    <ProvedorToast>
      <div className="h-screen overflow-hidden bg-fundo text-sm text-texto">{children}</div>
    </ProvedorToast>
  );
}
