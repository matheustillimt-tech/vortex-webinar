import { urlsBunny, type CfgBunny } from "../bunny/cliente";

// Chat gerado por IA --------------------------------------------------------------------------------------------

export type VideoParaAudio = { origem: "bunny" | "externo"; bunny_guid: string | null; hls_url: string | null };

/** De onde vem o áudio pra transcrever: vídeo do Bunny usa o MP4 de baixa resolução (360p) do CDN — bem mais
 *  rápido pra baixar que o arquivo original, e o Scribe só precisa do áudio. Não tem fallback no servidor: isso
 *  exige que a biblioteca do Bunny tenha "MP4 Fallback" ligado (Bunny Stream → biblioteca → Encoding), senão
 *  `play_360p.mp4` não existe e a transcrição falha. Link externo só serve se já for um MP4 (HLS é streaming
 *  segmentado, o Scribe não aceita como uma URL só) — comparado pelo `pathname` da URL, pra funcionar com query
 *  string (ex.: token de assinatura). */
export function fonteDeAudio(video: VideoParaAudio, cfgBunny: CfgBunny): { url: string } | { erro: string } {
  if (video.origem === "bunny") {
    if (!video.bunny_guid) return { erro: "Vídeo sem arquivo no Bunny." };
    return { url: urlsBunny(cfgBunny, video.bunny_guid, null).audio };
  }
  const url = video.hls_url;
  if (!url) return { erro: "Vídeo sem link." };
  try {
    if (new URL(url).pathname.toLowerCase().endsWith(".mp4")) return { url };
  } catch {
    return { erro: "Para gerar o chat com IA, use um vídeo do Bunny ou um link MP4." };
  }
  return { erro: "Para gerar o chat com IA, use um vídeo do Bunny ou um link MP4." };
}

export type Palavra = { texto: string; inicio: number; fim: number };
export type Bloco = { inicio: number; fim: number; texto: string };

/** Agrupa as palavras da transcrição em blocos de `tamanhoSeg` segundos (padrão 300 = 5 min), pelo instante em
 *  que cada palavra começa. O último bloco usado termina no fim da última palavra (não estica até o limite do
 *  bloco se o áudio acabou antes); blocos sem nenhuma palavra (silêncio) não entram na lista. */
export function blocosDaTranscricao(palavras: Palavra[], tamanhoSeg = 300): Bloco[] {
  if (palavras.length === 0) return [];
  const porIndice = new Map<number, Palavra[]>();
  for (const p of palavras) {
    const indice = Math.floor(p.inicio / tamanhoSeg);
    const lista = porIndice.get(indice);
    if (lista) lista.push(p);
    else porIndice.set(indice, [p]);
  }
  const indices = [...porIndice.keys()].sort((a, b) => a - b);
  const ultimoIndice = indices[indices.length - 1];
  return indices.map((indice) => {
    const lista = porIndice.get(indice)!;
    const inicio = indice * tamanhoSeg;
    const fim = indice === ultimoIndice ? Math.max(inicio, lista[lista.length - 1].fim) : (indice + 1) * tamanhoSeg;
    return { inicio, fim, texto: lista.map((p) => p.texto).join(" ") };
  });
}

export type Intensidade = "baixa" | "media" | "alta";

/** Quantas mensagens por minuto cada intensidade pede. */
export function mensagensPorMinuto(intensidade: Intensidade): number {
  return { baixa: 1, media: 3, alta: 6 }[intensidade];
}

export type OpcoesGeracao = {
  idioma: "pt" | "es" | "en";
  tom: "formal" | "natural";
  intensidade: Intensidade;
  instrucoes?: string | null;
};

const NOME_IDIOMA: Record<OpcoesGeracao["idioma"], string> = { pt: "português do Brasil", es: "espanhol", en: "inglês" };

/** Monta o prompt (sistema + usuário) que pede ao modelo as mensagens de chat simulado pra este bloco da
 *  transcrição, sempre em pt-BR nas instruções, pedindo o conteúdo no idioma escolhido pra geração. */
