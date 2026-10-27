import { describe, expect, it } from "vitest";
import {
  validarAgente,
  validarAudiencia,
  validarChatbot,
  validarInicio,
  validarMensagemSimulada,
  validarOferta,
  validarTelaLogin,
  validarVendaSimulada,
} from "../src/lib/regras/passos";

describe("validarInicio", () => {
  const base = {
    nome: "Minha Aula",
    titulo: "Título",
    slug: "minha-aula",
    idioma: "pt-BR",
    apresentador_nome: "Fulano",
  };

  it("campos válidos → dados", () => {
    const r = validarInicio(base);
    expect(r).toEqual({
      dados: {
        nome: "Minha Aula",
        titulo: "Título",
        slug: "minha-aula",
        idioma: "pt-BR",
        apresentadorNome: "Fulano",
        acessoFacilitado: false,
        loginNaSala: false,
        sincronizarVideo: false,
      },
    });
  });

  it("nome vazio → erro", () => {
    expect(validarInicio({ ...base, nome: "  " })).toEqual({ erro: "Dê um nome ao webinar." });
  });

  it("nome maior que 150 → erro", () => {
    expect(validarInicio({ ...base, nome: "a".repeat(151) })).toEqual({ erro: "Use até 150 caracteres." });
  });

  it("titulo vazio → titulo null", () => {
    const r = validarInicio({ ...base, titulo: "" });
    expect("dados" in r && r.dados.titulo).toBeNull();
  });

  it("titulo maior que 150 → erro", () => {
    expect(validarInicio({ ...base, titulo: "a".repeat(151) })).toEqual({ erro: "Use até 150 caracteres." });
  });

  it("slug inválido → mensagem do validarSlug", () => {
    expect(validarInicio({ ...base, slug: "a" })).toEqual({ erro: "Use de 3 a 60 caracteres." });
  });

  it("idioma inválido → erro", () => {
    expect(validarInicio({ ...base, idioma: "fr" })).toEqual({ erro: "Escolha o idioma." });
  });

  it("apresentador maior que 100 → erro", () => {
    expect(validarInicio({ ...base, apresentador_nome: "a".repeat(101) })).toEqual({ erro: "Use até 100 caracteres." });
  });

  it("apresentador vazio → null", () => {
    const r = validarInicio({ ...base, apresentador_nome: "" });
    expect("dados" in r && r.dados.apresentadorNome).toBeNull();
  });

  it("login_na_sala sem acesso_facilitado → grava false", () => {
    const r = validarInicio({ ...base, login_na_sala: "on" });
    expect("dados" in r && r.dados.loginNaSala).toBe(false);
  });

  it("login_na_sala com acesso_facilitado → true", () => {
    const r = validarInicio({ ...base, acesso_facilitado: "on", login_na_sala: "on" });
    expect("dados" in r && r.dados).toMatchObject({ acessoFacilitado: true, loginNaSala: true });
  });

  it("sincronizar_video marcado → true", () => {
    const r = validarInicio({ ...base, sincronizar_video: "on" });
    expect("dados" in r && r.dados.sincronizarVideo).toBe(true);
  });
});

