/** Nome do sistema que aparece no painel (logo do menu e título da aba do navegador). Troque pela variável
 *  `NEXT_PUBLIC_NOME_SISTEMA` (sem ela, fica "Vórtex Webinar"). A sala do participante nunca mostra este nome:
 *  lá aparece só o título da aula. */
export const NOME_SISTEMA = process.env.NEXT_PUBLIC_NOME_SISTEMA || "Vórtex Webinar";
