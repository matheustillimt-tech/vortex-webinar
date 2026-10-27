import { lerDuracao } from "./video";
import { validarSlug } from "./slug";

type Campos = Record<string, string | undefined>;
type Resultado<T> = { erro: string } | { dados: T };

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function on(v: string | undefined): boolean {
  return v === "on";
}

/** Texto opcional aparado. Troca `\r\n` por `\n`: o navegador manda as quebras de linha do `<textarea>` como
 *  `\r\n`, e o contador da tela (e o `maxLength`) contam uma só. Sem isso, um texto de 3990 com 61 linhas passava de
 *  4000 no servidor e o passo não salvava. */
function opcional(v: string | undefined): string | null {
  const s = (v ?? "").replace(/\r\n?/g, "\n").trim();
  return s || null;
}

// ---------------------------------------------------------------------------
// Passo 1: Início
// ---------------------------------------------------------------------------

export type Idioma = "pt-BR" | "es" | "en";
const IDIOMAS: Idioma[] = ["pt-BR", "es", "en"];

export type DadosInicio = {
  nome: string;
  titulo: string | null;
  slug: string;
  idioma: Idioma;
  apresentadorNome: string | null;
  acessoFacilitado: boolean;
  loginNaSala: boolean;
  sincronizarVideo: boolean;
};

export function validarInicio(c: Campos): Resultado<DadosInicio> {
  const nome = (c.nome ?? "").trim();
  if (!nome) return { erro: "Dê um nome ao webinar." };
  if (nome.length > 150) return { erro: "Use até 150 caracteres." };

  const tituloBruto = (c.titulo ?? "").trim();
  if (tituloBruto.length > 150) return { erro: "Use até 150 caracteres." };

  const slug = (c.slug ?? "").trim();
  const erroSlug = validarSlug(slug);
  if (erroSlug) return { erro: erroSlug };

  const idioma = c.idioma as Idioma;
  if (!IDIOMAS.includes(idioma)) return { erro: "Escolha o idioma." };

  const apresentadorBruto = (c.apresentador_nome ?? "").trim();
  if (apresentadorBruto.length > 100) return { erro: "Use até 100 caracteres." };

  const acessoFacilitado = on(c.acesso_facilitado);
  const loginNaSala = acessoFacilitado && on(c.login_na_sala);
  const sincronizarVideo = on(c.sincronizar_video);

  return {
    dados: {
      nome,
      titulo: tituloBruto || null,
      slug,
      idioma,
      apresentadorNome: apresentadorBruto || null,
      acessoFacilitado,
      loginNaSala,
      sincronizarVideo,
    },
  };
}

// ---------------------------------------------------------------------------
// Passo 3: Tela de login
// ---------------------------------------------------------------------------

export type Alinhamento = "esquerda" | "centro" | "direita";
const ALINHAMENTOS: Alinhamento[] = ["esquerda", "centro", "direita"];

export type DadosTelaLogin = {
  logoAlinhamento: Alinhamento;
  logoLarguraTotal: boolean;
  barraLigada: boolean;
  barraValor: number;
  barraCor: string;
  barraCorTexto: string;
  botaoCor: string;
  botaoCorTexto: string;
  tituloHtml: string;
  botaoTexto: string;
  pedeEmail: boolean;
  emailObrigatorio: boolean;
  pedeTelefone: boolean;
  telefoneObrigatorio: boolean;
  paisPadrao: string;
  placeholderNome: string | null;
  placeholderEmail: string | null;
  placeholderTelefone: string | null;
};