export function promptGeracao(bloco: Bloco, opcoes: OpcoesGeracao): { sistema: string; usuario: string } {
  const duracao = bloco.fim - bloco.inicio;
  const alvo = Math.max(1, Math.round((duracao / 60) * mensagensPorMinuto(opcoes.intensidade)));
  const tomTexto = opcoes.tom === "formal" ? "mais formal e educado" : "natural e informal, como gente de verdade digitando rápido no chat";

  const sistema = [
    "Você cria mensagens de um chat simulado de um webinar, como se fossem espectadores reais reagindo à aula ao vivo.",
    `Escreva o conteúdo das mensagens em ${NOME_IDIOMA[opcoes.idioma]}, em tom ${tomTexto}.`,
    "Responda SOMENTE com um JSON válido, sem nenhum texto fora dele.",
  ].join(" ");

  const instrucoesTexto = opcoes.instrucoes ? ` Instruções sobre o público: ${opcoes.instrucoes}.` : "";

  const usuario = [
    `Trecho da transcrição da aula, do segundo ${bloco.inicio} ao segundo ${bloco.fim} do vídeo:`,
    `"""${bloco.texto}"""`,
    "",
    `Crie cerca de ${alvo} mensagens de chat reagindo a esse trecho, espalhadas ao longo dos ${duracao} segundos do bloco.${instrucoesTexto}`,
    "Regras: use nomes próprios brasileiros comuns (primeiro nome, às vezes com uma inicial de sobrenome); cada mensagem tem de 1 a 150",
    "caracteres, sem links e sem citar preço ou valor (nunca invente números); no máximo 1 em cada 20 mensagens pode ter",
    '"suporte": true, com "nome": "Suporte" — as demais são "suporte": false.',
    `O campo "segundo" é o instante da mensagem em SEGUNDOS DENTRO DESTE BLOCO: um número entre 0 e ${duracao}, nunca fora disso.`,
    'Devolva só o JSON, no formato: {"mensagens":[{"segundo":0,"nome":"...","texto":"...","suporte":false}]}',
  ].join("\n");

  return { sistema, usuario };
}

export type MensagemGerada = { segundo: number; nome: string; texto: string; suporte: boolean };

const TEM_URL = /https?:\/\/|www\.|\b[\w-]+\.(com|net|org|br|io|ly|me)\b/i;
const TEM_PRECO = /r\$/i;
const NOME_MAXIMO = 40;
const TEXTO_MAXIMO = 150;
/** 1 em cada 20 mensagens, no máximo, pode ser do "Suporte". */
const RAZAO_SUPORTE = 20;

/** Filtra o JSON cru devolvido pelo modelo: descarta mensagens com segundo fora do bloco, texto vazio/longo
 *  (> 150), com link ou com preço/valor (`R$`), e nome vazio/longo (> 40); converte o "segundo" pra absoluto —
 *  normalmente é relativo ao bloco (`bloco.inicio + segundo`), mas alguns modelos devolvem o segundo absoluto do
 *  vídeo mesmo depois de pedir o relativo: quando o valor já cai dentro de `[bloco.inicio, bloco.fim]`, usa ele
 *  direto, sem somar de novo. No máximo 1 em cada 20 mensagens aceitas pode ter `suporte: true` (o excesso vira
 *  `false`); toda mensagem de suporte sai com `nome: "Suporte"`, não importa o que o modelo mandou. Corta a lista
 *  em `limite` mensagens. */
export function validarMensagensGeradas(json: unknown, bloco: Bloco, limite: number): MensagemGerada[] {
  const duracao = bloco.fim - bloco.inicio;
  const lista = Array.isArray((json as { mensagens?: unknown[] } | null)?.mensagens)
    ? ((json as { mensagens: unknown[] }).mensagens)
    : [];

  const validas: MensagemGerada[] = [];
  let suporteCount = 0;
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const segundoBruto = Number(m.segundo);
    const texto = typeof m.texto === "string" ? m.texto.trim() : "";
    let nome = typeof m.nome === "string" ? m.nome.trim() : "";

    if (!Number.isFinite(segundoBruto)) continue;
    let segundoAbsoluto: number;
    if (segundoBruto >= 0 && segundoBruto <= duracao) segundoAbsoluto = bloco.inicio + segundoBruto;
    else if (segundoBruto >= bloco.inicio && segundoBruto <= bloco.fim) segundoAbsoluto = segundoBruto;
    else continue;

    if (!texto || texto.length > TEXTO_MAXIMO) continue;
    if (TEM_URL.test(texto)) continue;
    if (TEM_PRECO.test(texto)) continue;

    let suporte = m.suporte === true;
    if (suporte) {
      // Antes de aceitar mais uma de suporte, confere se a razão 1/20 já não foi atingida com as aceitas até aqui.
      if (suporteCount >= Math.floor((validas.length + 1) / RAZAO_SUPORTE)) suporte = false;
      else suporteCount += 1;
    }
    if (suporte) nome = "Suporte";
    else if (!nome || nome.length > NOME_MAXIMO) continue;

    validas.push({ segundo: Math.round(segundoAbsoluto), nome, texto, suporte });
    if (validas.length >= limite) break;
  }
  return validas;
}

