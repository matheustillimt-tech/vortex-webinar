import { Brain, Flag, Gift, LogIn, MessageSquareMore, MonitorPlay, Rocket, Video, Wallet, type LucideIcon } from "lucide-react";
import { numeroPasso, rotaPasso, rotaProximoPasso, type ChavePasso } from "@/src/lib/regras/assistente";
import { RodapeAssistente, Stepper } from "../../_componentes/stepper";
import { BotaoLink, Cartao, Pagina } from "../../_componentes/ui";
import { BotaoContinuar, ProvedorEnvioPasso, RolarPassoAtual } from "../_componentes/assistente";

export type { ChavePasso };

/** Os 9 passos do assistente, com rótulos e ícones. As rotas usam as chaves abaixo
 *  (o passo "Webinar" é `/agenda`). Integrações ficam em Configurações e o chatbot saiu (só o agente de IA responde); a audiência fica no passo Vídeo. `disponivel: false` = tela ainda não construída ("em breve"). */
export const PASSOS: { chave: ChavePasso; numero: number; rotulo: string; icone: LucideIcon; disponivel: boolean }[] = [
  { chave: "inicio", numero: 1, rotulo: "Início", icone: Flag, disponivel: true },
  { chave: "agenda", numero: 2, rotulo: "Webinar", icone: MonitorPlay, disponivel: true },
  { chave: "login", numero: 3, rotulo: "Login", icone: LogIn, disponivel: true },
  { chave: "video", numero: 4, rotulo: "Vídeo", icone: Video, disponivel: true },
  { chave: "oferta", numero: 5, rotulo: "Oferta", icone: Gift, disponivel: true },
  { chave: "chat", numero: 6, rotulo: "Chat", icone: MessageSquareMore, disponivel: true },
  { chave: "vendas", numero: 7, rotulo: "Vendas", icone: Wallet, disponivel: true },
  { chave: "agente", numero: 8, rotulo: "Agente de IA", icone: Brain, disponivel: true },
  { chave: "pronto", numero: 9, rotulo: "Pronto", icone: Rocket, disponivel: true },
];

/** Stepper do topo. No celular a faixa rola na horizontal (com o passo atual centralizado) e, embaixo dela, aparece
 *  "Passo X de 9 · Rótulo". */
export function Passos({ webinarId, atual }: { webinarId: string; atual: ChavePasso }) {
  const passo = PASSOS.find((p) => p.chave === atual);
  return (
    <div>
      <Stepper
        rotulo="Passos do webinar"
        atual={atual}
        passos={PASSOS.map((p) => ({ chave: p.chave, rotulo: p.rotulo, icone: p.icone, href: p.disponivel ? rotaPasso(webinarId, p.chave) : undefined }))}
      />
      <RolarPassoAtual />
      <p className="mt-2 hidden text-center text-sm text-texto-3 max-tela-md:block">
        Passo <span className="font-semibold text-texto">{numeroPasso(atual)}</span> de {PASSOS.length}
        {passo && <> · <span className="font-medium text-marca">{passo.rotulo}</span></>}
      </p>
    </div>
  );
}

/** Rodapé "Voltar / Continuar" de um passo. "Voltar" leva ao passo anterior.
 *  - `formulario` (id do `<form>` principal do passo): "Continuar" salva esse formulário e avança.
 *  - sem `formulario` (passos de listas, em que cada ação já salva na hora): "Continuar" só avança.
 *  - no último passo, vira "Concluir" (volta pra lista de webinars). */
export function RodapePassos({ webinarId, atual, formulario }: { webinarId: string; atual: ChavePasso; formulario?: string }) {
  const i = PASSOS.findIndex((p) => p.chave === atual);
  const anterior = i > 0 ? PASSOS[i - 1] : null;
  const proximo = rotaProximoPasso(webinarId, atual);
  return (
    <RodapeAssistente voltar={anterior ? rotaPasso(webinarId, anterior.chave) : "/webinars"}>
      {!proximo ? (
        <BotaoLink href="/webinars" variante="contorno" className="min-w-[114px]">
          Concluir
        </BotaoLink>
      ) : formulario ? (
        <BotaoContinuar form={formulario} destino={proximo} />
      ) : (
        <BotaoLink href={proximo} variante="contorno" className="min-w-[114px]">
          Continuar
        </BotaoLink>
      )}
    </RodapeAssistente>
  );
}

/** Próximo passo (pra o "Continuar" saber pra onde ir). */
export function proximoPasso(atual: ChavePasso, webinarId: string): string | null {
  return rotaProximoPasso(webinarId, atual);
}

/** Id do formulário principal de cada passo (o "Continuar" envia esse). */
export const FORM_PASSO = "form-passo";

/** Casca de um passo: sem título nem migalha (o stepper é a primeira coisa da tela), conteúdo num
 *  cartão branco único com padding de 32 px e o rodapé "Voltar / Continuar" no fim. `formulario` = id do formulário
 *  que o "Continuar" salva (sem ele, o "Continuar" só avança). */
export function TelaPasso({ webinarId, nome, atual, formulario, children }: {
  webinarId: string;
  /** Nome do webinar: vai num `<h1>` só pra leitor de tela (a tela não mostra título). */
  nome: string;
  atual: ChavePasso;
  formulario?: string;
  children: React.ReactNode;
}) {
  return (
    <Pagina>
      <h1 className="sr-only">{nome}</h1>
      <Passos webinarId={webinarId} atual={atual} />
      <Cartao className="p-8 max-tela-md:p-5 max-tela-sm:p-4">
        <ProvedorEnvioPasso>
          {children}
          <RodapePassos webinarId={webinarId} atual={atual} formulario={formulario} />
        </ProvedorEnvioPasso>
      </Cartao>
    </Pagina>
  );
}

/** Título de seção dentro do cartão do passo (16/600), com descrição opcional embaixo. */
export function TituloSecao({ titulo, descricao, acao }: { titulo: string; descricao?: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-titulo">{titulo}</h2>
        {descricao && <p className="mt-1 text-sm text-texto-3">{descricao}</p>}
      </div>
      {acao}
    </div>
  );
}
