// Prévias do assistente no tema claro da sala: a sala (player + selo Ao Vivo + aba Chat) do
// passo Vídeo e as linhas de chat/venda dos passos Chat e Vendas. Só desenho: sem estado nem dados de verdade da
// sala. Sem "use client" (servem a server e client components).
import { Eye, Play, ShoppingBag } from "lucide-react";

export type MensagemPrevia = { id?: string; momento?: string; nome: string; texto: string; suporte?: boolean };

/** Selo "Ao Vivo" (cor de marca, h 22, 10/600, cantos 2 px) + pílula branca com olho e número. */
function SeloAoVivo({ publico }: { publico: number | null }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex h-[22px] items-center rounded-sm bg-marca px-2 text-[10px] font-semibold uppercase tracking-wide text-white">Ao Vivo</span>
      {publico !== null && (
        <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-white px-2 text-[11px] font-semibold text-[#1f2937]">
          <Eye size={12} aria-hidden /> {publico.toLocaleString("pt-BR")}
        </span>
      )}
    </div>
  );
}

/** Linha de mensagem do chat da sala: nome 14,5/600 cinza, texto 13/500; suporte com faixa na cor de marca. */
export function LinhaChat({ m, compacta = false }: { m: MensagemPrevia; compacta?: boolean }) {
  if (m.suporte) {
    return (
      <div className={`rounded-md border-l-4 border-marca bg-marca-linha ${compacta ? "px-2 py-1.5" : "px-3 py-2"}`}>
        <p className="text-[13px] leading-5 text-texto">
          <span className="font-bold">{m.nome}</span>
          {m.momento && <span className="ml-1.5 text-[11px] font-normal tabular-nums text-texto-4">{m.momento}</span>}
        </p>
        <p className="whitespace-pre-line break-words text-[13px] font-medium leading-5 text-[rgba(2,2,2,.92)]">{m.texto}</p>
      </div>
    );
  }
  return (
    <div className={compacta ? "px-1 py-1" : "px-1 py-1.5"}>
      <p className="text-[14.5px] font-semibold leading-5 text-apagado">
        {m.nome}
        {m.momento && <span className="ml-1.5 text-[11px] font-normal tabular-nums text-texto-4">{m.momento}</span>}
      </p>
      <p className="whitespace-pre-line break-words text-[13px] font-medium leading-5 text-[rgba(2,2,2,.92)]">{m.texto}</p>
    </div>
  );
}

/** Notificação de compra simulada como aparece no chat da sala: faixa amarela com o título e o texto. */
export function LinhaVenda({ titulo, texto, momento }: { titulo: string; texto: string; momento?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-[#fde68a] bg-[#fef9c3] px-3 py-2">
      <ShoppingBag size={16} aria-hidden className="mt-0.5 shrink-0 text-[#a16207]" />
      <div className="min-w-0">
        <p className="text-[13px] font-bold leading-5 text-[#713f12]">
          {titulo}
          {momento && <span className="ml-1.5 text-[11px] font-normal tabular-nums text-[#a16207]">{momento}</span>}
        </p>
        <p className="break-words text-[13px] font-medium leading-5 text-[#713f12]">{texto}</p>
      </div>
    </div>
  );
}

/** Aba Chat da sala (TabsList cinza #D9D9D9 com a aba ativa branca). */
function AbasSala() {
  return (
    <div className="grid grid-cols-1 gap-1 rounded-md bg-[#d9d9d9] p-1 text-sm font-medium">
      <span className="rounded-sm bg-white py-1 text-center text-texto shadow-controle">Chat</span>
    </div>
  );
}

const EXEMPLO: MensagemPrevia[] = [
  { nome: "Ana", texto: "Boa noite, pessoal! 👋" },
  { nome: "Marcos", texto: "Chegando agora, de onde vocês são?" },
  { nome: "Suporte", texto: "Sejam bem-vindos! Qualquer dúvida, manda aqui no chat.", suporte: true },
  { nome: "Juliana", texto: "Muito bom esse conteúdo" },
];

/** Prévia da sala do passo Vídeo. `horizontal` = "Webinar" (player 16:9 com o chat embaixo, como na coluna estreita
 *  da sala); `vertical` = "Live" (no celular o vídeo ocupa a tela e o chat fica por cima). */
export function PreviaSala({ orientacao, capa, mensagens, publico, titulo }: {
  orientacao: "horizontal" | "vertical";
  capa: string | null;
  mensagens: MensagemPrevia[];
  publico: number | null;
  titulo: string;
}) {
  const lista = (mensagens.length > 0 ? mensagens : EXEMPLO).slice(0, 4);
  const fundo = capa ? { backgroundImage: `url(${JSON.stringify(capa)})` } : undefined;

  if (orientacao === "vertical") {
    return (
      <div className="mx-auto w-[230px] rounded-[28px] border-[6px] border-[#1f2937] bg-black shadow-lg">
        <div className="relative aspect-[9/16] overflow-hidden rounded-[22px] bg-[#111827] bg-cover bg-center" style={fundo}>
          {!capa && <Play size={36} aria-hidden className="absolute left-1/2 top-1/3 -translate-x-1/2 text-white/40" />}
          <div className="absolute left-2 top-2">
            <SeloAoVivo publico={publico} />
          </div>
          <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-2 pt-10">
            {lista.slice(-3).map((m, i) => (
              <p key={m.id ?? i} className="truncate text-[11px] leading-4 text-white">
                <span className="font-semibold">{m.nome}</span> {m.texto}
              </p>
            ))}
            <div className="mt-1 h-7 rounded-full bg-white/20 px-3 text-[11px] leading-7 text-white/70">Digite sua mensagem…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-linha bg-[#f9f9f9]">
      <p className="truncate px-3 py-2 text-sm font-semibold text-texto">{titulo}</p>
      <div className="relative aspect-video bg-[#111827] bg-cover bg-center" style={fundo}>
        {!capa && <Play size={40} aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/40" />}
        <div className="absolute left-2 top-2">
          <SeloAoVivo publico={publico} />
        </div>
      </div>
      <div className="space-y-2 bg-white p-3">
        <AbasSala />
        <div className="space-y-1">
          {lista.map((m, i) => (
            <LinhaChat key={m.id ?? i} m={m} compacta />
          ))}
        </div>
        <div className="h-9 rounded-md border border-borda px-3 text-sm leading-9 text-apagado">Digite sua mensagem…</div>
      </div>
    </div>
  );
}
