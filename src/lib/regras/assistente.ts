/** Regras puras do assistente do webinar (os 9 passos). */

/** Chaves (= rotas) dos 9 passos, na ordem. O passo "Webinar" é `/agenda`. Idêntico ao `PASSOS` de
 *  `app/(painel)/webinars/[id]/_passos.tsx`, que acrescenta rótulo e ícone. */
export const CHAVES_PASSOS = [
  "inicio",
  "agenda",
  "login",
  "video",
  "oferta",
  "chat",
  "vendas",
  "agente",
  "pronto",
] as const;

export type ChavePasso = (typeof CHAVES_PASSOS)[number];

/** Rota de um passo. */
export function rotaPasso(webinarId: string, chave: ChavePasso): string {
  return `/webinars/${webinarId}/${chave}`;
}

/** Rota do passo seguinte, ou `null` no último ("Pronto"). */
export function rotaProximoPasso(webinarId: string, atual: ChavePasso): string | null {
  const i = CHAVES_PASSOS.indexOf(atual);
  return i >= 0 && i < CHAVES_PASSOS.length - 1 ? rotaPasso(webinarId, CHAVES_PASSOS[i + 1]) : null;
}

/** Posição (1 a 9) de um passo. */
export function numeroPasso(atual: ChavePasso): number {
  return CHAVES_PASSOS.indexOf(atual) + 1;
}

/**
 * Destino do "Continuar": o campo `proximo` que o formulário do passo manda junto. Só aceita uma rota de passo do
 * próprio webinar (`/webinars/{id}/{passo}`) ou a lista (`/webinars`, o "Concluir"). Qualquer outra coisa (vazio,
 * outro webinar, URL externa, `//host`, query, `..`) vira `null`: a action salva e fica na tela, sem redirecionar.
 */
export function destinoProximo(valor: FormDataEntryValue | string | null | undefined, webinarId: string): string | null {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  if (v === "/webinars") return v;
  const prefixo = `/webinars/${webinarId}/`;
  if (!webinarId || !v.startsWith(prefixo)) return null;
  const resto = v.slice(prefixo.length);
  return (CHAVES_PASSOS as readonly string[]).includes(resto) ? v : null;
}
