const EXTENSOES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Teto de cada imagem (bucket `midias`, migração `20261020150000_midias.sql`). */
export const LIMITE_IMAGEM_BYTES = 3 * 1024 * 1024;
/** Teto da soma de todas as imagens de um mesmo envio: o formulário pode ter mais de um campo de arquivo (ex.:
 *  banner desktop + mobile da oferta) e tudo vai no mesmo corpo da server action. */
export const LIMITE_SOMA_IMAGENS_BYTES = 3.8 * 1024 * 1024;

const ERRO_TAMANHO_IMAGEM = "A imagem precisa ter até 3 MB.";
const ERRO_SOMA_IMAGENS = "As imagens juntas passam de 3,8 MB. Envie uma de cada vez.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mensagem do problema, ou null se a imagem serve (tipo e tamanho ok). */
export function validarImagem(tipo: string, bytes: number): string | null {
  if (!EXTENSOES[tipo]) return "Use uma imagem JPG, PNG ou WEBP.";
  if (!(bytes > 0 && bytes <= LIMITE_IMAGEM_BYTES)) return ERRO_TAMANHO_IMAGEM;
  return null;
}

/** Checagem no navegador, antes de enviar o formulário: cada imagem escolhida até `LIMITE_IMAGEM_BYTES`, e a
 *  soma de todas até `LIMITE_SOMA_IMAGENS_BYTES`. `null` se passar. Roda antes do envio (não substitui
 *  `validarImagem`, que o servidor sempre aplica também). */
export function validarImagensDoFormulario(tamanhos: number[]): string | null {
  if (tamanhos.some((b) => b > LIMITE_IMAGEM_BYTES)) return ERRO_TAMANHO_IMAGEM;
  const soma = tamanhos.reduce((a, b) => a + b, 0);
  if (soma > LIMITE_SOMA_IMAGENS_BYTES) return ERRO_SOMA_IMAGENS;
  return null;
}

/** Caminho no bucket `midias`: `webinars/<webinarId>/<id>.<jpg|png|webp>`, ou `webinars/<webinarId>/<pasta>/<id>.<ext>`
 *  com uma `pasta` (ex.: imagens da aba Suporte/Chat em `webinars/<webinarId>/chat/<id>.<ext>`). */
export function caminhoMidia(webinarId: string, tipo: string, id: string, pasta?: string): string {
  return `webinars/${webinarId}/${pasta ? `${pasta}/` : ""}${id}.${EXTENSOES[tipo]}`;
}

/** O `webinarId` vem direto da URL/formulário: antes de subir pro storage, confirma que é um UUID (evita gravar
 *  num caminho qualquer com um id inválido/malicioso). */
export function idValido(id: string): boolean {
  return UUID.test(id);
}

/** A `imagemUrl` que a sala manda em `POST /api/sala/mensagem` tem de ser uma imagem que a própria sala subiu
 *  (`POST /api/sala/imagem`): bucket `midias` deste projeto (mesmo `supabaseUrl`), caminho
 *  `webinars/<webinarId>/chat/<arquivo>`. Nunca aceita uma URL de outro host/bucket/webinar. */
export function urlImagemChatValida(url: string, webinarId: string, supabaseUrl: string): boolean {
  const prefixo = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/midias/webinars/${webinarId}/chat/`;
  if (!url.startsWith(prefixo)) return false;
  const resto = url.slice(prefixo.length);
  return /^[^/]+\.(jpg|png|webp)$/i.test(resto);
}

// Imagens do editor de páginas: além de JPG/PNG/WEBP aceitam GIF (bucket `midias`, migração
// `20261023100000_midias_gif.sql`), mesmo teto de 3 MB. Caminho `paginas/<paginaId>/<id>.<ext>`.
const EXTENSOES_PAGINA: Record<string, string> = { ...EXTENSOES, "image/gif": "gif" };

export function validarImagemPagina(tipo: string, bytes: number): string | null {
  if (!EXTENSOES_PAGINA[tipo]) return "Use uma imagem JPG, PNG, WEBP ou GIF.";
  if (!(bytes > 0 && bytes <= LIMITE_IMAGEM_BYTES)) return ERRO_TAMANHO_IMAGEM;
  return null;
}

export function caminhoImagemPagina(paginaId: string, tipo: string, id: string): string {
  return `paginas/${paginaId}/${id}.${EXTENSOES_PAGINA[tipo]}`;
}
