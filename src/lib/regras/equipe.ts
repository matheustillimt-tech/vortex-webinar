export function validarPessoa(d: { nome: string; email: string; senha: string; papel: string }): string | null {
  if (!d.nome.trim()) return "Informe o nome.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return "E-mail inválido.";
  if (d.senha.length < 8 || !/[A-Za-z]/.test(d.senha) || !/\d/.test(d.senha)) {
    return "A senha precisa ter pelo menos 8 caracteres, com letra e número.";
  }
  if (d.papel !== "admin" && d.papel !== "atendente") return "Papel inválido.";
  return null;
}
