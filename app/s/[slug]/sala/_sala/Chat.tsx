"use client";
import { useEffect, useRef } from "react";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import type { LinhaMensagem, LinhaVenda } from "./useLinhaDoTempo";
import type { MensagemPrivada } from "./tipos";
import { FaixaVenda, ItemMensagem, type TipoMensagem } from "./Mensagem";

type Props = {
  idioma: Idioma;
  participanteNome: string;
  mensagensSimuladas: LinhaMensagem[];
  vendasVisiveis: LinhaVenda[];
  mensagensPrivadas: MensagemPrivada[];
  /** Sala vertical (Live): mensagens por cima do vídeo, em branco. */
  live?: boolean;
};

type ItemFeed =
  | { tipo: "mensagem"; chave: string; segundo: number; nome: string; texto: string; imagemUrl: string | null; estilo: TipoMensagem; mencao?: string }
  | { tipo: "venda"; chave: string; segundo: number; texto: string };

const PROXIMO_AO_FIM_PX = 80;
const VOLTA_PRO_FIM_MS = 3000;

/** Feed misto da aba Chat: mensagens simuladas (nome cinza), as suas próprias (nome na cor de marca), as respostas
 *  da IA/atendente a você (faixa verde da equipe, começando com `@SeuNome`) e vendas
 *  simuladas (faixa amarela) — tudo na ordem em que foi aparecendo no vídeo. Só exibição; quem envia é o campo em
 *  `Sala.tsx`. As suas mensagens e as respostas só aparecem pra você (cada sessão é individual). */
export default function Chat({ idioma, participanteNome, mensagensSimuladas, vendasVisiveis, mensagensPrivadas, live = false }: Props) {
  const listaRef = useRef<HTMLDivElement | null>(null);
  const rolouParaCimaRef = useRef(false);
  const voltarRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const primeiroNome = participanteNome.trim().split(/\s+/)[0] ?? "";

  const feed: ItemFeed[] = [
    ...mensagensSimuladas.map((m, i) => ({
      tipo: "mensagem" as const,
      chave: `s-${m.segundo}-${i}`,
      segundo: m.segundo,
      nome: m.nome,
      texto: m.texto,
      imagemUrl: null,
      estilo: (m.suporte ? "destaque" : "normal") as TipoMensagem,
    })),
    ...mensagensPrivadas
      .filter((m) => m.segundo !== undefined)
      .map((m) => ({
        tipo: "mensagem" as const,
        chave: m.id,
        segundo: m.segundo ?? 0,
        nome: m.autor === "participante" ? `${participanteNome} (${t(idioma, "eu")})` : m.nomeExibicao ?? t(idioma, "suporte"),
        texto: m.apagada ? t(idioma, "mensagemApagada") : m.texto ?? "",
        imagemUrl: m.apagada ? null : m.imagemUrl,
        estilo: (m.autor === "participante" ? "eu" : "destaque") as TipoMensagem,
        // Resposta pra pessoa: marca ela (se o próprio texto já não começa marcando alguém).
        mencao: m.autor !== "participante" && !m.apagada && primeiroNome && !(m.texto ?? "").trimStart().startsWith("@") ? primeiroNome : undefined,
      })),
    ...vendasVisiveis.map((v, i) => ({ tipo: "venda" as const, chave: `v-${v.segundo}-${i}`, segundo: v.segundo, texto: v.texto })),
  ].sort((a, b) => a.segundo - b.segundo);

  // Mensagem nova: desce pro fim, a não ser que a pessoa tenha rolado pra cima pra ler.
  useEffect(() => {
    const el = listaRef.current;
    if (el && !rolouParaCimaRef.current) el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  useEffect(() => () => {
    if (voltarRef.current) clearTimeout(voltarRef.current);
  }, []);

  // Rolou pra cima: 3 s depois da última rolagem, volta pro fim — o timer é da rolagem, não das mensagens, então
  // funciona mesmo com mensagens chegando o tempo todo.
  function aoRolar() {
    const el = listaRef.current;
    if (!el) return;
    rolouParaCimaRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > PROXIMO_AO_FIM_PX;
    if (voltarRef.current) clearTimeout(voltarRef.current);
    voltarRef.current = null;
    if (!rolouParaCimaRef.current) return;
    voltarRef.current = setTimeout(() => {
      voltarRef.current = null;
      rolouParaCimaRef.current = false;
      if (listaRef.current) listaRef.current.scrollTop = listaRef.current.scrollHeight;
    }, VOLTA_PRO_FIM_MS);
  }

  return (
    <div
      ref={listaRef}
      onScroll={aoRolar}
      className={
        live
          ? "flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-2 [mask-image:linear-gradient(to_bottom,transparent,black_28px)]"
          : "flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3"
      }
    >
      {feed.map((item) =>
        item.tipo === "venda" ? (
          <FaixaVenda key={item.chave} texto={item.texto} live={live} />
        ) : (
          <ItemMensagem key={item.chave} nome={item.nome} texto={item.texto} imagemUrl={item.imagemUrl} tipo={item.estilo} mencao={item.mencao} live={live} />
        ),
      )}
    </div>
  );
}
