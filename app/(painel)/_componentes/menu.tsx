"use client";
import { NOME_SISTEMA } from "@/src/lib/marca";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, Clapperboard, FileText, Headset, History, LayoutDashboard, LogOut, Menu as IconeMenu, Settings, Split, Users, Video, X, type LucideIcon } from "lucide-react";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import { Logo, Simbolo } from "./logo";

export type ItemMenu = { href: string; rotulo: string; icone: LucideIcon; soAdmin?: boolean };

/**
 * Itens, nomes e ordem do menu. Ainda não há "Meu plano" nem "Ajuda"; o sino de notificações também não (não há central de notificações).
 */
export const ITENS_MENU: ItemMenu[] = [
  { href: "/", rotulo: "Dashboard", icone: LayoutDashboard },
  { href: "/webinars", rotulo: "Webinars", icone: Video, soAdmin: true },
  { href: "/testes-ab", rotulo: "Teste A/B", icone: Split, soAdmin: true },
  { href: "/paginas", rotulo: "Páginas", icone: FileText, soAdmin: true },
  { href: "/videos", rotulo: "Vídeos", icone: Clapperboard, soAdmin: true },
  { href: "/atendimento", rotulo: "Salas de Atendimento", icone: Headset },
  { href: "/historico", rotulo: "Histórico de ações", icone: History, soAdmin: true },
  { href: "/equipe", rotulo: "Usuários", icone: Users, soAdmin: true },
  { href: "/configuracoes", rotulo: "Configurações", icone: Settings, soAdmin: true },
];

const CHAVE_RECOLHIDO = "vw:menu-recolhido";

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const [a, b] = [partes[0], partes.length > 1 ? partes[partes.length - 1] : ""];
  return (a[0] + (b[0] ?? a[1] ?? "")).toUpperCase();
}

function ativoEm(caminho: string, href: string): boolean {
  return href === "/" ? caminho === "/" : caminho === href || caminho.startsWith(`${href}/`);
}

type Props = { papel: "admin" | "atendente" | null; nome: string; email: string; versao: string };

/**
 * Casca do painel:
 * - acima de 900 px, menu lateral fixo de 256 px (recolhível pra 68 px, estado salvo no navegador);
 * - até 900 px, barra de topo de 64 px (logo + hambúrguer) e o menu numa gaveta da esquerda (75%, overlay 80%).
 */