export function validarTelaLogin(c: Campos): Resultado<DadosTelaLogin> {
  const logoAlinhamento = c.logo_alinhamento as Alinhamento;
  if (!ALINHAMENTOS.includes(logoAlinhamento)) return { erro: "Escolha o alinhamento do logo." };

  const logoLarguraTotal = on(c.logo_largura_total);
  const barraLigada = on(c.barra_ligada);

  const barraValorTexto = (c.barra_valor ?? "").trim();
  if (!/^\d+$/.test(barraValorTexto) || Number(barraValorTexto) > 99) return { erro: "A barra vai de 0 a 99%." };
  const barraValor = Number(barraValorTexto);

  for (const cor of [c.barra_cor, c.barra_cor_texto, c.botao_cor, c.botao_cor_texto]) {
    if (!HEX.test((cor ?? "").trim())) return { erro: "Cor inválida." };
  }
  const barraCor = c.barra_cor!.trim();
  const barraCorTexto = c.barra_cor_texto!.trim();
  const botaoCor = c.botao_cor!.trim();
  const botaoCorTexto = c.botao_cor_texto!.trim();

  const tituloHtml = (c.titulo_html ?? "").trim();
  if (tituloHtml.length > 2000) return { erro: "Use até 2000 caracteres." };

  const botaoTexto = (c.botao_texto ?? "").trim();
  if (!botaoTexto) return { erro: "Escreva o texto do botão." };
  if (botaoTexto.length > 40) return { erro: "Use até 40 caracteres." };

  const emailObrigatorio = on(c.email_obrigatorio);
  const pedeEmail = on(c.pede_email) || emailObrigatorio;
  const telefoneObrigatorio = on(c.telefone_obrigatorio);
  const pedeTelefone = on(c.pede_telefone) || telefoneObrigatorio;

  if (!emailObrigatorio && !telefoneObrigatorio) return { erro: "Deixe e-mail ou WhatsApp como obrigatório." };

  const paisPadrao = (c.pais_padrao ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(paisPadrao)) return { erro: "País inválido." };

  for (const p of [c.placeholder_nome, c.placeholder_email, c.placeholder_telefone]) {
    if ((p ?? "").length > 60) return { erro: "Use até 60 caracteres." };
  }

  return {
    dados: {
      logoAlinhamento,
      logoLarguraTotal,
      barraLigada,
      barraValor,
      barraCor,
      barraCorTexto,
      botaoCor,
      botaoCorTexto,
      tituloHtml,
      botaoTexto,
      pedeEmail,
      emailObrigatorio,
      pedeTelefone,
      telefoneObrigatorio,
      paisPadrao,
      placeholderNome: opcional(c.placeholder_nome),
      placeholderEmail: opcional(c.placeholder_email),
      placeholderTelefone: opcional(c.placeholder_telefone),
    },
  };
}

// ---------------------------------------------------------------------------
// Passo 5: Oferta
// ---------------------------------------------------------------------------

export type LayoutContagem = "classico" | "rotulos" | "urgente";
const LAYOUTS: LayoutContagem[] = ["classico", "rotulos", "urgente"];

export type DadosOferta = {
  ligada: boolean;
  nome: string | null;
  titulo: string | null;
  precoOriginal: string | null;
  precoOferta: string | null;
  botaoTexto: string | null;
  botaoCor: string;
  link: string | null;
  repassarUtms: boolean;
  apareceSeg: number;
  someSeg: number;
  pitchSeg: number | null;
  contagemSeg: number;
  contagemLayout: LayoutContagem;
  sorteioLigado: boolean;
  sorteioSeg: number | null;
  sorteioNumero: string | null;
};

function tempoOuZero(texto: string): number | null {
  const s = texto.trim();
  if (!s || s === "0") return 0;
  return lerDuracao(s);
}

export function validarOferta(c: Campos, duracaoVideoSeg: number | null): Resultado<DadosOferta> {
  const ligada = on(c.ligada);

  const nomeBruto = (c.nome ?? "").trim();
  const tituloBruto = (c.titulo ?? "").trim();
  if (ligada && (!nomeBruto || !tituloBruto)) return { erro: "Dê um nome e um título à oferta." };

  const apareceTexto = (c.aparece ?? "").trim();
  let apareceSeg: number;
  if (!ligada && !apareceTexto) {
    // Oferta desligada e campo em branco: não tem sentido exigir um momento pra algo que não vai aparecer.
    apareceSeg = 1;
  } else {
    const valor = tempoOuZero(apareceTexto);
    if (valor === null) return { erro: "Tempo inválido (h:mm:ss)." };
    if (valor < 1) return { erro: "A oferta precisa aparecer depois do início." };
    apareceSeg = valor;
  }

  const someSeg = tempoOuZero(c.some ?? "");
  if (someSeg === null) return { erro: "Tempo inválido (h:mm:ss)." };
  if (someSeg !== 0 && someSeg <= apareceSeg) return { erro: "A oferta precisa sumir depois de aparecer." };

  const pitchTexto = (c.pitch ?? "").trim();
  let pitchSeg: number | null = null;
  if (pitchTexto) {
    pitchSeg = lerDuracao(pitchTexto);
    if (pitchSeg === null) return { erro: "Tempo inválido (h:mm:ss)." };
  }

  if (duracaoVideoSeg !== null) {
    const excede =
      apareceSeg > duracaoVideoSeg || (someSeg !== 0 && someSeg > duracaoVideoSeg) || (pitchSeg !== null && pitchSeg > duracaoVideoSeg);
    if (excede) return { erro: "Os tempos não podem passar da duração do vídeo (h:mm:ss)." };
  }

  const linkBruto = (c.link ?? "").trim();
  if (linkBruto) {
    let protocolo: string | null = null;
    try {
      protocolo = new URL(linkBruto).protocol;
    } catch {
      protocolo = null;
    }
    if (protocolo !== "https:") return { erro: "Use um link https para o checkout." };
  }
  if (ligada && !linkBruto) return { erro: "Use um link https para o checkout." };

  const contagemSeg = tempoOuZero(c.contagem ?? "");
  if (contagemSeg === null) return { erro: "Tempo inválido (h:mm:ss)." };

  const contagemLayout = c.contagem_layout as LayoutContagem;
  if (!LAYOUTS.includes(contagemLayout)) return { erro: "Escolha o layout da contagem." };

  const botaoCor = (c.botao_cor ?? "").trim();
  if (!HEX.test(botaoCor)) return { erro: "Cor inválida." };

  const sorteioLigado = on(c.sorteio_ligado);
  let sorteioSeg: number | null = null;
  let sorteioNumero: string | null = null;
  if (sorteioLigado) {
    const momentoTexto = (c.sorteio_momento ?? "").trim();
    sorteioSeg = momentoTexto ? lerDuracao(momentoTexto) : null;
    if (sorteioSeg === null) return { erro: "Informe o momento do sorteio (h:mm:ss)." };
    const numero = (c.sorteio_numero ?? "").trim();
    if (!/^\d{1,6}$/.test(numero)) return { erro: "O número do sorteio tem de 1 a 6 dígitos." };
    sorteioNumero = numero;
  }

  return {
    dados: {
      ligada,
      nome: nomeBruto || null,
      titulo: tituloBruto || null,
      precoOriginal: opcional(c.preco_original),
      precoOferta: opcional(c.preco_oferta),
      botaoTexto: opcional(c.botao_texto),
      botaoCor,
      link: linkBruto || null,
      repassarUtms: on(c.repassar_utms),
      apareceSeg,
      someSeg,
      pitchSeg,
      contagemSeg,
      contagemLayout,
      sorteioLigado,
      sorteioSeg,
      sorteioNumero,
    },
  };
}

