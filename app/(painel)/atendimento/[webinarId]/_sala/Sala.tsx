"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coluna as colunaDaConversa, diaAnterior, filtrarConversas, turmaDe } from "@/src/lib/regras/atendimento";
import { telefoneLegivel } from "@/src/lib/regras/telefone";
import type { Turma } from "@/src/lib/atendimento";
import { criarThrottle } from "@/src/lib/throttle";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import { Icone } from "../../../_componentes/icone";
import { Bot, CalendarDays, Headset, Search, UserRound, Users, WifiOff, X } from "lucide-react";
import { estiloInput, estiloSegmento, estiloSegmentos, Vazio } from "../../../_componentes/ui";
import { assumir, devolverParaIa } from "../actions";
import { ConversaAberta } from "./ConversaAberta";
import type { ConversaCliente } from "./types";
import { useToast } from "../../../_componentes/toast";

type Membro = { id: string; nome: string; papel: "admin" | "atendente" };
type Coluna = "ia" | "humano";
type ModoData = "hoje" | "ontem" | "personalizado";

const ROTULO_MODO: Record<ModoData, string> = { hoje: "Hoje", ontem: "Ontem", personalizado: "Personalizado" };

function diaMes(turma: string): string {
  const [, m, d] = turma.split("-");
  return `${d}/${m}`;
}

const TITULO_COLUNA: Record<Coluna, string> = { ia: "Atendimento IA", humano: "Atendimento humano" };

/** No máximo 1 recarga da lista por segundo, por mais eventos do Realtime que cheguem (a última nunca se perde). */
const THROTTLE_LISTA_MS = 1000;
/** `sessoes` não está no Realtime (muda a cada sinal de presença): online e quem assumiu o quê entram por aqui. */
const INTERVALO_LISTA_MS = 20_000;
/** Quanto tempo a conexão em tempo real precisa ficar fora pra o aviso vermelho aparecer. */
const AVISO_CONEXAO_MS = 10_000;

/** Status de um canal do Realtime que conta como "conexão perdida". */
function canalCaiu(status: string): boolean {
  return status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED";
}

function iniciais(nome: string): string {
  return (nome.trim()[0] ?? "?").toUpperCase();
}