describe("validarTelaLogin", () => {
  const base = {
    logo_alinhamento: "centro",
    barra_valor: "50",
    barra_cor: "#fff",
    barra_cor_texto: "#000000",
    botao_cor: "#123abc",
    botao_cor_texto: "#fff",
    titulo_html: "<b>Oi</b>",
    botao_texto: "Entrar",
    email_obrigatorio: "on",
    pede_email: "on",
    pais_padrao: "br",
  };

  it("campos válidos → dados", () => {
    const r = validarTelaLogin(base);
    expect(r).toEqual({
      dados: {
        logoAlinhamento: "centro",
        logoLarguraTotal: false,
        barraLigada: false,
        barraValor: 50,
        barraCor: "#fff",
        barraCorTexto: "#000000",
        botaoCor: "#123abc",
        botaoCorTexto: "#fff",
        tituloHtml: "<b>Oi</b>",
        botaoTexto: "Entrar",
        pedeEmail: true,
        emailObrigatorio: true,
        pedeTelefone: false,
        telefoneObrigatorio: false,
        paisPadrao: "BR",
        placeholderNome: null,
        placeholderEmail: null,
        placeholderTelefone: null,
      },
    });
  });

  it("alinhamento inválido → erro", () => {
    expect(validarTelaLogin({ ...base, logo_alinhamento: "topo" })).toEqual({ erro: "Escolha o alinhamento do logo." });
  });

  it("barra_valor 100 → erro", () => {
    expect(validarTelaLogin({ ...base, barra_valor: "100" })).toEqual({ erro: "A barra vai de 0 a 99%." });
  });

  it("barra_valor não numérico → erro", () => {
    expect(validarTelaLogin({ ...base, barra_valor: "abc" })).toEqual({ erro: "A barra vai de 0 a 99%." });
  });

  it("barra_valor 99 → ok", () => {
    const r = validarTelaLogin({ ...base, barra_valor: "99" });
    expect("dados" in r && r.dados.barraValor).toBe(99);
  });

  it.each(["barra_cor", "barra_cor_texto", "botao_cor", "botao_cor_texto"])("%s inválida → Cor inválida.", (campo) => {
    expect(validarTelaLogin({ ...base, [campo]: "vermelho" })).toEqual({ erro: "Cor inválida." });
  });

  it("titulo_html maior que 2000 → erro", () => {
    expect(validarTelaLogin({ ...base, titulo_html: "a".repeat(2001) })).toEqual({ erro: "Use até 2000 caracteres." });
  });

  it("botao_texto vazio → erro", () => {
    expect(validarTelaLogin({ ...base, botao_texto: "" })).toEqual({ erro: "Escreva o texto do botão." });
  });

  it("botao_texto maior que 40 → erro", () => {
    expect(validarTelaLogin({ ...base, botao_texto: "a".repeat(41) })).toEqual({ erro: "Use até 40 caracteres." });
  });

  it("nem email nem telefone obrigatório → erro", () => {
    expect(validarTelaLogin({ ...base, email_obrigatorio: undefined })).toEqual({ erro: "Deixe e-mail ou WhatsApp como obrigatório." });
  });

  it("telefone_obrigatorio sem pede_telefone → força pedeTelefone", () => {
    const r = validarTelaLogin({ ...base, telefone_obrigatorio: "on" });
    expect("dados" in r && r.dados).toMatchObject({ pedeTelefone: true, telefoneObrigatorio: true });
  });

  it("pais_padrao com 3 letras → erro", () => {
    expect(validarTelaLogin({ ...base, pais_padrao: "bra" })).toEqual({ erro: "País inválido." });
  });

  it.each(["placeholder_nome", "placeholder_email", "placeholder_telefone"])("%s maior que 60 → erro", (campo) => {
    expect(validarTelaLogin({ ...base, [campo]: "a".repeat(61) })).toEqual({ erro: "Use até 60 caracteres." });
  });

  it("placeholders preenchidos → mantidos", () => {
    const r = validarTelaLogin({ ...base, placeholder_nome: "Nome", placeholder_email: "E-mail", placeholder_telefone: "Tel" });
    expect("dados" in r && r.dados).toMatchObject({ placeholderNome: "Nome", placeholderEmail: "E-mail", placeholderTelefone: "Tel" });
  });
});