// ---------------------------------------------------------------------------
// Passo 8: Audiência
// ---------------------------------------------------------------------------

export type ModoAudiencia = "oculto" | "fixo" | "dinamico";
const MODOS_AUDIENCIA: ModoAudiencia[] = ["oculto", "fixo", "dinamico"];
const LIMITE_AUDIENCIA = 100000;

export type DadosAudiencia = { modo: ModoAudiencia; minimo: number | null; maximo: number | null; seloAoVivo: boolean };

function inteiro(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

export function validarAudiencia(c: Campos): Resultado<DadosAudiencia> {
  const modo = c.modo as ModoAudiencia;
  if (!MODOS_AUDIENCIA.includes(modo)) return { erro: "Escolha o modo de audiência." };

  const seloAoVivo = on(c.selo_ao_vivo);

  if (modo === "oculto") return { dados: { modo, minimo: null, maximo: null, seloAoVivo } };

  if (modo === "fixo") {
    const maximo = inteiro(c.maximo);
    if (maximo === null || maximo < 1) return { erro: "Informe o máximo de audiência." };
    if (maximo > LIMITE_AUDIENCIA) return { erro: `O máximo da audiência é ${LIMITE_AUDIENCIA}.` };
    return { dados: { modo, minimo: null, maximo, seloAoVivo } };
  }

  const minimo = inteiro(c.minimo);
  const maximo = inteiro(c.maximo);
  if (minimo === null || maximo === null) return { erro: "Informe o mínimo e o máximo da audiência." };
  if (maximo > LIMITE_AUDIENCIA) return { erro: `O máximo da audiência é ${LIMITE_AUDIENCIA}.` };
  if (minimo > maximo) return { erro: "O mínimo não pode passar do máximo." };
  return { dados: { modo, minimo, maximo, seloAoVivo } };
}

// ---------------------------------------------------------------------------
// Passo 10: Chatbot
// ---------------------------------------------------------------------------

export type DadosChatbot = { remetente: string; palavraChave: string; resposta: string; atrasoSeg: number };

export function validarChatbot(c: Campos): Resultado<DadosChatbot> {
  const remetenteBruto = (c.remetente ?? "").trim();
  if (remetenteBruto.length > 60) return { erro: "Use até 60 caracteres." };
  const remetente = remetenteBruto || "Suporte";

  const palavraChave = (c.palavra_chave ?? "").trim();
  if (!palavraChave) return { erro: "Escreva a palavra-chave." };
  if (palavraChave.length > 80) return { erro: "Use até 80 caracteres." };

  const resposta = opcional(c.resposta) ?? "";
  if (!resposta) return { erro: "Escreva a resposta." };
  if (resposta.length > 400) return { erro: "Use até 400 caracteres." };

  const atrasoTexto = (c.atraso_seg ?? "").trim();
  if (!/^\d*$/.test(atrasoTexto)) return { erro: "O atraso vai de 0 a 600 segundos." };
  const atrasoSeg = atrasoTexto ? Number(atrasoTexto) : 0;
  if (atrasoSeg > 600) return { erro: "O atraso vai de 0 a 600 segundos." };

  return { dados: { remetente, palavraChave, resposta, atrasoSeg } };
}

// ---------------------------------------------------------------------------
// Mensagens e vendas simuladas (formulário de uma linha)
// ---------------------------------------------------------------------------

export type DadosMensagemSimulada = { segundo: number; nome: string; texto: string; suporte: boolean };

export function validarMensagemSimulada(c: Campos): Resultado<DadosMensagemSimulada> {
  const momento = (c.momento ?? "").trim();
  const segundo = momento ? lerDuracao(momento) : null;
  if (segundo === null) return { erro: "Informe o momento da mensagem (h:mm:ss)." };

  const nome = (c.nome ?? "").trim();
  if (!nome) return { erro: "Escreva o nome." };
  if (nome.length > 60) return { erro: "Use até 60 caracteres." };

  const texto = opcional(c.texto) ?? "";
  if (!texto) return { erro: "Escreva a mensagem." };
  if (texto.length > 400) return { erro: "Use até 400 caracteres." };

  return { dados: { segundo, nome, texto, suporte: on(c.suporte) } };
}

export type DadosVendaSimulada = { segundo: number; texto: string };

export function validarVendaSimulada(c: Campos): Resultado<DadosVendaSimulada> {
  const momento = (c.momento ?? "").trim();
  const segundo = momento ? lerDuracao(momento) : null;
  if (segundo === null) return { erro: "Informe o momento da venda (h:mm:ss)." };

  const texto = (c.texto ?? "").trim();
  if (!texto) return { erro: "Escreva o texto da venda." };
  if (texto.length > 200) return { erro: "Use até 200 caracteres." };

  return { dados: { segundo, texto } };
}

const TITULO_NOTIFICACAO_PADRAO = "Venda confirmada!";

export type DadosTituloNotificacaoCompra = { titulo: string };

export function validarTituloNotificacaoCompra(c: Campos): Resultado<DadosTituloNotificacaoCompra> {
  const tituloBruto = (c.titulo_notificacao_compra ?? "").trim();
  if (tituloBruto.length > 150) return { erro: "Use até 150 caracteres." };

  return { dados: { titulo: tituloBruto || TITULO_NOTIFICACAO_PADRAO } };
}

// ---------------------------------------------------------------------------
// Chat gerado por IA e agente de IA
// ---------------------------------------------------------------------------

const IDIOMAS_GERACAO = ["pt", "es", "en"] as const;
const TONS_GERACAO = ["formal", "natural"] as const;
const INTENSIDADES_GERACAO = ["baixa", "media", "alta"] as const;

export type DadosOpcoesGeracao = {
  idioma: (typeof IDIOMAS_GERACAO)[number];
  tom: (typeof TONS_GERACAO)[number];
  intensidade: (typeof INTENSIDADES_GERACAO)[number];
  instrucoes: string | null;
};

/** Formulário "Gerar chat com IA" do passo Chat. */
export function validarOpcoesGeracao(c: Campos): Resultado<DadosOpcoesGeracao> {
  const idioma = c.idioma as DadosOpcoesGeracao["idioma"];
  if (!IDIOMAS_GERACAO.includes(idioma)) return { erro: "Escolha o idioma." };

  const tom = c.tom as DadosOpcoesGeracao["tom"];
  if (!TONS_GERACAO.includes(tom)) return { erro: "Escolha o tom." };

  const intensidade = c.intensidade as DadosOpcoesGeracao["intensidade"];
  if (!INTENSIDADES_GERACAO.includes(intensidade)) return { erro: "Escolha a intensidade." };

  const instrucoes = opcional(c.instrucoes);
  if (instrucoes && instrucoes.length > 400) return { erro: "Use até 400 caracteres nas instruções." };

  return { dados: { idioma, tom, intensidade, instrucoes } };
}

export type DadosAgente = { ligado: boolean; nome: string | null; instrucoes: string | null; contexto: string | null; faq: string | null };

/** Passo Agente de IA (11): liga/desliga, nome, instruções, contexto do produto e FAQ. */
export function validarAgente(c: Campos): Resultado<DadosAgente> {
  const nomeBruto = (c.nome ?? "").trim();
  if (nomeBruto.length > 60) return { erro: "Use até 60 caracteres no nome." };

  const instrucoes = opcional(c.instrucoes);
  if (instrucoes && instrucoes.length > 4000) return { erro: "Use até 4000 caracteres nas instruções." };

  const contexto = opcional(c.contexto);
  if (contexto && contexto.length > 4000) return { erro: "Use até 4000 caracteres no contexto." };

  const faq = opcional(c.faq);
  if (faq && faq.length > 4000) return { erro: "Use até 4000 caracteres na FAQ." };

  return { dados: { ligado: on(c.ligado), nome: nomeBruto || null, instrucoes, contexto, faq } };
}
