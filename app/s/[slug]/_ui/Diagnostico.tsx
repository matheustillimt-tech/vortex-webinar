"use client";
import { useEffect } from "react";

const CHAVE = "vw_diag";
const EVENTOS_VIDEO = ["loadstart", "loadedmetadata", "canplay", "play", "playing", "pause", "seeking", "seeked", "waiting", "stalled", "error", "ended", "volumechange"];
const EVENTOS_TOQUE = ["touchstart", "pointerdown", "click"];

function descrever(el: EventTarget | null): string {
  if (!(el instanceof Element)) return String(el);
  const partes = [el.tagName.toLowerCase()];
  const rotulo = el.getAttribute("aria-label") ?? el.getAttribute("placeholder");
  if (rotulo) partes.push(`"${rotulo.slice(0, 30)}"`);
  if (el.hasAttribute("data-comecar-video")) partes.push("[comecar-video]");
  if ((el as HTMLInputElement).disabled) partes.push("(disabled)");
  const classe = el.getAttribute("class");
  if (classe) partes.push(`.${classe.slice(0, 40)}`);
  return partes.join(" ");
}

/** Modo diagnóstico da sala (só com `?diag=1` no link; fica ligado na aba via `sessionStorage`, inclusive depois de
 *  atualizar a página): manda pro servidor (`/api/sala/diag`, que só escreve no log da Vercel) o que acontece no
 *  aparelho — vídeo (posição, mudo, carregamento), toques e foco perto do campo de mensagem, teclado
 *  (`visualViewport`) e erros. Pra investigar problema que só aparece no celular de verdade. Sem `?diag=1`, não faz
 *  nada. */
export default function Diagnostico() {
  useEffect(() => {
    let id: string;
    try {
      if (new URLSearchParams(location.search).get("diag") === "1") sessionStorage.setItem(CHAVE, "1");
      if (sessionStorage.getItem(CHAVE) !== "1") return;
      id = sessionStorage.getItem(`${CHAVE}_id`) ?? Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(`${CHAVE}_id`, id);
    } catch {
      return;
    }

    const fila: Record<string, unknown>[] = [];
    const reg = (tipo: string, dados: Record<string, unknown> = {}) => fila.push({ ms: Math.round(performance.now()), tipo, ...dados });
    function enviar() {
      if (fila.length === 0) return;
      const corpo = JSON.stringify({ id, caminho: location.pathname, ua: navigator.userAgent, eventos: fila.splice(0, 40) });
      const ok = navigator.sendBeacon?.("/api/sala/diag", new Blob([corpo], { type: "application/json" }));
      if (!ok) void fetch("/api/sala/diag", { method: "POST", body: corpo, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
    }

    const navegacao = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const vv = window.visualViewport;
    reg("carregou", { navegacao: navegacao?.type, tela: `${innerWidth}x${innerHeight}`, vv: vv ? `${Math.round(vv.height)}@${Math.round(vv.offsetTop)}` : null });

    function video(ev: Event) {
      const v = ev.target;
      if (!(v instanceof HTMLVideoElement)) return;
      reg(`video:${ev.type}`, { t: Math.round(v.currentTime * 10) / 10, rs: v.readyState, mudo: v.muted, pausado: v.paused, rede: v.networkState, erro: v.error?.code });
    }
    let ultimoTempo = 0;
    function tempo(ev: Event) {
      const v = ev.target;
      if (!(v instanceof HTMLVideoElement) || performance.now() - ultimoTempo < 10_000) return;
      ultimoTempo = performance.now();
      reg("video:timeupdate", { t: Math.round(v.currentTime), mudo: v.muted });
    }
    function toque(ev: Event) {
      const p = ev as PointerEvent & TouchEvent;
      const x = p.clientX ?? p.touches?.[0]?.clientX;
      const y = p.clientY ?? p.touches?.[0]?.clientY;
      // Só a metade de baixo da tela (campo de mensagem e chat) ou toque direto em campo/botão.
      const alvo = ev.target as Element | null;
      if (typeof y === "number" && y < innerHeight * 0.5 && !alvo?.closest?.("input,button")) return;
      const noPonto = typeof x === "number" && typeof y === "number" ? document.elementFromPoint(x, y) : null;
      reg(ev.type, { alvo: descrever(ev.target), noPonto: noPonto !== ev.target ? descrever(noPonto) : "=", x: x && Math.round(x), y: y && Math.round(y), padraoBarrado: ev.defaultPrevented });
    }
    const foco = (ev: Event) => reg(ev.type, { alvo: descrever(ev.target), ativo: descrever(document.activeElement) });
    let ultimoVv = "";
    function teclado() {
      if (!vv) return;
      const atual = `${Math.round(vv.height)}@${Math.round(vv.offsetTop)}`;
      if (atual === ultimoVv) return;
      ultimoVv = atual;
      reg("vv", { vv: atual, scrollY: Math.round(scrollY) });
    }
    const erro = (ev: Event) => reg("erro", { msg: String((ev as ErrorEvent).message ?? (ev as PromiseRejectionEvent).reason).slice(0, 200) });
    const sair = () => {
      reg(document.visibilityState === "hidden" ? "escondeu" : "saiu");
      enviar();
    };

    for (const e of EVENTOS_VIDEO) document.addEventListener(e, video, true);
    document.addEventListener("timeupdate", tempo, true);
    for (const e of EVENTOS_TOQUE) document.addEventListener(e, toque, true);
    document.addEventListener("focusin", foco, true);
    document.addEventListener("focusout", foco, true);
    vv?.addEventListener("resize", teclado);
    vv?.addEventListener("scroll", teclado);
    window.addEventListener("error", erro);
    window.addEventListener("unhandledrejection", erro);
    window.addEventListener("pagehide", sair);
    document.addEventListener("visibilitychange", sair);
    const intervalo = setInterval(enviar, 3000);

    return () => {
      for (const e of EVENTOS_VIDEO) document.removeEventListener(e, video, true);
      document.removeEventListener("timeupdate", tempo, true);
      for (const e of EVENTOS_TOQUE) document.removeEventListener(e, toque, true);
      document.removeEventListener("focusin", foco, true);
      document.removeEventListener("focusout", foco, true);
      vv?.removeEventListener("resize", teclado);
      vv?.removeEventListener("scroll", teclado);
      window.removeEventListener("error", erro);
      window.removeEventListener("unhandledrejection", erro);
      window.removeEventListener("pagehide", sair);
      document.removeEventListener("visibilitychange", sair);
      clearInterval(intervalo);
      enviar();
    };
  }, []);

  return null;
}