describe("validarOferta", () => {
  const base = {
    aparece: "0:01:00",
    some: "",
    contagem: "",
    contagem_layout: "classico",
    botao_cor: "#fff",
  };

  it("desligada, campos mínimos válidos → dados", () => {
    const r = validarOferta(base, null);
    expect(r).toEqual({
      dados: {
        ligada: false,
        nome: null,
        titulo: null,
        precoOriginal: null,
        precoOferta: null,
        botaoTexto: null,
        botaoCor: "#fff",
        link: null,
        repassarUtms: false,
        apareceSeg: 60,
        someSeg: 0,
        pitchSeg: null,
        contagemSeg: 0,
        contagemLayout: "classico",
        sorteioLigado: false,
        sorteioSeg: null,
        sorteioNumero: null,
      },
    });
  });

  it("ligada sem nome/titulo → erro", () => {
    expect(validarOferta({ ...base, ligada: "on" }, null)).toEqual({ erro: "Dê um nome e um título à oferta." });
  });

  it("ligada com nome/titulo mas sem link → erro", () => {
    expect(validarOferta({ ...base, ligada: "on", nome: "N", titulo: "T" }, null)).toEqual({ erro: "Use um link https para o checkout." });
  });

  it("ligada com link https → ok", () => {
    const r = validarOferta({ ...base, ligada: "on", nome: "N", titulo: "T", link: "https://x.com/checkout" }, null);
    expect("dados" in r && r.dados.link).toBe("https://x.com/checkout");
  });

  it("link http (não https) → erro", () => {
    expect(validarOferta({ ...base, link: "http://x.com" }, null)).toEqual({ erro: "Use um link https para o checkout." });
  });

  it("link https malformado (sem host) → erro (new URL valida de verdade, não só o prefixo)", () => {
    expect(validarOferta({ ...base, link: "https://" }, null)).toEqual({ erro: "Use um link https para o checkout." });
  });

  it("link que não é uma URL → erro", () => {
    expect(validarOferta({ ...base, link: "não é um link" }, null)).toEqual({ erro: "Use um link https para o checkout." });
  });

  it("aparece antes de 1s (0:00:00) → erro", () => {
    expect(validarOferta({ ...base, aparece: "0:00:00" }, null)).toEqual({ erro: "A oferta precisa aparecer depois do início." });
  });

  it("oferta desligada e aparece vazio → usa 1s de padrão (não erra)", () => {
    const r = validarOferta({ ...base, aparece: "" }, null);
    expect("dados" in r && r.dados.apareceSeg).toBe(1);
  });

  it("oferta ligada e aparece vazio → ainda erra (precisa de um momento real pra aparecer)", () => {
    expect(validarOferta({ ...base, ligada: "on", nome: "N", titulo: "T", link: "https://x.com", aparece: "" }, null)).toEqual({
      erro: "A oferta precisa aparecer depois do início.",
    });
  });

  it("some igual a aparece → erro", () => {
    expect(validarOferta({ ...base, some: "0:01:00" }, null)).toEqual({ erro: "A oferta precisa sumir depois de aparecer." });
  });

  it("some antes de aparece → erro", () => {
    expect(validarOferta({ ...base, aparece: "0:02:00", some: "0:01:00" }, null)).toEqual({ erro: "A oferta precisa sumir depois de aparecer." });
  });

  it("some depois de aparece → ok", () => {
    const r = validarOferta({ ...base, aparece: "0:01:00", some: "0:02:00" }, null);
    expect("dados" in r && r.dados.someSeg).toBe(120);
  });

  it("some '0' → não some", () => {
    const r = validarOferta({ ...base, some: "0" }, null);
    expect("dados" in r && r.dados.someSeg).toBe(0);
  });

  it("aparece além da duração do vídeo → erro", () => {
    expect(validarOferta({ ...base, aparece: "0:02:00" }, 60)).toEqual({ erro: "Os tempos não podem passar da duração do vídeo (h:mm:ss)." });
  });

  it("pitch além da duração do vídeo → erro", () => {
    expect(validarOferta({ ...base, pitch: "0:02:00" }, 90)).toEqual({ erro: "Os tempos não podem passar da duração do vídeo (h:mm:ss)." });
  });

  it("tempos dentro da duração → ok", () => {
    const r = validarOferta({ ...base, pitch: "0:00:30" }, 3600);
    expect("dados" in r && r.dados.pitchSeg).toBe(30);
  });

  it("contagem vazia → 0", () => {
    const r = validarOferta(base, null);
    expect("dados" in r && r.dados.contagemSeg).toBe(0);
  });

  it("layout inválido → erro", () => {
    expect(validarOferta({ ...base, contagem_layout: "feio" }, null)).toEqual({ erro: "Escolha o layout da contagem." });
  });

  it("botao_cor inválida → Cor inválida.", () => {
    expect(validarOferta({ ...base, botao_cor: "azul" }, null)).toEqual({ erro: "Cor inválida." });
  });

  it("sorteio ligado sem momento → erro", () => {
    expect(validarOferta({ ...base, sorteio_ligado: "on", sorteio_numero: "123" }, null)).toEqual({ erro: "Informe o momento do sorteio (h:mm:ss)." });
  });

  it("sorteio ligado com número de 7 dígitos → erro", () => {
    expect(validarOferta({ ...base, sorteio_ligado: "on", sorteio_momento: "0:00:10", sorteio_numero: "1234567" }, null)).toEqual({
      erro: "O número do sorteio tem de 1 a 6 dígitos.",
    });
  });

  it("sorteio ligado com dados válidos → ok", () => {
    const r = validarOferta({ ...base, sorteio_ligado: "on", sorteio_momento: "0:00:10", sorteio_numero: "123456" }, null);
    expect("dados" in r && r.dados).toMatchObject({ sorteioLigado: true, sorteioSeg: 10, sorteioNumero: "123456" });
  });

  it("repassar_utms marcado → true", () => {
    const r = validarOferta({ ...base, repassar_utms: "on" }, null);
    expect("dados" in r && r.dados.repassarUtms).toBe(true);
  });
});