// Agente de IA ---------------------------------------------------------------------------------------------------

export type CfgAgente = { nome?: string | null; instrucoes?: string | null; contexto?: string | null; faq?: string | null };
export type MensagemHistorico = { autor: string; texto: string };

/** Monta o prompt (sistema + usuário) que pede ao modelo se deve responder a `pergunta` e, se sim, com qual
 *  resposta — só usando o contexto/instruções/FAQ do agente, nunca inventando preço ou link. */
/** `momentoSeg`: em que ponto do vídeo a pessoa está (o ponto mais avançado que a sala registrou), pra o agente
 *  respeitar o roteiro da aula (ex.: não falar o preço antes da oferta aparecer). Sem ele, não vai no prompt. */
export function promptAgente(cfg: CfgAgente, pergunta: string, historico: MensagemHistorico[], momentoSeg?: number | null): { sistema: string; usuario: string } {
  const nome = cfg.nome?.trim() || "Suporte";

  const partes = [
    `Você é ${nome} e responde as perguntas que as pessoas mandam no chat ao vivo de um webinar, ali no próprio chat,`,
    "como uma pessoa de verdade digitando: mensagem curta e natural, sem cara de e-mail ou de atendimento automático.",
    "Não comece com o nome nem com @ da pessoa: a marcação dela já aparece sozinha antes da sua resposta.",
    "Responda SOMENTE perguntas sobre o conteúdo da aula ou sobre o produto/oferta, usando apenas as informações abaixo.",
    "Nunca invente preço, prazo, link ou condição que não esteja no contexto ou na FAQ. Seja breve: a resposta tem no",
    "máximo 600 caracteres. Se a mensagem não for uma pergunta sobre o conteúdo ou o produto (for só um comentário,",
    "elogio, ou outro assunto), não responda.",
  ];
  if (cfg.instrucoes) partes.push(`\nInstruções: ${cfg.instrucoes}`);
  if (cfg.contexto) partes.push(`\nContexto do produto:\n${cfg.contexto}`);
  if (cfg.faq) partes.push(`\nPerguntas frequentes:\n${cfg.faq}`);
  partes.push(
    '\nResponda SOMENTE com o JSON: {"responder": true ou false, "resposta": "..."}. Se "responder" for false, deixe "resposta" vazia.',
  );

  const sistema = partes.join(" ").trim();
  const historicoTexto = historico.length ? historico.map((h) => `${h.autor}: ${h.texto}`).join("\n") : "(sem mensagens anteriores)";
  const momento = typeof momentoSeg === "number" && momentoSeg >= 0 ? `Momento da aula em que a pessoa está: ${formatarMomento(momentoSeg)}.\n\n` : "";
  const usuario = `${momento}Histórico recente da conversa:\n${historicoTexto}\n\nMensagem nova: "${pergunta}"`;

  return { sistema, usuario };
}

