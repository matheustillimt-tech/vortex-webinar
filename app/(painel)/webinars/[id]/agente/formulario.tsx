"use client";
import { useActionState, useRef, useState, type RefObject } from "react";
import { Bot, SendHorizontal } from "lucide-react";
import { Botao, Campo, estiloInput, estiloTextarea } from "../../../_componentes/ui";
import { AvisoFormulario, Interruptor } from "../../_componentes/campos";
import { useEnvioPasso } from "../../_componentes/assistente";
import { salvarAgente, testarAgente, type Resultado } from "./actions";

export type Valores = { ligado: boolean; nome: string; instrucoes: string; contexto: string; faq: string };

type Troca = { pergunta: string; resposta: string | null; erro?: string };

/** "Testar chat": conversa de teste com o agente usando o que está escrito no formulário (mesmo sem
 *  salvar). Nada é gravado. */
function Playground({ formPrincipalRef, iaLigada, nome }: { formPrincipalRef: RefObject<HTMLFormElement | null>; iaLigada: boolean; nome: string }) {
  const [pergunta, setPergunta] = useState("");
  const [trocas, setTrocas] = useState<Troca[]>([]);
  const [testando, setTestando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  async function testar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const texto = pergunta.trim();
    if (!iaLigada || !texto || !formPrincipalRef.current) return;
    setTestando(true);
    // Usa os campos do formulário principal (nome/instruções/contexto/faq) ainda não salvos.
    const corpo = new FormData(formPrincipalRef.current);
    corpo.set("pergunta", texto);
    const r = await testarAgente(corpo);
    setTestando(false);
    setPergunta("");
    setTrocas((t) => [...t, r.erro ? { pergunta: texto, resposta: null, erro: r.erro } : { pergunta: texto, resposta: r.resposta ?? null }]);
    requestAnimationFrame(() => fim.current?.scrollIntoView({ block: "nearest" }));
  }

  return (
    <div className="flex min-h-[420px] flex-col overflow-hidden rounded-lg border border-borda">
      <div className="border-b border-linha px-4 py-3">
        <p className="text-base font-semibold text-titulo">Testar chat</p>
        <p className="text-xs text-texto-3">Responde com o que está escrito ao lado, mesmo sem salvar. Nada é gravado.</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-fundo p-4">
        <div className="flex items-start gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-marca-clara text-marca-forte">
            <Bot size={16} aria-hidden />
          </span>
          <p className="max-w-[85%] rounded-lg rounded-tl-none bg-superficie px-3 py-2 text-sm text-texto shadow-controle">
            Olá! Sou {nome.trim() || "seu assistente"}. Respondo no chat da sala, marcando quem perguntou, as perguntas sobre a aula e o produto, usando o contexto e a FAQ.
          </p>
        </div>
        {trocas.map((t, i) => (
          <div key={i} className="space-y-3">
            <p className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-marca px-3 py-2 text-sm text-white">{t.pergunta}</p>
            <div className="flex items-start gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-marca-clara text-marca-forte">
                <Bot size={16} aria-hidden />
              </span>
              <p className={`max-w-[85%] rounded-lg rounded-tl-none px-3 py-2 text-sm shadow-controle ${t.erro ? "bg-erro-fundo text-[#991b1b]" : "bg-superficie text-texto"}`}>
                {t.erro ?? (t.resposta === null ? "(esta mensagem não foi respondida: não é pergunta sobre o conteúdo)" : t.resposta)}
              </p>
            </div>
          </div>
        ))}
        <div ref={fim} />
      </div>
      <form onSubmit={testar} className="flex items-center gap-2 border-t border-linha p-3">
        <input
          name="pergunta"
          aria-label="Pergunta de teste"
          className={estiloInput}
          placeholder={iaLigada ? "Digite uma pergunta para testar…" : "A IA está desligada"}
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          disabled={!iaLigada || testando}
        />
        <Botao type="submit" className="w-9 px-0" aria-label="Enviar pergunta" disabled={!iaLigada || !pergunta.trim()} carregando={testando}>
          {!testando && <SendHorizontal aria-hidden />}
        </Botao>
      </form>
    </div>
  );
}