describe("validarAudiencia", () => {
  it("modo inválido → erro", () => {
    expect(validarAudiencia({ modo: "x" })).toEqual({ erro: "Escolha o modo de audiência." });
  });

  it("oculto → minimo e maximo null", () => {
    expect(validarAudiencia({ modo: "oculto" })).toEqual({ dados: { modo: "oculto", minimo: null, maximo: null, seloAoVivo: false } });
  });

  it("fixo sem maximo → erro", () => {
    expect(validarAudiencia({ modo: "fixo" })).toEqual({ erro: "Informe o máximo de audiência." });
  });

  it("fixo com maximo 0 → erro", () => {
    expect(validarAudiencia({ modo: "fixo", maximo: "0" })).toEqual({ erro: "Informe o máximo de audiência." });
  });

  it("fixo acima do limite → erro", () => {
    expect(validarAudiencia({ modo: "fixo", maximo: "100001" })).toEqual({ erro: "O máximo da audiência é 100000." });
  });

  it("fixo válido → dados", () => {
    expect(validarAudiencia({ modo: "fixo", maximo: "500" })).toEqual({ dados: { modo: "fixo", minimo: null, maximo: 500, seloAoVivo: false } });
  });

  it("dinamico sem minimo/maximo → erro", () => {
    expect(validarAudiencia({ modo: "dinamico" })).toEqual({ erro: "Informe o mínimo e o máximo da audiência." });
  });

  it("dinamico com minimo maior que maximo → erro", () => {
    expect(validarAudiencia({ modo: "dinamico", minimo: "10", maximo: "5" })).toEqual({ erro: "O mínimo não pode passar do máximo." });
  });

  it("dinamico com minimo igual a maximo → ok", () => {
    expect(validarAudiencia({ modo: "dinamico", minimo: "5", maximo: "5" })).toEqual({ dados: { modo: "dinamico", minimo: 5, maximo: 5, seloAoVivo: false } });
  });

  it("dinamico com minimo 0 → ok", () => {
    const r = validarAudiencia({ modo: "dinamico", minimo: "0", maximo: "100" });
    expect("dados" in r && r.dados.minimo).toBe(0);
  });

  it("selo_ao_vivo marcado → true", () => {
    const r = validarAudiencia({ modo: "oculto", selo_ao_vivo: "on" });
    expect("dados" in r && r.dados.seloAoVivo).toBe(true);
  });
});

describe("validarChatbot", () => {
  it("campos válidos → dados com remetente padrão", () => {
    expect(validarChatbot({ palavra_chave: "preco", resposta: "R$ 100" })).toEqual({
      dados: { remetente: "Suporte", palavraChave: "preco", resposta: "R$ 100", atrasoSeg: 0 },
    });
  });

  it("remetente maior que 60 → erro", () => {
    expect(validarChatbot({ remetente: "a".repeat(61), palavra_chave: "x", resposta: "y" })).toEqual({ erro: "Use até 60 caracteres." });
  });

  it("palavra_chave vazia → erro", () => {
    expect(validarChatbot({ resposta: "y" })).toEqual({ erro: "Escreva a palavra-chave." });
  });

  it("palavra_chave maior que 80 → erro", () => {
    expect(validarChatbot({ palavra_chave: "a".repeat(81), resposta: "y" })).toEqual({ erro: "Use até 80 caracteres." });
  });

  it("resposta vazia → erro", () => {
    expect(validarChatbot({ palavra_chave: "x" })).toEqual({ erro: "Escreva a resposta." });
  });

  it("resposta maior que 400 → erro", () => {
    expect(validarChatbot({ palavra_chave: "x", resposta: "a".repeat(401) })).toEqual({ erro: "Use até 400 caracteres." });
  });

  it("atraso fora de 0-600 → erro", () => {
    expect(validarChatbot({ palavra_chave: "x", resposta: "y", atraso_seg: "601" })).toEqual({ erro: "O atraso vai de 0 a 600 segundos." });
  });

  it("atraso válido → dados", () => {
    const r = validarChatbot({ palavra_chave: "x", resposta: "y", atraso_seg: "30" });
    expect("dados" in r && r.dados.atrasoSeg).toBe(30);
  });
});

