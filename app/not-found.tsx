import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { hostDaRequisicao } from "@/src/lib/regras/rota";
import { t } from "@/src/lib/regras/textos-sala";
import { Logo } from "./(painel)/_componentes/logo";
import { BotaoLink } from "./(painel)/_componentes/ui";

function hostSala(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SALA_URL ?? "").hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function ehSala(): Promise<boolean> {
  const host = hostDaRequisicao(await headers()).toLowerCase().split(":")[0];
  const sala = hostSala();
  return !!sala && host === sala;
}

export async function generateMetadata(): Promise<Metadata> {
  const titulo = (await ehSala()) ? "Página não encontrada" : `Página não encontrada · ${NOME_SISTEMA}`;
  return { title: titulo, robots: { index: false, follow: false } };
}

/** 404 de um endereço que não existe. Um app, dois domínios: no domínio da sala sai o visual da sala (fundo preto,
 *  sem marca); no do painel, o visual do painel com o caminho de volta. */
export default async function NaoEncontrado() {
  if (await ehSala()) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-center text-white">
        <p className="text-sm text-white/70">{t("pt-BR", "paginaNaoEncontrada")}</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-fundo px-4 py-12 text-sm text-texto">
      <div className="w-full max-w-[420px] space-y-6">
        <div className="flex justify-center">
          <Logo altura={32} />
        </div>
        <div className="space-y-6 rounded-lg border border-borda bg-superficie p-8 max-tela-sm:p-6">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold text-titulo">Página não encontrada</h1>
            <p className="text-sm text-texto-3">O endereço pode estar errado ou a página não existe mais.</p>
          </div>
          <BotaoLink href="/" className="w-full">Voltar ao início</BotaoLink>
        </div>
      </div>
    </main>
  );
}
