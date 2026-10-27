import { LockKeyhole, ShieldCheck } from "lucide-react";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import type { SalaTelaLogin } from "@/src/lib/sala/dados";

// Peças visuais da sala do participante: tema
// claro, fundo #F9F9F9, cartão branco de 590 px (raio 12, sombra 0 4px 6px rgba(0,0,0,.09), padding 40; no celular
// largura total e sem raio), label 14/500, input h 40 / 16 px / raio 6, botão h 48 / 18 px / 500.
// Só apresentação: nada de estado nem regra aqui, para servir a páginas do servidor e do cliente.

/** Fundo da sala. */
export const FUNDO_SALA = "bg-[#F9F9F9]";

/** Input da sala: h 40, 16 px (no iOS, menos que 16 px dá zoom ao focar), raio 6, borda slate-300. */
export const CAMPO_SALA =
  "h-10 w-full rounded-md border border-borda bg-white px-3 text-base text-texto shadow-controle outline-none transition-[border-color,box-shadow] placeholder:text-apagado focus:border-marca focus:ring-2 focus:ring-marca/20 disabled:cursor-not-allowed disabled:opacity-60";

/** Botão principal da sala: h 48, 18 px / 500, raio 6. A cor vem por `style` (configurada no passo Login). */
export const BOTAO_SALA =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-md px-4 text-lg font-medium transition-[filter,opacity] hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-60";

/** Botão secundário (branco com borda), mesma altura do principal. */
export const BOTAO_SECUNDARIO_SALA =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-borda bg-white px-4 text-base font-medium text-texto shadow-controle transition-colors hover:bg-suave";

/** Botão na cor de marca (telas sem cor configurada: confirmação, encerrada, erro). */
export const BOTAO_MARCA_SALA = `${BOTAO_SALA} bg-marca text-white`;

/** Link discreto (outro horário, voltar). */
export const LINK_SALA = "text-sm font-medium text-marca underline-offset-2 hover:underline";

/** Tela centralizada com o cartão branco de 590 px. No celular (≤ 639 px) o cartão ocupa a tela toda, sem raio. */
export function TelaCartao({
  children,
  alinhamento = "items-stretch",
  largura = "max-w-[590px]",
  rotulo,
}: {
  children: React.ReactNode;
  /** Alinhamento horizontal do conteúdo do cartão (o logo segue o `align_logo`). */
  alinhamento?: string;
  largura?: string;
  /** `aria-label` do `<main>`, quando a tela não tem título visível. */
  rotulo?: string;
}) {
  return (
    <main
      aria-label={rotulo}
      className={`flex min-h-dvh w-full items-center justify-center ${FUNDO_SALA} px-4 py-10 max-tela-sm:items-stretch max-tela-sm:p-0`}
    >
      <div
        className={`flex w-full ${largura} flex-col ${alinhamento} gap-6 rounded-xl bg-white p-10 text-texto shadow-cartao-sala max-tela-sm:max-w-none max-tela-sm:rounded-none max-tela-sm:px-5 max-tela-sm:py-8`}
      >
        {children}
      </div>
    </main>
  );
}

/** Campo com label (14 px / 500, cor de rótulo). */
export function CampoSala({ rotulo, children }: { rotulo?: string; children: React.ReactNode }) {
  if (!rotulo) return <>{children}</>;
  return (
    <label className="flex w-full flex-col gap-2">
      <span className="text-sm font-medium text-rotulo">{rotulo}</span>
      {children}
    </label>
  );
}

/** Selos "SITE SEGURO" e "PRIVACIDADE PROTEGIDA" (11 px / 600, maiúsculas, com ícones). */
export function SelosSeguranca({ idioma, className = "" }: { idioma: Idioma; className?: string }) {
  return (
    <div className={`flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] font-semibold tracking-wide text-texto-4 uppercase ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <ShieldCheck aria-hidden size={14} className="text-marca" />
        {t(idioma, "siteSeguro")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LockKeyhole aria-hidden size={14} className="text-marca" />
        {t(idioma, "privacidade")}
      </span>
    </div>
  );
}

/** Ícone redondo de status no topo de um cartão (fundo da marca claro, ícone na cor de marca). */
export function IconeStatus({ children, tom = "marca" }: { children: React.ReactNode; tom?: "marca" | "neutro" }) {
  const cores = tom === "marca" ? "bg-marca-clara text-marca" : "bg-suave text-texto-3";
  return <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${cores}`}>{children}</div>;
}

/** Tela de aviso curta (indisponível, 404, erro, encerrada, cheia): ícone, título, texto e ações no cartão. */
export function TelaAviso({
  icone,
  tom,
  titulo,
  texto,
  children,
}: {
  icone: React.ReactNode;
  tom?: "marca" | "neutro";
  titulo: string;
  texto?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <TelaCartao largura="max-w-[480px]" alinhamento="items-center">
      <IconeStatus tom={tom}>{icone}</IconeStatus>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold text-titulo">{titulo}</h1>
        {texto && <p className="text-base text-texto-3">{texto}</p>}
      </div>
      {children && <div className="flex w-full flex-col items-center gap-3">{children}</div>}
    </TelaCartao>
  );
}

/** Hex válido (`#rgb`/`#rrggbb`) ou o padrão: a cor configurada só vale se for um hex válido. */
export function corOuPadrao(cor: string | null | undefined, padrao: string): string {
  return cor && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(cor.trim()) ? cor.trim() : padrao;
}

/** Logo do passo Login: largura total (banner na largura dos campos, altura pela proporção da imagem, cantos
 * arredondados) ou caixa de 220 × 100, alinhada pelo `align_logo`. */
export function LogoSala({ url, larguraTotal, alinhamento }: { url: string; larguraTotal: boolean; alinhamento: SalaTelaLogin["logoAlinhamento"] }) {
  const lado = alinhamento === "esquerda" ? "justify-start" : alinhamento === "direita" ? "justify-end" : "justify-center";
  return (
    <div className={`flex w-full ${lado}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className={larguraTotal ? "block h-auto w-full rounded-lg" : "max-h-[100px] max-w-[220px] object-contain"} />
    </div>
  );
}