describe("validarMensagemSimulada", () => {
  it("campos válidos → dados", () => {
    expect(validarMensagemSimulada({ momento: "0:00:10", nome: "Ana", texto: "Oi!" })).toEqual({
      dados: { segundo: 10, nome: "Ana", texto: "Oi!", suporte: false },
    });
  });

  it("momento inválido → erro", () => {
    expect(validarMensagemSimulada({ momento: "abc", nome: "Ana", texto: "Oi!" })).toEqual({ erro: "Informe o momento da mensagem (h:mm:ss)." });
  });

  it("nome vazio → erro", () => {
    expect(validarMensagemSimulada({ momento: "0:00:10", texto: "Oi!" })).toEqual({ erro: "Escreva o nome." });
  });

  it("nome maior que 60 → erro", () => {
    expect(validarMensagemSimulada({ momento: "0:00:10", nome: "a".repeat(61), texto: "Oi!" })).toEqual({ erro: "Use até 60 caracteres." });
  });

  it("texto vazio → erro", () => {
    expect(validarMensagemSimulada({ momento: "0:00:10", nome: "Ana" })).toEqual({ erro: "Escreva a mensagem." });
  });

  it("texto maior que 400 → erro", () => {
    expect(validarMensagemSimulada({ momento: "0:00:10", nome: "Ana", texto: "a".repeat(401) })).toEqual({ erro: "Use até 400 caracteres." });
  });

  it("suporte marcado → true", () => {
    const r = validarMensagemSimulada({ momento: "0:00:10", nome: "Ana", texto: "Oi!", suporte: "on" });
    expect("dados" in r && r.dados.suporte).toBe(true);
  });
});

describe("validarVendaSimulada", () => {
  it("campos válidos → dados", () => {
    expect(validarVendaSimulada({ momento: "0:00:10", texto: "Fulano comprou" })).toEqual({ dados: { segundo: 10, texto: "Fulano comprou" } });
  });

  it("momento inválido → erro", () => {
    expect(validarVendaSimulada({ momento: "", texto: "x" })).toEqual({ erro: "Informe o momento da venda (h:mm:ss)." });
  });

  it("texto vazio → erro", () => {
    expect(validarVendaSimulada({ momento: "0:00:10" })).toEqual({ erro: "Escreva o texto da venda." });
  });

  it("texto maior que 200 → erro", () => {
    expect(validarVendaSimulada({ momento: "0:00:10", texto: "a".repeat(201) })).toEqual({ erro: "Use até 200 caracteres." });
  });
});

describe("quebras de linha do textarea (\\r\\n)", () => {
  it("contam como um caractere, como no contador da tela", () => {
    const faq = `${"a".repeat(39)}\r\n`.repeat(99) + "a".repeat(39); // 3999 na tela, 4098 com \r\n
    const r = validarAgente({ faq });
    expect("dados" in r && r.dados.faq?.length).toBe(3999);
    expect("dados" in r && r.dados.faq?.includes("\r")).toBe(false);
  });

  it("valem na resposta do chatbot e na mensagem simulada", () => {
    const texto = `${"a".repeat(9)}\r\n`.repeat(39) + "a".repeat(9); // 399 na tela
    expect("dados" in validarChatbot({ palavra_chave: "oi", resposta: texto })).toBe(true);
    expect("dados" in validarMensagemSimulada({ nome: "Ana", texto, momento: "00:01:00" })).toBe(true);
  });
});
