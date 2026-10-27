import type { Conversa, UltimaMensagem } from "@/src/lib/regras/atendimento";
import type { SessaoConversa } from "@/src/lib/atendimento";

/** Mesmo formato de `Conversa` (src/lib/regras/atendimento.ts), mas com datas em ISO — o que atravessa a
 *  fronteira servidor/cliente (props da página, JSON das rotas de leitura) usa só tipos simples. */
export type ConversaCliente = Omit<Conversa, "inicioSessao" | "ultimaMensagem"> & {
  inicioSessao: string;
  ultimaMensagem: (Omit<UltimaMensagem, "criadaEm"> & { criadaEm: string }) | null;
  /** % do vídeo que a pessoa já assistiu (0–100); `null` sem duração do vídeo. */
  assistidoPct: number | null;
};

export type SessaoConversaCliente = Omit<SessaoConversa, "inicioSessao"> & { inicioSessao: string };

export function conversaParaCliente(c: Conversa, assistido: Record<string, number | null> = {}): ConversaCliente {
  return {
    ...c,
    assistidoPct: assistido[c.sessaoId] ?? null,
    inicioSessao: c.inicioSessao.toISOString(),
    ultimaMensagem: c.ultimaMensagem ? { ...c.ultimaMensagem, criadaEm: c.ultimaMensagem.criadaEm.toISOString() } : null,
  };
}

export function sessaoConversaParaCliente(s: SessaoConversa): SessaoConversaCliente {
  return { ...s, inicioSessao: s.inicioSessao.toISOString() };
}
