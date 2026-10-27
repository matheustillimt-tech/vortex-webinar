"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { criarThrottle } from "@/src/lib/throttle";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import { Botao, erroArquivosDoFormulario, estiloAcao, estiloInput } from "../../../_componentes/ui";
import { Icone } from "../../../_componentes/icone";
import { apagarMensagem, editarMensagem, responder } from "../actions";
import type { MensagemConversa } from "@/src/lib/atendimento";
import type { ConversaCliente, SessaoConversaCliente } from "./types";
import { useToast } from "../../../_componentes/toast";
import { Bot, Check, Copy } from "lucide-react";
import { useCopiar } from "../../../_componentes/copiar";
import { telefoneLegivel } from "@/src/lib/regras/telefone";

type Membro = { id: string; nome: string; papel: "admin" | "atendente" };


/** Rede de segurança além do Realtime (que já avisa de cada mensagem desta sessão): status da sessão mudado por
 *  outro atendente, ou um evento perdido numa reconexão. */
const INTERVALO_CONVERSA_MS = 10_000;
const THROTTLE_CONVERSA_MS = 1000;

function canalCaiu(status: string): boolean {
  return status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED";
}

function horaDe(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ConversaAberta({
  webinarId,
  eu,
  nomeEquipe,
  conversaResumo,
  processando,
  onPegar,
  onDevolver,
  onFechar,
  onMudou,
  onStatusCanal,
}: {
  webinarId: string;
  eu: Membro;
  /** Nome com que a IA e a equipe respondem na sala (ex.: "Equipe Sua Empresa"). */
  nomeEquipe: string | null;
  conversaResumo: ConversaCliente;
  /** Pegar/devolver em andamento (botões ficam carregando). */
  processando: boolean;
  onPegar: () => void | Promise<void>;
  /** `null` = eu não posso devolver esta conversa (está com outra pessoa e não sou admin). */
  onDevolver: (() => void | Promise<void>) | null;
  onFechar: () => void;
  onMudou: () => void | Promise<void>;
  /** `true` = o canal desta conversa caiu; `null` = desmontou (sai da conta do aviso de conexão). */
  onStatusCanal: (caiu: boolean | null) => void;
}) {
  const toast = useToast();
  const copiar = useCopiar();
  const [telefoneCopiado, setTelefoneCopiado] = useState(false);
  const [sessao, setSessao] = useState<SessaoConversaCliente | null>(null);
  const [mensagens, setMensagens] = useState<MensagemConversa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [textoEdicao, setTextoEdicao] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const sessaoId = conversaResumo.sessaoId;

  const sequenciaRef = useRef(0);

  const recarregar = useCallback(async () => {
    // Respostas fora de ordem: só vale a da busca mais recente.
    const minha = ++sequenciaRef.current;
    try {
      const resp = await fetch(`/api/painel/atendimento/${webinarId}/conversas/${sessaoId}`, { cache: "no-store" });
      if (resp.ok && minha === sequenciaRef.current) {
        const r = (await resp.json()) as { sessao: SessaoConversaCliente; mensagens: MensagemConversa[] };
        setSessao(r.sessao);
        setMensagens(r.mensagens);
      }
    } catch {
      // Falha pontual: o próximo evento do Realtime (ou o intervalo de 10 s) tenta de novo.
    } finally {
      if (minha === sequenciaRef.current) setCarregando(false);
    }
  }, [webinarId, sessaoId]);

  // Realtime só das mensagens desta sessão (filtro por sessao_id) + recarga a cada 10 s. Ao (re)assinar o canal,
  // recarrega pra pegar o que passou enquanto estava fora.
  useEffect(() => {
    setCarregando(true);
    const supabase = dbNavegador();
    const throttle = criarThrottle(() => void recarregar(), THROTTLE_CONVERSA_MS);
    let ativo = true;

    const canal = supabase
      .channel(`atendimento-conversa:${sessaoId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "mensagens_suporte", filter: `sessao_id=eq.${sessaoId}` }, () => throttle.chamar())
      .subscribe((status) => {
        if (!ativo) return;
        onStatusCanal(canalCaiu(status));
        if (status === "SUBSCRIBED") throttle.chamar();
      });
    void recarregar();
    const intervalo = setInterval(() => throttle.chamar(), INTERVALO_CONVERSA_MS);

    return () => {
      ativo = false;
      throttle.cancelar();
      clearInterval(intervalo);
      supabase.removeChannel(canal);
      onStatusCanal(null);
    };
    // `onStatusCanal` muda a cada render do pai; o canal só depende da sessão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessaoId, recarregar]);

  useEffect(() => {
    listaRef.current?.scrollTo({ top: listaRef.current.scrollHeight });
  }, [mensagens.length]);

  async function onEnviar(form: FormData) {
    setEnviando(true);
    setErro(null);
    try {
      const r = await responder(webinarId, sessaoId, form);
      if (r.erro) {
        setErro(r.erro);
        return;
      }
      formRef.current?.reset();
    } catch {
      setErro("Não deu para enviar a mensagem. Tente de novo.");
      return;
    } finally {
      setEnviando(false);
    }
    await recarregar();
    await onMudou();
  }

  async function salvarEdicao(id: string) {
    try {
      const r = await editarMensagem(id, textoEdicao);
      if (r.erro) {
        toast.erro(r.erro);
        return;
      }
    } catch {
      toast.erro("Não deu para editar a mensagem. Tente de novo.");
      return;
    }
    setEditandoId(null);
    await recarregar();
    await onMudou();
  }

  async function apagar(id: string) {
    if (!(await toast.confirmar({ titulo: "Apagar esta mensagem?", confirmar: "Apagar", perigo: true }))) return;
    try {
      const r = await apagarMensagem(id);
      if (r.erro) toast.erro(r.erro);
    } catch {
      toast.erro("Não deu para apagar a mensagem. Tente de novo.");
    }
    await recarregar();
    await onMudou();
  }

  const nome = sessao?.nome ?? conversaResumo.nome;
  const telefone = sessao?.telefoneE164 ?? conversaResumo.telefoneE164;
  const email = sessao?.email ?? conversaResumo.email;
  const inicioSessao = sessao?.inicioSessao ?? conversaResumo.inicioSessao;
  // A lista (recarga a cada 20 s, e na hora depois de pegar/devolver) manda no status; a conversa aberta só
  // complementa com o que leu por último.
  const atendenteId = conversaResumo.atendenteId;
  const comHumano = conversaResumo.status === "atendendo" && !!atendenteId;
  const souEu = comHumano && atendenteId === eu.id;

  // Copia no formato internacional (+5511900001234): cola direto no WhatsApp ou na agenda do celular.
  async function copiarTelefone(e164: string) {
    if (await copiar(e164, "Telefone copiado!")) {
      setTelefoneCopiado(true);
      window.setTimeout(() => setTelefoneCopiado(false), 2000);
    }
  }
  const assinatura = nomeEquipe ?? "Equipe";

  return (
    <div className="flex h-[75vh] flex-col md:h-[70vh]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linha px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{nome}</p>
          {telefone ? (
            <p className="flex items-center gap-1 text-xs text-vg-muted">
              <span className="truncate tabular-nums">{telefoneLegivel(telefone)}</span>
              <button
                type="button"
                onClick={() => void copiarTelefone(telefone)}
                aria-label="Copiar telefone"
                title="Copiar telefone (pra chamar no WhatsApp)"
                className="inline-grid size-6 shrink-0 place-items-center rounded-md text-texto-4 transition-colors hover:bg-suave hover:text-marca-forte focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40"
              >
                {telefoneCopiado ? <Check size={14} className="text-ok" aria-hidden /> : <Copy size={14} aria-hidden />}
              </button>
              {email && <span className="truncate">· {email}</span>}
            </p>
          ) : (
            <p className="truncate text-xs text-vg-muted">{email ?? "Sem contato"}</p>
          )}
          <p className="text-xs text-vg-text-3">Vídeo iniciado às {horaDe(inicioSessao)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!comHumano ? (
            <Botao tamanho="pequeno" carregando={processando} onClick={() => onPegar()}>
              Pegar atendimento
            </Botao>
          ) : (
            onDevolver && (
              <Botao tamanho="pequeno" variante="secundario" icone={<Bot aria-hidden />} carregando={processando} onClick={() => onDevolver()}>
                Devolver pra IA
              </Botao>
            )
          )}
          <button type="button" className={estiloAcao.neutro} onClick={onFechar}>
            Fechar
          </button>
        </div>
      </div>

      <div ref={listaRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {carregando ? (
          <p className="text-sm text-vg-muted">Carregando…</p>
        ) : mensagens.length === 0 ? (
          <p className="text-sm text-vg-muted">Sem mensagens ainda.</p>
        ) : (
          mensagens.map((m) => {
            const minha = m.autor === "atendente" && m.autorId === eu.id;
            const doParticipante = m.autor === "participante";
            const rotulo =
              m.autor === "atendente"
                ? `${assinatura} · ${m.nomeAutor ?? "atendente"}`
                : m.autor === "ia"
                  ? `${assinatura} · IA`
                  : m.autor === "chatbot"
                    ? "Auto"
                    : null;
            return (
              <div key={m.id} className={`flex ${doParticipante ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 ${doParticipante ? "bg-suave" : "bg-marca-linha"}`}>
                  {rotulo && <p className="mb-0.5 text-[11px] font-medium text-vg-text-3">{rotulo}</p>}
                  {editandoId === m.id ? (
                    <div className="space-y-1.5">
                      <textarea
                        value={textoEdicao}
                        onChange={(e) => setTextoEdicao(e.target.value)}
                        className={estiloInput}
                        rows={2}
                      />
                      <div className="flex gap-2 text-xs">
                        <button type="button" className={estiloAcao.normal} onClick={() => salvarEdicao(m.id)}>
                          Salvar
                        </button>
                        <button type="button" className={estiloAcao.neutro} onClick={() => setEditandoId(null)}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : m.apagada ? (
                    <p className="text-sm italic text-vg-text-3">Mensagem apagada</p>
                  ) : (
                    <>
                      {m.imagemUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.imagemUrl} alt="Imagem enviada" className="mb-1 max-h-60 rounded-md" />
                      )}
                      {m.texto && <p className="whitespace-pre-wrap text-sm">{m.texto}</p>}
                    </>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-[11px] text-vg-text-3">
                      {horaDe(m.criadaEm)}
                      {m.editada && !m.apagada && " · editada"}
                    </p>
                    {minha && !m.apagada && editandoId !== m.id && (
                      <>
                        {m.texto && !m.imagemUrl && (
                          <button
                            type="button"
                            className="text-[11px] text-vg-accent hover:underline"
                            onClick={() => {
                              setEditandoId(m.id);
                              setTextoEdicao(m.texto ?? "");
                            }}
                          >
                            Editar
                          </button>
                        )}
                        <button type="button" className="text-[11px] text-vg-erro hover:underline" onClick={() => apagar(m.id)}>
                          Apagar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {erro && <p className="px-4 text-xs text-vg-erro">{erro}</p>}

      {souEu ? (
        <form
          ref={formRef}
          action={onEnviar}
          onSubmit={(e) => {
            const erroArquivos = erroArquivosDoFormulario(e.currentTarget);
            if (erroArquivos) {
              e.preventDefault();
              setErro(erroArquivos);
            }
          }}
          className="flex items-end gap-2 border-t border-linha p-3"
        >
          <textarea
            name="texto"
            placeholder={`Responder como ${assinatura}… (Enter envia, Shift+Enter pula linha)`}
            rows={2}
            maxLength={1000}
            className={`${estiloInput} h-auto flex-1 resize-none py-2`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!enviando) formRef.current?.requestSubmit();
              }
            }}
          />
          <label className="cursor-pointer p-1.5 text-vg-muted hover:text-vg-text" title="Enviar imagem">
            <input type="file" name="imagem" accept="image/jpeg,image/png,image/webp" className="hidden" />
            <Icone nome="attach_file" tamanho={20} />
          </label>
          <Botao type="submit" carregando={enviando}>
            Enviar
          </Botao>
        </form>
      ) : !comHumano ? null : (
        <p className="border-t border-linha p-3 text-center text-xs text-vg-muted">
          {conversaResumo.nomeAtendente ?? "Outra pessoa da equipe"} está com esta conversa.
        </p>
      )}
    </div>
  );
}
