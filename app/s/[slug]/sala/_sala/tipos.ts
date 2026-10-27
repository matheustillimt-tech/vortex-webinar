/** Mensagem privada (pergunta da pessoa e a resposta pra ela, no chat): tanto as já gravadas (carregadas no `page.tsx` via `minhasMensagens`) quanto
 *  as novas desta visita. `segundo` só existe nas novas — é a posição do vídeo no instante do envio, usada pra
 *  encaixar a mensagem no lugar certo dentro do feed misto da aba Chat (que mistura simuladas com as próprias). */
export type MensagemPrivada = {
  id: string;
  autor: "participante" | "atendente" | "chatbot" | "ia";
  texto: string | null;
  imagemUrl: string | null;
  criadaEm: string;
  /** Última atualização (edição/exclusão) — usada só pra paginar o polling de `/api/sala/suporte` (`desde`). */
  atualizadaEm?: string;
  segundo?: number;
  /** Nome a mostrar quando `autor !== "participante"` (ex.: o `remetente` configurado da regra do chatbot, ou o
   *  nome do atendente/agente de IA que respondeu). */
  nomeExibicao?: string;
  /** Apagada pelo atendente: `texto`/`imagemUrl` já vêm nulos do servidor; a sala mostra "Mensagem apagada". */
  apagada?: boolean;
};
