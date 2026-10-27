/** Validação dos IDs de pixel/tag antes de injetar qualquer script na sala — nunca confiar no que está salvo no
 *  banco sem bater com o formato esperado. */

const RE_PIXEL_META = /^\d+$/;
const RE_PIXEL_TIKTOK = /^[A-Z0-9]+$/;
const RE_GTM = /^GTM-[A-Z0-9]+$/;

export function pixelMetaValido(id: string | null | undefined): id is string {
  return typeof id === "string" && RE_PIXEL_META.test(id);
}

export function pixelTiktokValido(id: string | null | undefined): id is string {
  return typeof id === "string" && RE_PIXEL_TIKTOK.test(id);
}

export function gtmValido(id: string | null | undefined): id is string {
  return typeof id === "string" && RE_GTM.test(id);
}

/** Cookie de uso único (não httpOnly, 5 min) gravado no servidor quando a entrada acabou de criar um cadastro
 *  novo (login ou link mágico). A sala lê, guarda no `sessionStorage` e apaga — só assim o pixel de lead dispara
 *  depois de um cadastro que deu certo (nunca num envio de formulário que falhou). */
export function nomeCookieNovoCadastro(webinarId: string): string {
  return `vw_novo_cadastro_${webinarId}`;
}

/** Valor do cookie `nome` em `document.cookie` (ou `null`). */
export function valorCookie(cookies: string, nome: string): string | null {
  for (const parte of cookies.split(";")) {
    const i = parte.indexOf("=");
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return null;
}

/** A página está no domínio da sala (`NEXT_PUBLIC_SALA_URL`)? Script personalizado e GTM rodam código arbitrário
 *  e só podem rodar lá — nunca na origem do painel (cookies e sessão do admin). Sem a variável configurada (dev
 *  num host só), não há com o que comparar e vale o host atual. */
export function noDominioDaSala(hostAtual: string, salaUrl: string | undefined): boolean {
  let hostSala = "";
  try {
    hostSala = new URL(salaUrl ?? "").host.toLowerCase();
  } catch {
    return true;
  }
  return hostAtual.toLowerCase() === hostSala;
}