function horaDe(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function SalaAtendimento({
  webinarId,
  eu,
  nomeEquipe,
  conversasIniciais,
  onlineInicial,
  turmasIniciais,
}: {
  webinarId: string;
  eu: Membro;
  /** Nome com que a IA e a equipe respondem na sala (o do agente de IA, ex.: "Equipe Sua Empresa"). */
  nomeEquipe: string | null;
  conversasIniciais: ConversaCliente[];
  onlineInicial: number;
  /** Turmas que tiveram conversa (histórico), mais recente primeiro. */
  turmasIniciais: Turma[];
}) {
  const toast = useToast();
  const [conversas, setConversas] = useState(conversasIniciais);
  // Todo mundo na sala (mesmo número do painel Ao vivo), não só quem está na lista de conversas.
  const [online, setOnline] = useState(onlineInicial);
  // Telas estreitas mostram uma coluna por vez (as duas lado a lado a partir de 1371 px).
  const [colunaVisivel, setColunaVisivel] = useState<Coluna>("ia");
  const [sessaoAbertaId, setSessaoAbertaId] = useState<string | null>(null);
  const [atendentesOnline, setAtendentesOnline] = useState(1);
  // Um status por canal (lista, presença, conversa aberta): o aviso só some quando todos voltaram.
  const [canaisCaidos, setCanaisCaidos] = useState<Record<string, boolean>>({});
  const [processandoFila, setProcessandoFila] = useState<string | null>(null);
  const sequenciaRef = useRef(0);
  const [turmas, setTurmas] = useState(turmasIniciais);
  // `null` = turma de hoje (vira sozinha no dia seguinte, às 06:00, e a lista começa vazia); uma data = histórico.
  const [turmaEscolhida, setTurmaEscolhida] = useState<string | null>(null);
  const [turmaAtual, setTurmaAtual] = useState(() => turmaDe(new Date()));
  const [personalizado, setPersonalizado] = useState(false);
  const turmaAtiva = turmaEscolhida ?? turmaAtual;
  const turmaAtivaRef = useRef(turmaAtiva);
  turmaAtivaRef.current = turmaAtiva;
  const turmaAtualRef = useRef(turmaAtual);
  turmaAtualRef.current = turmaAtual;

  const algumCanalCaido = Object.values(canaisCaidos).some(Boolean);
  // Queda curta (rede piscando, aba em segundo plano) se resolve sozinha em ~1 s e a lista continua vindo pela recarga
  // de 20 s: o aviso só aparece se a conexão ficar fora por mais de AVISO_CONEXAO_MS seguidos.
  const [conexaoPerdida, setConexaoPerdida] = useState(false);
  useEffect(() => {
    if (!algumCanalCaido) {
      setConexaoPerdida(false);
      return;
    }
    const t = setTimeout(() => setConexaoPerdida(true), AVISO_CONEXAO_MS);
    return () => clearTimeout(t);
  }, [algumCanalCaido]);

  const marcarCanal = useCallback((canal: string, caiu: boolean | null) => {
    setCanaisCaidos((atual) => {
      if (caiu === null) {
        if (!(canal in atual)) return atual;
        const { [canal]: _removido, ...resto } = atual;
        return resto;
      }
      return atual[canal] === caiu ? atual : { ...atual, [canal]: caiu };
    });
  }, []);

  const refrescarConversas = useCallback(async () => {
    // Respostas fora de ordem: só vale a da busca mais recente.
    const minha = ++sequenciaRef.current;
    try {
      // Turma de hoje recalculada a cada busca: com a página aberta de um dia pro outro, a lista zera sozinha.
      const hoje = turmaDe(new Date());
      setTurmaAtual(hoje);
      const turma = turmaAtivaRef.current === turmaAtualRef.current ? hoje : turmaAtivaRef.current;
      const resp = await fetch(`/api/painel/atendimento/${webinarId}/conversas?turma=${turma}`, { cache: "no-store" });
      if (!resp.ok) return;
      const dados = (await resp.json()) as { conversas: ConversaCliente[]; online: number; turmas: Turma[] };
      if (minha === sequenciaRef.current) {
        setConversas(dados.conversas);
        setOnline(dados.online);
        setTurmas(dados.turmas);
      }
    } catch {
      // Falha pontual: a próxima mudança do Realtime (ou o intervalo de 20 s) tenta de novo.
    }
  }, [webinarId]);

  // Realtime: só `mensagens_suporte` deste webinar (throttle de 1 s, chamada final garantida). `sessoes` fica fora
  // da publicação; online/atribuições de outros atendentes entram pela recarga a cada 20 s. Ao (re)assinar o canal
  // (SUBSCRIBED, inclusive depois de reconectar) recarrega pra pegar o que passou enquanto estava fora.
  useEffect(() => {
    const supabase = dbNavegador();
    const throttle = criarThrottle(() => void refrescarConversas(), THROTTLE_LISTA_MS);
    let ativo = true;

    const canalDb = supabase
      .channel(`atendimento-db:${webinarId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "mensagens_suporte", filter: `webinar_id=eq.${webinarId}` }, () => throttle.chamar())
      .subscribe((status) => {
        if (!ativo) return;
        marcarCanal("lista", canalCaiu(status));
        if (status === "SUBSCRIBED") throttle.chamar();
      });

    // Canal privado (RLS de `realtime.messages` exige membro): só entra depois de o login chegar no Realtime. Sem
    // isso a primeira tentativa vai com a chave anônima, o servidor recusa ("Unauthorized") e o aviso de conexão
    // pisca a cada abertura da página até a segunda tentativa.
    const canalPresenca = supabase.channel(`atendimento:${webinarId}`, { config: { private: true, presence: { key: eu.id } } });
    canalPresenca.on("presence", { event: "sync" }, () => {
      setAtendentesOnline(Object.keys(canalPresenca.presenceState()).length);
    });
    void supabase.realtime.setAuth().then(() => {
      if (!ativo) return;
      canalPresenca.subscribe(async (status) => {
        if (!ativo) return;
        marcarCanal("presenca", canalCaiu(status));
        if (status === "SUBSCRIBED") await canalPresenca.track({ id: eu.id, nome: eu.nome });
      });
    });

    // Voltou pra aba (o navegador segura timers e a conexão de aba em segundo plano): atualiza na hora.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") throttle.chamar();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    const intervalo = setInterval(() => throttle.chamar(), INTERVALO_LISTA_MS);

    return () => {
      ativo = false;
      throttle.cancelar();
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
      supabase.removeChannel(canalDb);
      supabase.removeChannel(canalPresenca);
      marcarCanal("lista", null);
      marcarCanal("presenca", null);
    };
  }, [webinarId, eu.id, eu.nome, refrescarConversas, marcarCanal]);

  // Busca de contato (nome, telefone ou e-mail) nas duas colunas da data escolhida.
  const [busca, setBusca] = useState("");
  const porColuna = useMemo(() => {
    const grupos: Record<Coluna, ConversaCliente[]> = { ia: [], humano: [] };
    for (const c of filtrarConversas(conversas, busca)) grupos[colunaDaConversa(c)].push(c);
    return grupos;
  }, [conversas, busca]);
  const buscando = busca.trim().length > 0;

  const conversaSelecionada = conversas.find((c) => c.sessaoId === sessaoAbertaId) ?? null;

  /** Muda a conversa na tela na hora (sem esperar a recarga), pra o clique responder rápido. */
  function mudarLocal(sessaoId: string, mudanca: Partial<ConversaCliente>) {
    setConversas((atual) => atual.map((c) => (c.sessaoId === sessaoId ? { ...c, ...mudanca } : c)));
  }

  const pegar = useCallback(
    async (sessaoId: string) => {
      setProcessandoFila(sessaoId);
      try {
        const r = await assumir(webinarId, sessaoId);
        if (r.erro) toast.erro(r.erro);
        else {
          mudarLocal(sessaoId, { status: "atendendo", atendenteId: eu.id, nomeAtendente: eu.nome });
          setSessaoAbertaId(sessaoId);
          setColunaVisivel("humano");
        }
      } catch {
        toast.erro("Não deu para pegar o atendimento. Tente de novo.");
      } finally {
        setProcessandoFila(null);
      }
      await refrescarConversas();
    },
    [webinarId, eu.id, eu.nome, refrescarConversas, toast],
  );

  const devolver = useCallback(
    async (sessaoId: string) => {
      setProcessandoFila(sessaoId);
      try {
        const r = await devolverParaIa(webinarId, sessaoId);
        if (r.erro) toast.erro(r.erro);
        else {
          mudarLocal(sessaoId, { status: "aguardando", atendenteId: null, nomeAtendente: null });
          setColunaVisivel("ia");
        }
      } catch {
        toast.erro("Não deu para devolver pra IA. Tente de novo.");
      } finally {
        setProcessandoFila(null);
      }
      await refrescarConversas();
    },
    [webinarId, refrescarConversas, toast],
  );

  // Filtro de data: Hoje | Ontem | Personalizado (escolhe qualquer dia no calendário).
  const ontem = diaAnterior(turmaAtual);
  const modoData: ModoData = personalizado ? "personalizado" : turmaAtiva === turmaAtual ? "hoje" : turmaAtiva === ontem ? "ontem" : "personalizado";
  const conversasNaData = turmas.find((t) => t.turma === turmaAtiva)?.conversas ?? 0;
  const diasComConversa = turmas.filter((t) => t.turma !== turmaAtual && t.turma !== ontem).slice(0, 6);

  function escolherModo(modo: ModoData) {
    if (modo === "personalizado") {
      setPersonalizado(true);
      return;
    }
    setPersonalizado(false);
    trocarTurma(modo === "hoje" ? turmaAtual : ontem);
  }

  function trocarTurma(turma: string) {
    setTurmaEscolhida(turma === turmaAtual ? null : turma);
    turmaAtivaRef.current = turma;
    setSessaoAbertaId(null);
    setConversas([]);
    void refrescarConversas();
  }

  function podeDevolver(c: ConversaCliente): boolean {
    return c.atendenteId === eu.id || eu.papel === "admin";
  }

  function renderColuna(col: Coluna) {
    const lista = porColuna[col];
    return (
      <section
        aria-label={TITULO_COLUNA[col]}
        className={`min-w-0 flex-col rounded-lg border border-borda bg-superficie ${colunaVisivel === col ? "flex" : "hidden tela-lg:flex"}`}
      >
        <header className="flex items-center gap-2 border-b border-linha px-3 py-2.5">
          <span className={`grid size-7 place-items-center rounded-md ${col === "ia" ? "bg-suave text-texto-3" : "bg-marca-clara text-marca-forte"}`}>
            {col === "ia" ? <Bot size={15} aria-hidden /> : <UserRound size={15} aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-texto">
              {TITULO_COLUNA[col]} <span className="ml-1 tabular-nums text-texto-4">{lista.length}</span>
            </p>
          </div>
        </header>

        {lista.length === 0 ? (
          <Vazio compacto texto={buscando ? "Nenhum contato encontrado." : col === "ia" ? "Nenhuma conversa com a IA." : "Ninguém pegou atendimento ainda."} />
        ) : (
          <ul className="h-[64vh] divide-y divide-linha overflow-y-auto max-tela-md:h-auto max-tela-md:max-h-[60vh]">
            {lista.map((c) => {
              const aberta = sessaoAbertaId === c.sessaoId;
              const atendente = col === "humano" ? (c.atendenteId === eu.id ? "com você" : `com ${c.nomeAtendente ?? "a equipe"}`) : null;
              return (
                <li key={c.sessaoId} className="relative">
                  {aberta && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-marca" />}
                  <button
                    type="button"
                    onClick={() => setSessaoAbertaId(c.sessaoId)}
                    className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-marca/40 ${aberta ? "bg-marca-linha" : "hover:bg-suave"}`}
                  >
                    <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-marca-clara text-sm font-semibold text-marca-forte">
                      {iniciais(c.nome)}
                      <span
                        aria-hidden
                        title={c.online ? "Na sala agora" : "Fora da sala"}
                        className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-superficie ${c.online ? "bg-ok" : "bg-apagado"}`}
                      />
                    </span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-texto">{c.nome}</span>
                        {c.ultimaMensagem && <span className="shrink-0 text-[11px] tabular-nums text-texto-4">{horaDe(c.ultimaMensagem.criadaEm)}</span>}
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs tabular-nums text-texto-3">
                          {c.telefoneE164 ? telefoneLegivel(c.telefoneE164) : "Sem telefone"}
                          {atendente && <span className="text-marca-forte"> · {atendente}</span>}
                        </span>
                        {c.naoLidas > 0 && (
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-marca px-1.5 text-[11px] font-semibold text-white">{c.naoLidas}</span>
                        )}
                      </span>
                      {c.assistidoPct !== null && (
                        <span className="flex items-center gap-2 pt-1" title={`Assistiu ${c.assistidoPct}% do webinar`}>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-suave">
                            <span className="block h-full rounded-full bg-marca transition-[width] duration-500" style={{ width: `${c.assistidoPct}%` }} />
                          </span>
                          <span className="shrink-0 text-right text-[11px] tabular-nums text-texto-3">{c.assistidoPct}% assistido</span>
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {conexaoPerdida && (
        <div role="alert" className="flex items-center justify-center gap-2 rounded-md bg-erro px-3 py-2 text-center text-sm font-medium text-white">
          <WifiOff size={16} aria-hidden />
          Erro de conexão. Tentando reconectar…
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 max-tela-sm:grid-cols-1">
        <div className="flex items-center gap-3 rounded-lg border border-borda bg-superficie px-4 py-3">
          <span className="grid size-8 place-items-center rounded-lg bg-marca-clara text-marca-forte">
            <Users size={16} aria-hidden />
          </span>
          <div>
            <p className="text-xs text-texto-3">Participantes online</p>
            <p className="text-lg font-bold tabular-nums text-texto">{online}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-borda bg-superficie px-4 py-3">
          <span className="grid size-8 place-items-center rounded-lg bg-marca-clara text-marca-forte">
            <Headset size={16} aria-hidden />
          </span>
          <div>
            <p className="text-xs text-texto-3">Atendentes online</p>
            <p className="text-lg font-bold tabular-nums text-texto">{atendentesOnline}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 text-sm text-texto-3">
          <CalendarDays size={16} aria-hidden />
          Data
        </span>
        <div role="tablist" aria-label="Data do chat" className={estiloSegmentos}>
          {(["hoje", "ontem", "personalizado"] as ModoData[]).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={modoData === m} onClick={() => escolherModo(m)} className={estiloSegmento(modoData === m)}>
              {ROTULO_MODO[m]}
            </button>
          ))}
        </div>
        {modoData === "personalizado" && (
          <input
            type="date"
            aria-label="Escolher data"
            value={turmaAtiva}
            max={turmaAtual}
            onChange={(e) => e.target.value && trocarTurma(e.target.value)}
            className={`${estiloInput} h-9 !w-44`}
          />
        )}
        <p className="text-xs text-texto-3">
          {diaMes(turmaAtiva)}: {conversasNaData} {conversasNaData === 1 ? "conversa" : "conversas"}
          {modoData === "hoje" && <span className="text-texto-4"> · cada dia começa vazio (virada às 6h)</span>}
        </p>
        {modoData === "personalizado" && diasComConversa.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-texto-4">
            Dias com conversa:
            {diasComConversa.map((t) => (
              <button
                key={t.turma}
                type="button"
                onClick={() => trocarTurma(t.turma)}
                className={`rounded-full px-2 py-0.5 ${t.turma === turmaAtiva ? "bg-marca-clara text-marca-forte" : "bg-suave text-texto-3 hover:text-texto"}`}
              >
                {diaMes(t.turma)} ({t.conversas})
              </button>
            ))}
          </p>
        )}
        <div className="relative ml-auto w-full max-w-xs max-tela-sm:max-w-none">
          <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-texto-4" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setBusca("")}
            placeholder="Buscar contato (nome ou telefone)"
            aria-label="Buscar contato"
            className={`${estiloInput} h-9 pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden`}
          />
          {buscando && (
            <button
              type="button"
              onClick={() => setBusca("")}
              aria-label="Limpar busca"
              className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-texto-4 hover:bg-suave hover:text-texto"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div role="tablist" className={`${estiloSegmentos} flex w-full tela-lg:hidden`}>
        {(["ia", "humano"] as Coluna[]).map((col) => (
          <button
            key={col}
            type="button"
            role="tab"
            aria-selected={colunaVisivel === col}
            onClick={() => setColunaVisivel(col)}
            className={`${estiloSegmento(colunaVisivel === col)} flex-1 gap-1.5`}
          >
            {TITULO_COLUNA[col]}
            <span className="tabular-nums text-texto-4">{porColuna[col].length}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 tela-lg:grid-cols-[minmax(260px,320px)_minmax(260px,320px)_minmax(0,1fr)] max-tela-lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] max-tela-md:grid-cols-1">
        {renderColuna("ia")}
        {renderColuna("humano")}

        <div className={`min-w-0 rounded-lg border border-borda bg-superficie ${conversaSelecionada ? "" : "max-tela-md:hidden"}`}>
          {conversaSelecionada ? (
            <ConversaAberta
              key={conversaSelecionada.sessaoId}
              webinarId={webinarId}
              eu={eu}
              nomeEquipe={nomeEquipe}
              conversaResumo={conversaSelecionada}
              processando={processandoFila === conversaSelecionada.sessaoId}
              onPegar={() => pegar(conversaSelecionada.sessaoId)}
              onDevolver={podeDevolver(conversaSelecionada) ? () => devolver(conversaSelecionada.sessaoId) : null}
              onFechar={() => setSessaoAbertaId(null)}
              onMudou={refrescarConversas}
              onStatusCanal={(caiu) => marcarCanal("conversa", caiu)}
            />
          ) : (
            <Vazio icone={<Icone nome="support_agent" tamanho={20} />} texto="Escolha uma conversa na lista." />
          )}
        </div>
      </div>
    </div>
  );
}