export function FormularioAgente({ idFormulario, webinarId, valores, iaLigada }: { idFormulario: string; webinarId: string; valores: Valores; iaLigada: boolean }) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(salvarAgente.bind(null, webinarId), {});
  useEnvioPasso(enviando);
  const formRef = useRef<HTMLFormElement>(null);
  const v = estado.valores;
  const efetivos: Valores = v
    ? {
        ligado: v.ligado === "on",
        nome: v.nome ?? valores.nome,
        instrucoes: v.instrucoes ?? valores.instrucoes,
        contexto: v.contexto ?? valores.contexto,
        faq: v.faq ?? valores.faq,
      }
    : valores;
  const [nome, setNome] = useState(efetivos.nome);
  const [instrucoes, setInstrucoes] = useState(efetivos.instrucoes);
  const [contexto, setContexto] = useState(efetivos.contexto);
  const [faq, setFaq] = useState(efetivos.faq);
  const chaveTentativa = estado.erro ?? "inicial";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 tela-slg:grid-cols-[minmax(0,1fr)_420px]">
      <form id={idFormulario} ref={formRef} action={enviar} className="min-w-0 space-y-6" key={chaveTentativa}>
        <div className="flex items-start gap-3 rounded-lg border border-marca-funil bg-marca-linha p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-marca text-white">
            <Bot size={20} aria-hidden />
          </span>
          <div className="text-sm text-texto-2">
            <p className="font-semibold text-texto">Olá! Sou seu assistente no chat.</p>
            <p>Respondo no chat da sala, marcando quem perguntou (só essa pessoa vê), só perguntas sobre a aula ou o produto, com o contexto e a FAQ abaixo. Nunca invento preço, prazo ou link.</p>
          </div>
        </div>

        {!iaLigada && <AvisoFormulario erro="O agente de IA está desligado. Configure as chaves de IA para usar este recurso." />}

        <div>
          <Interruptor name="ligado" defaultChecked={efetivos.ligado} disabled={!iaLigada} rotulo="Ativar uso do Agente de IA" />
          {/* Input desabilitado não entra no FormData — sem isso, salvar qualquer outro campo com a IA desligada
             desligaria o agente sem querer assim que as chaves voltassem. */}
          {!iaLigada && <input type="hidden" name="ligado" value={efetivos.ligado ? "on" : ""} />}
        </div>

        <Campo rotulo="Nome do agente" contador={`${nome.length} de 60`}>
          <input name="nome" className={estiloInput} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder="Suporte" />
        </Campo>

        <Campo rotulo="Instrução para IA" contador={`${instrucoes.length} de 4000`} dica="Não coloque nada confidencial: o modelo de IA recebe este texto inteiro.">
          <textarea name="instrucoes" className={estiloTextarea} rows={4} value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} maxLength={4000} />
        </Campo>

        <Campo rotulo="Contexto de produtos e serviços" contador={`${contexto.length} de 4000`}>
          <textarea name="contexto" className={estiloTextarea} rows={5} value={contexto} onChange={(e) => setContexto(e.target.value)} maxLength={4000} />
        </Campo>

        <Campo rotulo="Perguntas e respostas (FAQ)" contador={`${faq.length} de 4000`}>
          <textarea name="faq" className={estiloTextarea} rows={5} value={faq} onChange={(e) => setFaq(e.target.value)} maxLength={4000} />
        </Campo>

        <AvisoFormulario erro={estado.erro} ok={estado.ok ? "Agente salvo." : null} />
      </form>

      <aside className="min-w-0 tela-slg:sticky tela-slg:top-4">
        <Playground formPrincipalRef={formRef} iaLigada={iaLigada} nome={nome} />
      </aside>
    </div>
  );
}
