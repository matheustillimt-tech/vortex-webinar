import { describe, expect, it } from "vitest";
import { deslocamentoRelogio, posicaoInicialPlayer, segundoEsperadoAoVivo, transmissaoEncerrada } from "@/src/lib/regras/relogio";
import { conferirPosicaoInicial, correcaoDeDeriva, ehSafariOuIOS, escolherMotorHls, tocandoComDados } from "@/src/lib/regras/player";

const INICIO = Date.UTC(2026, 9, 20, 22, 0, 0);

describe("deslocamentoRelogio / segundoEsperadoAoVivo", () => {
  it("deslocamento = servidor − local", () => {
    expect(deslocamentoRelogio(10_000, 7_000)).toBe(3_000);
    expect(deslocamentoRelogio(7_000, 10_000)).toBe(-3_000);
  });

  it("esperado = (agora corrigido − início) em segundos, com fração", () => {
    expect(segundoEsperadoAoVivo(INICIO, INICIO + 125_500)).toBe(125.5);
  });

  it("antes do início: 0, nunca negativo", () => {
    expect(segundoEsperadoAoVivo(INICIO, INICIO - 5_000)).toBe(0);
  });
});

describe("posicaoInicialPlayer", () => {
  it("ao vivo: começa no relógio da sala", () => {
    expect(posicaoInicialPlayer({ modo: "ao_vivo", esperadoSeg: 1200.4, posicaoReplaySeg: 0, duracaoSeg: 3600 })).toBe(1200.4);
  });

  it("ao vivo depois do fim: limita em duração − 1", () => {
    expect(posicaoInicialPlayer({ modo: "ao_vivo", esperadoSeg: 5000, posicaoReplaySeg: 0, duracaoSeg: 3600 })).toBe(3599);
  });

  it("ao vivo sem duração confiável (<= 20 s): não limita pelo fim", () => {
    expect(posicaoInicialPlayer({ modo: "ao_vivo", esperadoSeg: 500, posicaoReplaySeg: 0, duracaoSeg: 0 })).toBe(500);
  });

  it("replay: retoma a posição salva, limitada a duração − 1", () => {
    expect(posicaoInicialPlayer({ modo: "replay", esperadoSeg: 999, posicaoReplaySeg: 300, duracaoSeg: 3600 })).toBe(300);
    expect(posicaoInicialPlayer({ modo: "replay", esperadoSeg: 999, posicaoReplaySeg: 4000, duracaoSeg: 3600 })).toBe(3599);
  });

  it("teste: sempre do começo", () => {
    expect(posicaoInicialPlayer({ modo: "teste", esperadoSeg: 999, posicaoReplaySeg: 300, duracaoSeg: 3600 })).toBe(0);
  });

  it("valores inválidos viram 0", () => {
    expect(posicaoInicialPlayer({ modo: "ao_vivo", esperadoSeg: Number.NaN, posicaoReplaySeg: 0, duracaoSeg: 3600 })).toBe(0);
    expect(posicaoInicialPlayer({ modo: "replay", esperadoSeg: 0, posicaoReplaySeg: -4, duracaoSeg: 3600 })).toBe(0);
  });
});

describe("transmissaoEncerrada", () => {
  const base = { inicioSessaoMs: INICIO, duracaoSeg: 3600, segundoVideo: 0 };

  it("ao vivo: decide pelo relógio, mesmo com o vídeo atrás", () => {
    expect(transmissaoEncerrada({ ...base, modo: "ao_vivo", agoraServidorMs: INICIO + 3_600_000, segundoVideo: 3500 })).toBe(true);
    expect(transmissaoEncerrada({ ...base, modo: "ao_vivo", agoraServidorMs: INICIO + 3_599_000 })).toBe(false);
  });

  it("ao vivo com duração <= 20 s: nunca encerra pelo relógio", () => {
    expect(transmissaoEncerrada({ ...base, modo: "ao_vivo", duracaoSeg: 20, agoraServidorMs: INICIO + 9_999_999 })).toBe(false);
  });

  it("replay: decide pela posição do vídeo, não pelo relógio", () => {
    expect(transmissaoEncerrada({ ...base, modo: "replay", agoraServidorMs: INICIO + 9_999_999, segundoVideo: 100 })).toBe(false);
    expect(transmissaoEncerrada({ ...base, modo: "replay", agoraServidorMs: INICIO, segundoVideo: 3600 })).toBe(true);
  });

  it("teste: nunca pelo relógio", () => {
    expect(transmissaoEncerrada({ ...base, modo: "teste", agoraServidorMs: INICIO + 9_999_999, segundoVideo: 3600 })).toBe(false);
  });
});

