/** Variáveis das mensagens simuladas. `#nomecompleto` antes de `#nome` (um é prefixo do outro). */
export function trocarNome(texto: string, nomeCompleto: string): string {
  const [primeiro, ...resto] = nomeCompleto.trim().split(/\s+/);
  const nomeCompletoTrim = nomeCompleto.trim();
  const sobrenome = resto.join(" ");
  return texto
    .replace(/#nomecompleto/gi, () => nomeCompletoTrim)
    .replace(/#sobrenome/gi, () => sobrenome)
    .replace(/#nome/gi, () => primeiro ?? "");
}
