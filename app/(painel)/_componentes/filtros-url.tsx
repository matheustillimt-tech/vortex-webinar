"use client";
// Filtros das listas que mexem na URL (o servidor relê os `searchParams` e corta a página com `range()`).
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, Search } from "lucide-react";
import { dataCurta } from "@/src/lib/regras/filtros-lista";
import { Botao, estiloInput, estiloSelect } from "./ui";

/** Troca parâmetros da URL atual (`null`/"" apaga) e volta para a página 1. */
function useTrocarParametros() {
  const router = useRouter();
  const caminho = usePathname();
  const [pendente, iniciar] = useTransition();
  function trocar(mudancas: Record<string, string | null>) {
    const p = new URLSearchParams(window.location.search);
    p.delete("pagina");
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    const q = p.toString();
    iniciar(() => router.push(q ? `${caminho}?${q}` : caminho, { scroll: false }));
  }
  return { trocar, pendente };
}

/** Select-botão (h 36, branco com borda e chevron): filtra ao escolher. O valor `padrao` some da URL. */
export function FiltroUrl({ parametro, valor, padrao, opcoes, rotulo }: {
  parametro: string;
  valor: string;
  padrao: string;
  opcoes: { valor: string; rotulo: string }[];
  /** Nome do filtro pra leitor de tela ("Ordenar", "Status"…). */
  rotulo: string;
}) {
  const { trocar, pendente } = useTrocarParametros();
  return (
    <select
      aria-label={rotulo}
      title={rotulo}
      value={valor}
      disabled={pendente}
      onChange={(e) => trocar({ [parametro]: e.target.value === padrao ? null : e.target.value })}
      className={`${estiloSelect} h-9 min-w-[140px] cursor-pointer font-medium tela-md:w-auto`}
    >
      {opcoes.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.rotulo}
        </option>
      ))}
    </select>
  );
}

/** Busca "Pesquise aqui" com lupa (271 px; largura toda no celular). Filtra 400 ms depois de parar de digitar ou no
 *  Enter; o "x" nativo do `type=search` limpa. */
export function BuscaUrl({ valor, parametro = "busca", placeholder = "Pesquise aqui" }: { valor: string; parametro?: string; placeholder?: string }) {
  const { trocar } = useTrocarParametros();
  const [texto, setTexto] = useState(valor);
  const ultimo = useRef(valor);

  useEffect(() => {
    if (texto.trim() === ultimo.current) return;
    const t = window.setTimeout(() => {
      ultimo.current = texto.trim();
      trocar({ [parametro]: texto.trim() || null });
    }, 400);
    return () => window.clearTimeout(t);
    // `trocar` muda a cada render; o efeito só depende do texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  return (
    <form
      role="search"
      className="relative w-[271px] max-tela-md:w-full"
      onSubmit={(e) => {
        e.preventDefault();
        ultimo.current = texto.trim();
        trocar({ [parametro]: texto.trim() || null });
      }}
    >
      <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-apagado" />
      <input type="search" aria-label={placeholder} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} className={`${estiloInput} h-9 pl-9`} />
    </form>
  );
}

/**
 * Seletor de período num botão só ("01/10/2026 ~ 20/10/2026", com calendário). Abre um painel
 * com De/Até e Resetar/Aplicar. Grava `de`/`ate` (aaaa-mm-dd) na URL; Resetar apaga os dois (volta ao padrão da tela).
 */
export function PeriodoUrl({ de, ate, vazio = "Período", alinhar = "esquerda", nota }: {
  de: string;
  ate: string;
  /** Frase curta no topo do painel (ex.: "Webinars criados no período."). */
  nota?: string;
  /** Texto do botão sem período escolhido. */
  vazio?: string;
  alinhar?: "esquerda" | "direita";
}) {
  const { trocar, pendente } = useTrocarParametros();
  const [aberto, setAberto] = useState(false);
  const [novoDe, setNovoDe] = useState(de);
  const [novoAte, setNovoAte] = useState(ate);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    setNovoDe(de);
    setNovoAte(ate);
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto, de, ate]);

  const texto = de || ate ? `${dataCurta(de) || "…"} ~ ${dataCurta(ate) || "…"}` : vazio;

  return (
    <div ref={caixa} className="relative w-[280px] max-tela-md:w-full">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        disabled={pendente}
        onClick={() => setAberto((a) => !a)}
        className={`${estiloInput} flex h-9 items-center gap-2 whitespace-nowrap text-left font-medium`}
      >
        <CalendarDays size={16} aria-hidden className="shrink-0 text-texto-3" />
        <span className={`min-w-0 flex-1 truncate ${de || ate ? "" : "text-texto-3"}`}>{texto}</span>
        <ChevronDown size={16} aria-hidden className="shrink-0 text-texto-4" />
      </button>
      {aberto && (
        <div
          role="dialog"
          aria-label="Escolher período"
          className={`absolute top-full z-40 mt-1 w-[300px] max-w-[calc(100vw-2rem)] space-y-3 rounded-md border border-linha bg-superficie p-4 shadow-lg max-tela-md:left-0 max-tela-md:w-full ${alinhar === "direita" ? "right-0" : "left-0"}`}
        >
          {nota && <p className="text-xs text-texto-3">{nota}</p>}
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1.5 text-sm font-medium text-rotulo">
              <span className="block">De</span>
              <input type="date" value={novoDe} max={novoAte || undefined} onChange={(e) => setNovoDe(e.target.value)} className={estiloInput} />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-rotulo">
              <span className="block">Até</span>
              <input type="date" value={novoAte} min={novoDe || undefined} onChange={(e) => setNovoAte(e.target.value)} className={estiloInput} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Botao
              type="button"
              variante="secundario"
              tamanho="pequeno"
              onClick={() => {
                setAberto(false);
                trocar({ de: null, ate: null });
              }}
            >
              Resetar
            </Botao>
            <Botao
              type="button"
              tamanho="pequeno"
              onClick={() => {
                setAberto(false);
                trocar({ de: novoDe || null, ate: novoAte || null });
              }}
            >
              Aplicar
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}
