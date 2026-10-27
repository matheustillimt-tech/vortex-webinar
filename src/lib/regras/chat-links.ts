/** Links no chat da sala: o participante não pode mandar link nenhum, só o da oferta do webinar (mesmo host e
 *  caminho). Pega `http(s)://…`, `www.…` e domínio solto (`site.com`, `bit.ly/x`, `wa.me/55…`); preço e número
 *  (`R$ 1.997`, `12x`) não contam. */
const TLDS =
  "com|net|org|br|io|me|ly|app|co|online|site|store|shop|link|xyz|info|tv|gg|dev|ai|club|biz|vip|top|live|page|click|digital|tech|cc|us|uk|pt|es|ar|mx";
const RE_LINK = new RegExp(
  String.raw`(?:https?:\/\/[^\s<>"']+)|(?:\bwww\.[^\s<>"']+)|(?:\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:${TLDS})\b(?:\/[^\s<>"']*)?)`,
  "gi",
);

function normalizar(link: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`);
  } catch {
    return null;
  }
}

/** Os links encontrados no texto (como digitados). */
export function linksNoTexto(texto: string): string[] {
  return texto.match(RE_LINK) ?? [];
}

/** `true` quando o texto tem algum link que não é o da oferta. */
export function temLinkProibido(texto: string, linkOferta: string | null): boolean {
  const links = linksNoTexto(texto);
  if (links.length === 0) return false;
  const oferta = linkOferta ? normalizar(linkOferta) : null;
  return links.some((l) => {
    const u = normalizar(l.replace(/[.,;:!?)]+$/, ""));
    if (!u || !oferta) return true;
    const host = (h: string) => h.toLowerCase().replace(/^www\./, "");
    return !(host(u.hostname) === host(oferta.hostname) && u.pathname.replace(/\/$/, "") === oferta.pathname.replace(/\/$/, ""));
  });
}
