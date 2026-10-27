// Links da sala do webinar (os mesmos do passo Pronto e do modal "Links" da lista). Módulo comum: dá pra chamar
// no servidor (passo Pronto) e no cliente (linha da lista).
export type LinkSala = { rotulo: string; url: string; descricao?: string };

/** Links da sala (iguais aos do passo Pronto), montados a partir do endereço da sala e do slug. */
export function linksDaSala(salaUrl: string, slug: string, jit: boolean): LinkSala[] {
  const base = `${salaUrl.replace(/\/+$/, "")}/${slug}`;
  return [
    ...(jit ? [{ rotulo: "Página de inscrição (just in time)", url: `${base}/lp`, descricao: "A pessoa escolhe o horário e se inscreve." }] : []),
    { rotulo: "Sala principal", url: base, descricao: "Link para divulgar." },
    {
      rotulo: "Sala com link mágico",
      url: `${base}?nome={{nome}}&email={{email}}&telefone={{telefone}}`,
      descricao: "Troque {{nome}}, {{email}} e {{telefone}} no disparo: a pessoa entra sem preencher o login.",
    },
    { rotulo: "Sala com replay", url: `${base}?replay=1`, descricao: "Abre a gravação depois do horário." },
  ];
}
