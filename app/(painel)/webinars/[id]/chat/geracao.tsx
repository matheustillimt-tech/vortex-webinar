"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Botao, Campo, estiloInput, estiloTextarea, Selo } from "../../../_componentes/ui";
import { iniciarGeracaoAction, type ResultadoGeracao } from "./actions";

type Andamento = {
  status: "fila" | "transcrevendo" | "gerando" | "pronto" | "erro";
  blocoAtual: number;
  totalBlocos: number | null;
  mensagensGeradas: number;
  erro: string | null;
};

const ROTULO_STATUS: Record<Andamento["status"], string> = {
  fila: "Na fila…",
  transcrevendo: "Transcrevendo o vídeo…",
  gerando: "Gerando mensagens…",
  pronto: "Pronto",
  erro: "Erro",
};

const EM_ANDAMENTO: Andamento["status"][] = ["fila", "transcrevendo", "gerando"];
const INTERVALO_MS = 5000;

function Progresso({ andamento }: { andamento: Andamento }) {
  const cor = andamento.status === "erro" ? "erro" : andamento.status === "pronto" ? "ok" : "destaque";
  return (
    <div className="space-y-1 rounded-lg border border-borda p-3 text-sm">
      <p className="flex items-center gap-2">
        <Selo cor={cor}>{ROTULO_STATUS[andamento.status]}</Selo>
        {andamento.totalBlocos !== null && andamento.status !== "erro" && (
          <span className="text-texto-3">
            bloco {Math.min(andamento.blocoAtual, andamento.totalBlocos)}/{andamento.totalBlocos}
          </span>
        )}
      </p>
      <p className="text-texto-3">{andamento.mensagensGeradas} mensagens geradas até agora.</p>
      {andamento.status === "erro" && andamento.erro && <p className="text-erro">{andamento.erro}</p>}
    </div>
  );
}

export function GeracaoIA({ webinarId, iaLigada }: { webinarId: string; iaLigada: boolean }) {
  const router = useRouter();
  const [estado, enviar, enviando] = useActionState<ResultadoGeracao, FormData>(iniciarGeracaoAction.bind(null, webinarId), {});
  const [andamento, setAndamento] = useState<Andamento | null>(null);
  const andamentoRef = useRef<Andamento | null>(null);
  // Sobe a cada "Gerar" que deu certo, pra forçar um recarregamento imediato (sem esperar o próximo poll) e
  // retomar o polling — sem isso, o cartão só saberia da geração nova na próxima vez que o efeito rodasse.
  const [versao, setVersao] = useState(0);
  const estadoAnterior = useRef(estado);

  useEffect(() => {
    if (estado !== estadoAnterior.current && estado.ok) setVersao((v) => v + 1);
    estadoAnterior.current = estado;
  }, [estado]);

  useEffect(() => {
    let cancelado = false;
    let intervalo: ReturnType<typeof setInterval> | null = null;

    async function carregar() {
      try {
        const r = await fetch(`/api/webinars/${webinarId}/geracao`, { cache: "no-store" });
        const d = await r.json();
        if (cancelado) return;
        const antes = andamentoRef.current?.status;
        const novo = d.geracao as Andamento | null;
        andamentoRef.current = novo;
        setAndamento(novo);
        // Terminou agora (não estava em "pronto" antes e passou a estar): a lista do chat tem mensagens novas.
        if (novo && novo.status === "pronto" && antes && antes !== "pronto") router.refresh();
      } catch {
        // polling: uma falha isolada não precisa de tratamento, a próxima tentativa corrige.
      } finally {
        // Só continua pedindo de novo enquanto existir, de fato, uma geração em andamento — nunca fica pedindo
        // pra sempre num webinar que nunca teve geração nenhuma.
        if (!cancelado) {
          if (intervalo) clearInterval(intervalo);
          intervalo = andamentoRef.current && EM_ANDAMENTO.includes(andamentoRef.current.status) ? setInterval(carregar, INTERVALO_MS) : null;
        }
      }
    }
    carregar();
    return () => {
      cancelado = true;
      if (intervalo) clearInterval(intervalo);
    };
  }, [webinarId, versao, router]);

  const cabecalho = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="grid size-6 place-items-center rounded-lg bg-marca-clara text-marca-forte">
        <Sparkles size={16} aria-hidden />
      </span>
      <h2 className="text-base font-semibold text-titulo">Automação Inteligente de Chat</h2>
      <Selo cor="destaque">Novidade</Selo>
    </div>
  );

  if (!iaLigada) {
    return (
      <div className="space-y-3 rounded-lg border border-borda p-4">
        {cabecalho}
        <p className="text-sm text-texto-3">A geração de chat por IA está desligada. Configure as chaves de IA para usar este recurso.</p>
      </div>
    );
  }

  const podeGerar = !andamento || !EM_ANDAMENTO.includes(andamento.status);

  return (
    <div className="space-y-4 rounded-lg border border-borda p-4">
      {cabecalho}
      <p className="text-sm text-texto-3">A IA assiste ao vídeo e escreve o chat da plateia nos momentos certos. As mensagens geradas são acrescentadas ao chat que já existe: nada é substituído.</p>
      {podeGerar ? (
        <form action={enviar} className="space-y-3">
          <div className="grid gap-3 tela-md:grid-cols-3">
            <Campo rotulo="Idioma">
              <select name="idioma" className={estiloInput} defaultValue="pt">
                <option value="pt">Português</option>
                <option value="es">Espanhol</option>
                <option value="en">Inglês</option>
              </select>
            </Campo>
            <Campo rotulo="Tom">
              <select name="tom" className={estiloInput} defaultValue="natural">
                <option value="natural">Natural</option>
                <option value="formal">Formal</option>
              </select>
            </Campo>
            <Campo rotulo="Intensidade">
              <select name="intensidade" className={estiloInput} defaultValue="media">
                <option value="baixa">Baixa (1 msg/min)</option>
                <option value="media">Média (3 msgs/min)</option>
                <option value="alta">Alta (6 msgs/min)</option>
              </select>
            </Campo>
          </div>
          <Campo rotulo="Instruções sobre o público (opcional)">
            <textarea name="instrucoes" className={estiloTextarea} rows={2} maxLength={400} />
          </Campo>
          <div className="flex items-center gap-3">
            <Botao disabled={enviando} icone={<Sparkles aria-hidden />}>{enviando ? "Iniciando…" : "Gerar Chat com IA"}</Botao>
            {estado.erro && <p className="text-sm text-erro">{estado.erro}</p>}
          </div>
        </form>
      ) : (
        <p className="text-sm text-texto-3">Já tem uma geração em andamento — espere terminar para pedir outra.</p>
      )}
      {andamento && <Progresso andamento={andamento} />}
    </div>
  );
}