describe("correcaoDeDeriva", () => {
  const base = { tocando: true, encerrado: false, agoraMs: 100_000, ultimaCorrecaoMs: 0, atualSeg: 100, esperadoSeg: 100, duracaoSeg: 3600 };

  it("dentro da tolerância (até 8 s atrasado, até 3 s adiantado): não mexe", () => {
    expect(correcaoDeDeriva(base)).toBeNull();
    expect(correcaoDeDeriva({ ...base, atualSeg: 102.9 })).toBeNull();
    expect(correcaoDeDeriva({ ...base, atualSeg: 92.1 })).toBeNull();
    // O caso do iPhone: 4 s atrás (ainda carregando depois de pular) não pula de novo.
    expect(correcaoDeDeriva({ ...base, atualSeg: 96 })).toBeNull();
  });

  it("atrasado 8 s ou adiantado 3 s: vai pro esperado", () => {
    expect(correcaoDeDeriva({ ...base, atualSeg: 92 })).toBe(100);
    expect(correcaoDeDeriva({ ...base, atualSeg: 103 })).toBe(100);
  });

  it("continua corrigindo no autoplay mudo (só importa estar tocando)", () => {
    expect(correcaoDeDeriva({ ...base, atualSeg: 50 })).toBe(100);
    expect(correcaoDeDeriva({ ...base, atualSeg: 50, tocando: false })).toBeNull();
  });

  it("carência de 15 s depois da última correção (dá tempo do vídeo carregar)", () => {
    expect(correcaoDeDeriva({ ...base, atualSeg: 50, ultimaCorrecaoMs: 86_000 })).toBeNull();
    expect(correcaoDeDeriva({ ...base, atualSeg: 50, ultimaCorrecaoMs: 85_000 })).toBe(100);
  });

  it("encerrado ou esperado além do fim: não mexe", () => {
    expect(correcaoDeDeriva({ ...base, atualSeg: 50, encerrado: true })).toBeNull();
    expect(correcaoDeDeriva({ ...base, atualSeg: 3500, esperadoSeg: 3600 })).toBeNull();
  });
});

describe("ehSafariOuIOS / escolherMotorHls", () => {
  const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
  const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";

  it("detecta Safari e qualquer navegador no iOS", () => {
    expect(ehSafariOuIOS(SAFARI)).toBe(true);
    expect(ehSafariOuIOS(IPHONE_CHROME)).toBe(true);
    expect(ehSafariOuIOS(CHROME)).toBe(false);
    expect(ehSafariOuIOS(ANDROID)).toBe(false);
  });

  it("hls.js sempre que suportado, menos no Safari/iOS com HLS nativo", () => {
    expect(escolherMotorHls({ hlsSuportado: true, tocaNativo: true, safariOuIOS: false })).toBe("hlsjs");
    expect(escolherMotorHls({ hlsSuportado: true, tocaNativo: true, safariOuIOS: true })).toBe("nativo");
    expect(escolherMotorHls({ hlsSuportado: false, tocaNativo: true, safariOuIOS: false })).toBe("nativo");
    expect(escolherMotorHls({ hlsSuportado: true, tocaNativo: false, safariOuIOS: true })).toBe("hlsjs");
  });
});

describe("tocandoComDados", () => {
  const base = { pausado: false, terminou: false, readyState: 4, esperandoDados: false };
  it("tocando com dados futuros: corrige", () => {
    expect(tocandoComDados(base)).toBe(true);
    expect(tocandoComDados({ ...base, readyState: 3 })).toBe(true);
  });
  it("readyState < 3 (só metadados/dado atual): não", () => {
    expect(tocandoComDados({ ...base, readyState: 2 })).toBe(false);
    expect(tocandoComDados({ ...base, readyState: 1 })).toBe(false);
  });
  it("pausado, terminado ou com waiting pendente: não", () => {
    expect(tocandoComDados({ ...base, pausado: true })).toBe(false);
    expect(tocandoComDados({ ...base, terminou: true })).toBe(false);
    expect(tocandoComDados({ ...base, esperandoDados: true })).toBe(false);
  });
});

describe("conferirPosicaoInicial", () => {
  it("tocou do zero depois de atualizar (iPhone ignorou o pulo): volta pro ponto da aula", () => {
    expect(conferirPosicaoInicial({ atualSeg: 0.4, alvoSeg: 312, tentativas: 0 })).toBe(312);
  });
  it("perto do alvo (até 3 s): ok", () => {
    expect(conferirPosicaoInicial({ atualSeg: 310, alvoSeg: 312, tentativas: 0 })).toBe("ok");
  });
  it("depois de 3 tentativas não insiste (nunca fica em laço)", () => {
    expect(conferirPosicaoInicial({ atualSeg: 0, alvoSeg: 312, tentativas: 3 })).toBe("ok");
  });
});