/** Segundos → `h:mm:ss` (o formato que as instruções do agente usam pra falar dos momentos da aula). */
function formatarMomento(seg: number): string {
  const s = Math.floor(seg);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${dois(Math.floor((s % 3600) / 60))}:${dois(s % 60)}`;
}

/** Lê o JSON devolvido pelo modelo pro agente: só considera que deve responder quando `responder` é `true` e tem
 *  uma `resposta` não vazia; corta a resposta em 600 caracteres por segurança. Qualquer formato inesperado vira
 *  "não responde". */
export function lerRespostaAgente(json: unknown): { responder: boolean; resposta: string } {
  if (!json || typeof json !== "object") return { responder: false, resposta: "" };
  const d = json as Record<string, unknown>;
  const resposta = typeof d.resposta === "string" ? d.resposta.trim() : "";
  if (d.responder !== true || !resposta) return { responder: false, resposta: "" };
  return { responder: true, resposta: resposta.length > 600 ? resposta.slice(0, 600) : resposta };
}

const URL_NA_RESPOSTA = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const PONTUACAO_FINAL = /[,;.:)\]]+$/;

/** O modelo às vezes inventa ou lembra errado um link: só deixa passar uma URL na resposta se ela aparecer,
 *  literalmente, no contexto ou na FAQ configurados — qualquer outra é removida (nunca inventa link). Ignora
 *  pontuação de frase grudada no fim da URL (vírgula, ponto final, etc.) ao comparar com a fonte. */
export function removerLinksNaoAutorizados(resposta: string, cfg: CfgAgente): string {
  const fontes = `${cfg.contexto ?? ""}\n${cfg.faq ?? ""}`;
  return resposta
    .replace(URL_NA_RESPOSTA, (match) => (fontes.includes(match.replace(PONTUACAO_FINAL, "")) ? match : ""))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** A oferta ainda não apareceu pra pessoa (`momentoSeg` antes de `apareceSeg`, ou momento desconhecido): a resposta da
 *  IA não pode levar link, por mais que a FAQ/contexto tenha o link da aplicação. Sem oferta ligada, não trava. */
export function antesDaOferta(momentoSeg: number | null, oferta: { ligada: boolean; apareceSeg: number } | null): boolean {
  if (!oferta || !oferta.ligada) return false;
  return momentoSeg === null || momentoSeg < oferta.apareceSeg;
}

/** Resposta no lugar de uma que mandaria link ou falaria o valor antes da oferta. */
export const RESPOSTA_ANTES_DA_OFERTA =
  "Fica comigo até o final da aula que eu te explico direitinho como funciona pra ter acesso aos agentes, tá?";

export function temLink(texto: string): boolean {
  return /(https?:\/\/|www\.)/i.test(texto);
}

/** Onde a pessoa está no vídeo ao vivo: o mais adiantado entre o relógio da sessão (o vídeo ao vivo segue o relógio)
 *  e o último ponto que a sala registrou; limitado à duração quando ela é conhecida. */
export function momentoAoVivo(o: { inicioSessaoMs: number; agoraMs: number; maxSegundo: number | null; duracaoSeg: number }): number {
  const pelaHora = Math.max(0, Math.floor((o.agoraMs - o.inicioSessaoMs) / 1000));
  const m = Math.max(pelaHora, o.maxSegundo ?? 0);
  return o.duracaoSeg > 20 ? Math.min(m, o.duracaoSeg) : m;
}

/** Números de preço da oferta configurada (ex.: "R$ 4.000", "12x R$ 199,70 ou R$ 1.997 à vista" → 4000, 19970,
 *  199, 1997), só os de 3 dígitos ou mais, pra achar o valor na resposta escrito de qualquer jeito (4.000, 4000, 1997). */
function numerosDosPrecos(precos: (string | null | undefined)[]): string[] {
  const numeros = new Set<string>();
  for (const preco of precos) {
    for (const m of (preco ?? "").matchAll(/\d[\d.,]*/g)) {
      const bruto = m[0].replace(/[.,]$/, "");
      const inteiro = bruto.split(",")[0].replace(/\./g, "");
      const tudo = bruto.replace(/[.,]/g, "");
      for (const n of [inteiro, tudo]) if (n.length >= 3) numeros.add(n);
    }
  }
  return [...numeros];
}

/** A resposta fala do valor da oferta: cita um dos preços configurados (em qualquer formato) ou fala de pagamento
 *  (parcelas tipo "12x", "à vista", "parcela", "desconto"). Números da aula que não são o preço (ex.: "R$ 30 mil") não
 *  contam. */
export function falaDoValor(texto: string, precos: (string | null | undefined)[]): boolean {
  if (/\b\d{1,2}\s*x\b|(^|\s)[àa] vista\b|parcel|desconto/i.test(texto)) return true;
  const soDigitos = (texto.match(/\d[\d.,]*/g) ?? []).flatMap((n) => {
    const limpo = n.replace(/[.,]$/, "");
    return [limpo.replace(/[.,]/g, ""), limpo.split(",")[0].replace(/\./g, "")];
  });
  const numeros = numerosDosPrecos(precos);
  return soDigitos.some((d) => numeros.includes(d));
}
