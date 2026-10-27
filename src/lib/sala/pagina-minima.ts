import "server-only";

/** Escapa texto para um atributo/conteúdo HTML (usado nos campos ocultos do formulário, que carregam valores que
 *  vieram da query string — nunca confiar neles sem escapar). */
export function escaparHtml(valor: string): string {
  return valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Página HTML mínima (sem CSS/JS externo, `robots: noindex,nofollow`) pros Route Handlers da sala — que não são
 *  Server Components e por isso não podem renderizar JSX diretamente. */
export function paginaMinima(corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<style>
  body{background:#000;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;
       align-items:center;justify-content:center;text-align:center;padding:24px;margin:0}
  button{background:#16a34a;color:#fff;border:0;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:600;cursor:pointer}
  p{font-size:14px;opacity:.7}
</style>
</head>
<body>${corpo}</body>
</html>`;
}

/** Formulário que entra na sala sem clique nenhum em navegador normal (o `<script>` dá `submit()` assim que a
 *  página carrega) — mas é um HTML comum, sem efeito nenhum, para um bot de preview de link (WhatsApp,
 *  facebookexternalhit etc.) que só baixa a página e não executa JS nem envia formulário. */
export function formularioAutoEnvio(acao: string, campos: Record<string, string>, textoBotao: string): string {
  const ocultos = Object.entries(campos)
    .map(([chave, valor]) => `<input type="hidden" name="${escaparHtml(chave)}" value="${escaparHtml(valor)}">`)
    .join("");
  return paginaMinima(`
    <form method="POST" action="${escaparHtml(acao)}">
      ${ocultos}
      <button type="submit">${escaparHtml(textoBotao)}</button>
    </form>
    <script>document.forms[0].submit();</script>
  `);
}
