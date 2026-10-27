/** Regras de webhook (Configurações → Integrações do webinar): validação do formulário, checagem da URL, montagem da requisição com
 *  variáveis e a tabela de espera/desistência das tentativas. Função pura — quem cifra os headers e grava no
 *  banco é a action do painel; quem envia e grava o log é `src/lib/disparos.ts`. */

export const GATILHOS = [
  "acessou",
  "inscreveu_lp",
  "cadastrou",
  "permaneceu",
  "abandonou",
  "pitch",
  "oferta",
  "clicou_oferta",
  "nao_viu_oferta",
] as const;
export type Gatilho = (typeof GATILHOS)[number];

const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Metodo = (typeof METODOS)[number];

const MAX_PARES = 20;
const MAX_CHAVE = 100;
const MAX_VALOR = 2000;
const MAX_CORPO = 10000;

/** Nome de header HTTP válido (`token` da RFC 9110): sem espaço, dois-pontos, acento nem controle. */
const RE_TOKEN_HTTP = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export type CandidataRegra = {
  gatilho: string;
  valorSeg: number | null;
  url: string;
  metodo: string;
  headers: [string, string][];
  params: [string, string][];
  corpo: string | null;
};

export type RegraValidada = {
  gatilho: Gatilho;
  valorSeg: number | null;
  url: string;
  metodo: Metodo;
  headers: [string, string][];
  params: [string, string][];
  corpo: string | null;
};

function ehGatilho(v: string): v is Gatilho {
  return (GATILHOS as readonly string[]).includes(v);
}

function ehMetodo(v: string): v is Metodo {
  return (METODOS as readonly string[]).includes(v);
}

function pares(lista: [string, string][], rotulo: string): { erro: string } | null {
  if (lista.length > MAX_PARES) return { erro: `No máximo 20 ${rotulo}s.` };
  for (const [chave, valor] of lista) {
    if (chave.length < 1 || chave.length > MAX_CHAVE) return { erro: `Chave de ${rotulo} inválida.` };
    if (valor.length > MAX_VALOR) return { erro: `Valor de ${rotulo} muito longo.` };
  }
  return null;
}

/** Valida os campos do formulário de regra (webhook). `{ dados }` com tudo normalizado, ou `{ erro }` com a
 *  primeira mensagem (pt-BR) encontrada. */
export function validarRegra(c: CandidataRegra): { dados: RegraValidada } | { erro: string } {
  if (!ehGatilho(c.gatilho)) return { erro: "Gatilho inválido." };
  if ((c.gatilho === "permaneceu" || c.gatilho === "abandonou") && (c.valorSeg === null || !Number.isInteger(c.valorSeg) || c.valorSeg < 0)) {
    return { erro: "Informe o tempo." };
  }
  if (!urlWebhookPermitida(c.url)) return { erro: "Use um endereço https público." };
  if (!ehMetodo(c.metodo)) return { erro: "Método inválido." };

  const erroHeaders = pares(c.headers, "header");
  if (erroHeaders) return erroHeaders;
  for (const [chave, valor] of c.headers) {
    if (!RE_TOKEN_HTTP.test(chave)) return { erro: "Nome de header inválido." };
    if (/[\r\n\0]/.test(valor)) return { erro: "Valor de header inválido." };
  }
  const erroParams = pares(c.params, "param");
  if (erroParams) return erroParams;

  if (c.corpo !== null && c.corpo.length > MAX_CORPO) return { erro: "Corpo muito longo." };

  return {
    dados: {
      gatilho: c.gatilho,
      valorSeg: c.gatilho === "permaneceu" || c.gatilho === "abandonou" ? c.valorSeg : null,
      url: c.url.trim(),
      metodo: c.metodo,
      headers: c.headers,
      params: c.params,
      corpo: c.corpo,
    },
  };
}

// --- IP literal: só parsing, sem resolução de DNS -----------------------------------------------------------

