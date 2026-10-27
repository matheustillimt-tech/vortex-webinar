/** Mostrado no lugar do valor de um header já salvo (nunca decifrado pra tela); se o valor enviado de volta é
 *  exatamente esse, `editarRegra` mantém o valor salvo da chave original da linha (campo escondido
 *  `header_original`; a chave visível pode ter mudado). Em um
 *  arquivo próprio porque um módulo "use server" só pode exportar funções async. */
export const SENTINELA_HEADER = "•••";