export function Menu({ papel, nome, email, versao }: Props) {
  const caminho = usePathname();
  const [recolhido, setRecolhido] = useState(false);
  // Só anima quando a pessoa clica; ao carregar, o estado salvo entra sem animação.
  const [animar, setAnimar] = useState(false);
  const [gaveta, setGaveta] = useState(false);

  useEffect(() => {
    try {
      setRecolhido(window.localStorage.getItem(CHAVE_RECOLHIDO) === "1");
    } catch {
      // Sem acesso ao armazenamento (janela anônima, bloqueio): fica aberto.
    }
  }, []);

  // Fecha a gaveta ao trocar de tela.
  useEffect(() => setGaveta(false), [caminho]);

  useEffect(() => {
    if (!gaveta) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setGaveta(false);
    document.addEventListener("keydown", tecla);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", tecla);
    };
  }, [gaveta]);

  function alternar() {
    setAnimar(true);
    setRecolhido((r) => {
      try {
        window.localStorage.setItem(CHAVE_RECOLHIDO, r ? "0" : "1");
      } catch {
        // ignora: o estado vale só até recarregar
      }
      return !r;
    });
  }

  const itens = ITENS_MENU.filter((i) => !i.soAdmin || papel === "admin");

  return (
    <>
      {/* Desktop: menu lateral fixo */}
      <aside
        className={`sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-linha bg-superficie tela-md:flex ${recolhido ? "w-[68px]" : "w-64"} ${animar ? "transition-[width] duration-[320ms] ease-in-out" : ""}`}
      >
        <button
          type="button"
          onClick={alternar}
          aria-label={recolhido ? "Abrir menu" : "Recolher menu"}
          aria-expanded={!recolhido}
          className="absolute -right-3 top-8 z-10 grid size-6 place-items-center rounded-full border border-linha bg-superficie text-texto-3 shadow-controle transition-colors hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40"
        >
          <ChevronLeft size={16} aria-hidden className={`transition-transform duration-[320ms] ${recolhido ? "rotate-180" : ""}`} />
        </button>
        <div className={`flex h-[92px] shrink-0 items-start overflow-hidden pt-8 ${recolhido ? "justify-center px-0" : "px-5"}`}>
          <Link href="/" aria-label={`${NOME_SISTEMA}, ir para o Dashboard`} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40">
            {recolhido ? <Simbolo tamanho={32} /> : <Logo altura={28} />}
          </Link>
        </div>
        <ConteudoMenu itens={itens} caminho={caminho} recolhido={recolhido} nome={nome} email={email} versao={versao} />
      </aside>

      {/* Celular e tablet (até 900 px): barra de topo + gaveta */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-linha bg-superficie px-4 tela-md:hidden">
        <Link href="/" aria-label={`${NOME_SISTEMA}, ir para o Dashboard`}>
          <Logo altura={24} />
        </Link>
        <button
          type="button"
          onClick={() => setGaveta(true)}
          aria-label="Abrir menu"
          aria-expanded={gaveta}
          aria-controls="gaveta-menu"
          className="grid size-10 place-items-center rounded-md text-texto transition-colors hover:bg-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40"
        >
          <IconeMenu size={24} aria-hidden />
        </button>
      </header>
      {gaveta && (
        <div className="fixed inset-0 z-50 tela-md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-overlay" style={{ animation: "vw-aparecer 150ms ease-out" }} onClick={() => setGaveta(false)} aria-hidden />
          <div id="gaveta-menu" className="absolute inset-y-0 left-0 flex w-3/4 max-w-sm flex-col border-r border-linha bg-superficie shadow-lg">
            <div className="flex h-16 shrink-0 items-center justify-between px-5">
              <Logo altura={24} />
              <button
                type="button"
                onClick={() => setGaveta(false)}
                aria-label="Fechar menu"
                autoFocus
                className="grid size-9 place-items-center rounded-md text-texto-3 transition-colors hover:bg-suave hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
            <ConteudoMenu itens={itens} caminho={caminho} recolhido={false} nome={nome} email={email} versao={versao} />
          </div>
        </div>
      )}
    </>
  );
}

function ConteudoMenu({ itens, caminho, recolhido, nome, email, versao }: { itens: ItemMenu[]; caminho: string; recolhido: boolean; nome: string; email: string; versao: string }) {
  const router = useRouter();

  async function sair() {
    await dbNavegador().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <nav aria-label="Menu principal" className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-2 ${recolhido ? "items-center px-0" : "px-3"}`}>
        {itens.map((i) => {
          const ativo = ativoEm(caminho, i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              title={recolhido ? i.rotulo : undefined}
              aria-label={recolhido ? i.rotulo : undefined}
              aria-current={ativo ? "page" : undefined}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-md p-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40 ${recolhido ? "w-9 justify-center" : "w-full"} ${ativo ? "bg-suave text-texto" : "text-texto-2 hover:bg-suave hover:text-texto"}`}
            >
              <i.icone size={20} aria-hidden className={`shrink-0 ${ativo ? "text-marca" : ""}`} />
              {!recolhido && <span className="truncate">{i.rotulo}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={`shrink-0 border-t border-linha py-4 ${recolhido ? "px-0" : "px-4"}`}>
        <div className={`flex items-center gap-2 ${recolhido ? "flex-col" : ""}`}>
          <span
            title={recolhido ? `${nome} · ${email}` : undefined}
            aria-hidden={!recolhido}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-marca text-sm font-semibold text-white"
          >
            {iniciais(nome || email)}
          </span>
          {!recolhido && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-texto">{nome}</p>
              <p className="truncate text-xs text-texto-4">{email}</p>
            </div>
          )}
          <button
            type="button"
            onClick={sair}
            aria-label="Sair"
            title="Sair"
            className="grid size-9 shrink-0 place-items-center rounded-md text-texto-3 transition-colors hover:bg-suave hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40"
          >
            <LogOut size={20} aria-hidden />
          </button>
        </div>
        <p className={`mt-3 text-nota text-texto-4 ${recolhido ? "text-center" : ""}`}>{recolhido ? `v${versao}` : `Versão ${versao}`}</p>
      </div>
    </>
  );
}