function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octetos = m.slice(1, 5).map(Number);
  return octetos.every((o) => o >= 0 && o <= 255) ? octetos : null;
}

function ipv4Privado(o: number[]): boolean {
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 ("esta rede")
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (inclui o metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmark)
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reservado e 255.255.255.255
  return false;
}

/** Expande `::` e devolve os 8 grupos de 16 bits (hex), ou `null` se não for um endereço IPv6 válido. Entende
 *  a forma mapeada `::ffff:x.x.x.x` (últimos 32 bits como IPv4 pontuado). */
function parseIPv6(host: string): number[] | null {
  let h = host;
  const mapeado = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (mapeado) {
    const v4 = parseIPv4(mapeado[2]);
    if (!v4) return null;
    const [a, b, c, d] = v4;
    h = `${mapeado[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const partes = h.split("::");
  if (partes.length > 2) return null;
  const grupoDe = (s: string) => (s === "" ? [] : s.split(":"));
  const esquerda = grupoDe(partes[0]);
  const direita = partes.length === 2 ? grupoDe(partes[1]) : [];
  if (partes.length === 1 && esquerda.length !== 8) return null;
  if (partes.length === 2 && esquerda.length + direita.length > 7) return null;

  const faltando = partes.length === 2 ? 8 - esquerda.length - direita.length : 0;
  const todos = [...esquerda, ...Array(faltando).fill("0"), ...direita];
  if (todos.length !== 8) return null;
  const nums = todos.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

function ipv6Privado(g: number[]): boolean {
  // ::/96 inteiro: `::`, `::1` e o antigo "IPv4-compatível" (::a.b.c.d).
  if (g.slice(0, 6).every((x) => x === 0)) return true;
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (unique local)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 (site-local, obsoleto)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return true; // 64:ff9b::/96 (NAT64)
  // ::ffff:x.x.x.x mapeado: já virou um IPv4 nos dois últimos grupos (ver parseIPv6); confere como tal.
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return ipv4Privado([(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff]);
  }
  return false;
}

/** Nomes que sempre apontam pra rede local/interna (com e sem o subdomínio). */
function hostInterno(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true; // inclui metadata.google.internal
  return false;
}

/** `https://` obrigatório; recusa `localhost`/`*.localhost`, `*.local`, `*.internal` e IP literal
 *  privado/loopback/link-local/CGNAT/multicast/reservado (v4 e v6, inclusive mapeado, compatível e NAT64). O ponto
 *  final do FQDN (`localhost.`) sai antes da checagem. Não resolve DNS — um hostname público que aponte pra rede interna passa (defesa é no
 *  destino, não aqui). */
export function urlWebhookPermitida(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;

  let host = u.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  else host = host.replace(/\.+$/, "");
  if (host === "" || hostInterno(host)) return false;

  const v4 = parseIPv4(host);
  if (v4) return !ipv4Privado(v4);

  if (host.includes(":")) {
    const v6 = parseIPv6(host);
    if (v6) return !ipv6Privado(v6);
    return false; // parece IPv6 e não deu pra entender: recusa por segurança
  }

  return true;
}

// --- Variáveis e montagem da requisição ----------------------------------------------------------------------

export type ContextoDisparo = {
  nome: string;
  email: string | null;
  telefone: string | null;
  tag: string;
  dataIso: string;
  utms: Record<string, string>;
  tempoSeg: number;
  webinarNome: string;
};

function querystringUtms(utms: Record<string, string>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(utms)) p.set(k, v);
  return p.toString();
}

function valoresDasVariaveis(c: ContextoDisparo): Record<string, string> {
  return {
    NOME: c.nome,
    EMAIL: c.email ?? "",
    TELEFONE: c.telefone ?? "",
    TAG: c.tag,
    DATA: c.dataIso,
    UTMS: querystringUtms(c.utms),
    TEMPO: String(c.tempoSeg),
    WEBINAR: c.webinarNome,
  };
}

const RE_VARIAVEL = /\{\{(NOME|EMAIL|TELEFONE|TAG|DATA|UTMS|TEMPO|WEBINAR)\}\}/g;

function trocarVariaveis(texto: string, vars: Record<string, string>, transformar: (v: string) => string): string {
  return texto.replace(RE_VARIAVEL, (_, nome: string) => transformar(vars[nome] ?? ""));
}

/** JSON.stringify de um texto devolve `"texto"`; sem as aspas das pontas dá o conteúdo já escapado pra entrar
 *  dentro de uma string JSON existente (`"a\"b"` → `a\"b`). */
function escaparJson(v: string): string {
  return JSON.stringify(v).slice(1, -1);
}

export type RegraParaRequisicao = {
  url: string;
  metodo: Metodo | string;
  headers: [string, string][];
  params: [string, string][];
  corpo: string | null;
};

export type RequisicaoMontada = {
  url: string;
  metodo: string;
  headers: [string, string][];
  corpo: string | null;
  contentType: "application/json" | "text/plain" | null;
};

/** Monta a requisição final: URL com os params trocados e codificados; corpo com as variáveis trocadas (valores
 *  escapados pra string JSON) — se o resultado for JSON válido, `application/json`; senão `text/plain`. Headers
 *  não trocam variável (vêm já decifrados de `disparos.ts`). */
export function montarRequisicao(regra: RegraParaRequisicao, contexto: ContextoDisparo): RequisicaoMontada {
  const vars = valoresDasVariaveis(contexto);

  const u = new URL(regra.url);
  for (const [chave, valorBruto] of regra.params) {
    u.searchParams.set(chave, trocarVariaveis(valorBruto, vars, (v) => v));
  }

  let corpo: string | null = null;
  let contentType: RequisicaoMontada["contentType"] = null;
  if (regra.corpo !== null) {
    corpo = trocarVariaveis(regra.corpo, vars, escaparJson);
    try {
      JSON.parse(corpo);
      contentType = "application/json";
    } catch {
      contentType = "text/plain";
    }
  }

  return { url: u.toString(), metodo: regra.metodo, headers: regra.headers, corpo, contentType };
}

/** 1ª, 2ª e 3ª tentativa esperam 1, 5 e 15 minutos antes da próxima; da 4ª em diante desiste (`null`). */
export function esperaTentativa(n: number): number | null {
  if (n === 1) return 60_000;
  if (n === 2) return 5 * 60_000;
  if (n === 3) return 15 * 60_000;
  return null;
}

const MAPA_EVENTO_GATILHO: Record<string, Gatilho[]> = {
  acessou_sala: ["acessou"],
  fez_login: ["cadastrou"],
  link_magico: ["cadastrou"],
  // `login_provisorio` não entra: o cadastro só se completa no POST /api/sala/cadastro, que grava `fez_login`.
  pitch: ["pitch"],
  oferta: ["oferta"],
  clicou_oferta: ["clicou_oferta"],
  // Inscrição na página do just in time (`/<slug>/lp`).
  inscreveu_lp: ["inscreveu_lp"],
};

/** Gatilhos de regra que um tipo de evento da sala dispara (lista vazia pros eventos que não enfileiram nada). */
export function gatilhosDoEvento(tipoEvento: string): Gatilho[] {
  return MAPA_EVENTO_GATILHO[tipoEvento] ?? [];
}

const ROTULOS: Record<Gatilho, string> = {
  acessou: "Acessou a sala",
  inscreveu_lp: "Inscreveu na página",
  cadastrou: "Cadastrou",
  permaneceu: "Permaneceu",
  abandonou: "Abandonou",
  pitch: "Viu o pitch",
  oferta: "Viu a oferta",
  clicou_oferta: "Clicou na oferta",
  nao_viu_oferta: "Não viu a oferta",
};

export function rotuloGatilho(g: Gatilho): string {
  return ROTULOS[g];
}
