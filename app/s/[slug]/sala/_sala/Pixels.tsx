"use client";
import Script from "next/script";
import { useEffect, useState } from "react";
import { gtmValido, noDominioDaSala, pixelMetaValido, pixelTiktokValido } from "@/src/lib/regras/pixels";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    ttq?: { load: (id: string) => void; page: () => void; track: (evento: string) => void };
    dataLayer?: unknown[];
  }
}

type Props = {
  webinarId: string;
  pixelMeta: string | null;
  pixelTiktok: string | null;
  gtm: string | null;
  /** Sessão veio de um cadastro novo nesta mesma visita (não de uma sessão já existente) — só nesse caso a sala
   *  dispara o evento de lead, uma vez. */
  cadastroNovo: boolean;
  /** Script HTML personalizado (Configurações → Integrações do webinar). `null`/vazio = nada a injetar. */
  scriptPersonalizado?: string | null;
  /** Modo teste (link assinado do Pronto): nunca injeta o script personalizado. */
  teste?: boolean;
};

/** Injeta o HTML do script personalizado uma única vez por montagem: recria cada `<script>` (copiando `src`,
 *  texto e os atributos seguros) pra que o navegador o execute — um `<script>` inserido via `innerHTML` fica
 *  inerte — e anexa as outras tags (`noscript`, `img`, `meta`…) como estão. Nunca roda em modo teste. */
function injetarScriptPersonalizado(html: string): void {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ATRIBUTOS_SEGUROS = ["src", "async", "defer", "type", "crossorigin", "integrity", "referrerpolicy"];

  for (const original of Array.from(doc.body.childNodes)) {
    if (original.nodeType !== Node.ELEMENT_NODE) {
      document.body.appendChild(original.cloneNode(true));
      continue;
    }
    const elOriginal = original as Element;
    if (elOriginal.tagName === "SCRIPT") {
      const novo = document.createElement("script");
      for (const nome of ATRIBUTOS_SEGUROS) {
        const valor = elOriginal.getAttribute(nome);
        if (valor !== null) novo.setAttribute(nome, valor);
      }
      novo.text = elOriginal.textContent ?? "";
      document.body.appendChild(novo);
    } else {
      document.body.appendChild(elOriginal.cloneNode(true));
    }
  }
}

/** Injeta Meta Pixel, TikTok Pixel e GTM (IDs validados por regex antes de entrar no HTML) e dispara `PageView`/
 *  `page`/`pageview` uma vez, e `Lead`/`CompleteRegistration`/`lead` uma vez por webinar quando a sessão vem de um
 *  cadastro novo (marcado em `sessionStorage`, pra sobreviver a um recarregamento sem disparar de novo). */
export default function Pixels({ webinarId, pixelMeta, pixelTiktok, gtm, cadastroNovo, scriptPersonalizado, teste = false }: Props) {
  const metaOk = pixelMetaValido(pixelMeta);
  const tiktokOk = pixelTiktokValido(pixelTiktok);
  // `null` até montar (o servidor não sabe o host do navegador; evita hidratação diferente). O evento de lead
  // espera essa resposta pra não marcar "já disparou" antes de o GTM poder receber.
  const [dominioDaSala, setDominioDaSala] = useState<boolean | null>(null);
  const gtmOk = gtmValido(gtm) && dominioDaSala === true;

  useEffect(() => {
    setDominioDaSala(noDominioDaSala(window.location.host, process.env.NEXT_PUBLIC_SALA_URL));
  }, []);

  useEffect(() => {
    if (teste || !scriptPersonalizado) return;
    if (!noDominioDaSala(window.location.host, process.env.NEXT_PUBLIC_SALA_URL)) return;
    try {
      injetarScriptPersonalizado(scriptPersonalizado);
    } catch (e) {
      console.error("Pixels: não deu para injetar o script personalizado:", e);
    }
    // Uma vez por carregamento da página — não depende de nada que mude durante a sessão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (dominioDaSala === null) return;
    if (!metaOk && !tiktokOk && !gtmOk) return;
    const chave = `vw_lead_${webinarId}`;
    let jaDisparou = true;
    try {
      jaDisparou = sessionStorage.getItem(chave) === "1";
    } catch {
      /* sessionStorage indisponível: segue sem marcar (pode disparar de novo num recarregamento, mal menor). */
    }
    if (!cadastroNovo || jaDisparou) return;

    if (metaOk) window.fbq?.("track", "Lead");
    if (tiktokOk) window.ttq?.track("CompleteRegistration");
    if (gtmOk) window.dataLayer?.push({ event: "lead" });

    try {
      sessionStorage.setItem(chave, "1");
    } catch {
      /* idem */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webinarId, metaOk, tiktokOk, gtmOk, cadastroNovo, dominioDaSala]);

  return (
    <>
      {metaOk && (
        <Script id="vw-pixel-meta" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelMeta}');fbq('track','PageView');`}
        </Script>
      )}

      {tiktokOk && (
        <Script id="vw-pixel-tiktok" strategy="afterInteractive">
          {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${pixelTiktok}');ttq.page();}(window,document,'ttq');`}
        </Script>
      )}

      {gtmOk && (
        <Script id="vw-gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`}
        </Script>
      )}
    </>
  );
}
