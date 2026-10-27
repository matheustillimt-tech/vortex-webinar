export type Destino = { tipo: "sala"; caminho: string } | { tipo: "redirecionar_sala"; caminho: string } | { tipo: "publica" } | { tipo: "painel" };

/**
 * Host público da requisição: o `x-forwarded-host` quando existe, senão o `host`. Quando uma server action da sala
 * chama `redirect("/<slug>/...")`, o Next monta a próxima tela no próprio servidor com um `fetch` para a origem
 * interna (`localhost:<porta>` no `next dev`/`next start`), repassando os cabeçalhos da requisição original: o
 * `host` vira `localhost` e só o `x-forwarded-host` ainda diz que era a sala. Lendo só o `host`, o middleware
 * tratava como painel e a pessoa via o login do painel depois de se inscrever. Na Vercel os dois coincidem.
 */
export function hostDaRequisicao(cabecalhos: { get(nome: string): string | null }): string {
  const encaminhado = cabecalhos.get("x-forwarded-host")?.split(",")[0]?.trim();
  return encaminhado || cabecalhos.get("host") || "";
}

// Rotas que não pedem login: a sala, o login, e as APIs que se autenticam sozinhas (token da sala, CRON_SECRET,
// token do webhook na URL, chave do MCP).
const PUBLICAS = ["/s", "/login", "/api/sala/", "/api/cron/", "/api/checkout/", "/api/bunny/", "/api/mcp"];

function ehPublica(pathname: string): boolean {
  return PUBLICAS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

export function decidirRota(host: string, pathname: string, cfg: { hostSala: string }): Destino {
  const h = host.toLowerCase().split(":")[0];
  const hostSala = cfg.hostSala.toLowerCase();
  if (hostSala && h === hostSala) {
    // Host vem do header e não é confiável: /api/* na sala segue a mesma lista branca do painel
    // (senão um `Host: aovivo...` falso abriria qualquer API do painel sem login).
    if (pathname.startsWith("/api/")) return ehPublica(pathname) ? { tipo: "publica" } : { tipo: "painel" };
    // Caminho já interno (`/s/<slug>/...`, ex.: um `action` de formulário montado a partir da URL reescrita):
    // fica como está, senão viraria `/s/s/...` (404). Slug tem 3+ caracteres, então `/s/...` nunca é um slug.
    if (pathname === "/s" || pathname.startsWith("/s/")) return { tipo: "sala", caminho: pathname };
    // `/t/<slug>` (teste A/B) vira `/s/t/<slug>` como qualquer outro caminho: a rota estática `app/s/t/[slug]`
    // ganha de `app/s/[slug]`, e um slug de webinar tem 3+ caracteres, então nunca é `t`.
    return { tipo: "sala", caminho: pathname === "/" ? "/s" : `/s${pathname}` };
  }
  // Entrada do teste A/B no domínio do painel: idêntico ao `/s/*`, vai pro domínio da sala. Sem domínio da sala
  // configurado (dev), serve aqui mesmo pela rota interna, sem login.
  if (pathname.startsWith("/t/")) {
    return hostSala ? { tipo: "redirecionar_sala", caminho: pathname } : { tipo: "sala", caminho: `/s${pathname}` };
  }
  // A sala no domínio do painel compartilharia a origem (cookies, localStorage) com o painel, e o script
  // personalizado/pixels do webinar rodariam lá: `/s/*` vai pro mesmo caminho no domínio da sala (sem o `/s`).
  // Sem domínio da sala configurado (dev sem a variável), continua servindo aqui.
  if (hostSala && (pathname === "/s" || pathname.startsWith("/s/"))) {
    return { tipo: "redirecionar_sala", caminho: pathname.slice(2) || "/" };
  }
  return ehPublica(pathname) ? { tipo: "publica" } : { tipo: "painel" };
}
