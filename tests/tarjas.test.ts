import { describe, expect, it } from "vitest";
import { formatarMomentoTarja, lerMomentoTarja, tarjaAtiva, validarTarja } from "@/src/lib/regras/tarjas";

const OK = { texto: "Nós vamos fechar a sala, não saia dela!", aparece: "0:00:02", duracao_seg: "15", posicao: "topo", cor: "vermelho" };

describe("validarTarja", () => {
  it("caso típico: 2 s depois de entrar, 15 s, topo, vermelho, nasce ligada", () => {
    expect(validarTarja(OK, 3600)).toEqual({
      dados: { texto: "Nós vamos fechar a sala, não saia dela!", apareceSeg: 2, duracaoSeg: 15, posicao: "topo", cor: "vermelho", ligada: true },
    });
  });

  it("texto obrigatório, apara e junta espaços/quebras numa linha só", () => {
    expect(validarTarja({ ...OK, texto: "   " }, null)).toEqual({ erro: "Escreva o texto da tarja." });
    const r = validarTarja({ ...OK, texto: "  Não\r\nsaia   agora  " }, null);
    expect("dados" in r && r.dados.texto).toBe("Não saia agora");
  });

  it("texto até 120 caracteres", () => {
    expect("dados" in validarTarja({ ...OK, texto: "a".repeat(120) }, null)).toBe(true);
    expect(validarTarja({ ...OK, texto: "a".repeat(121) }, null)).toEqual({ erro: "Use até 120 caracteres." });
  });

  it("momento: h:mm:ss, m:ss ou só segundos; vazio ou inválido dá erro", () => {
    expect((validarTarja({ ...OK, aparece: "1:02:03" }, null) as { dados: { apareceSeg: number } }).dados.apareceSeg).toBe(3723);
    expect((validarTarja({ ...OK, aparece: "0:05" }, null) as { dados: { apareceSeg: number } }).dados.apareceSeg).toBe(5);
    expect((validarTarja({ ...OK, aparece: "0" }, null) as { dados: { apareceSeg: number } }).dados.apareceSeg).toBe(0);
    for (const aparece of ["", "abc", "0:60", "-1", "1:2:3:4"]) {
      expect(validarTarja({ ...OK, aparece }, null)).toEqual({ erro: "Informe quando a tarja aparece (h:mm:ss)." });
    }
  });

  it("momento dentro da duração do vídeo, quando houver", () => {
    expect("dados" in validarTarja({ ...OK, aparece: "0:29:59" }, 1800)).toBe(true);
    expect(validarTarja({ ...OK, aparece: "0:30:00" }, 1800)).toEqual({ erro: "O vídeo tem 30:00: escolha um momento antes do fim." });
    // Sem vídeo (ou duração desconhecida): não limita.
    expect("dados" in validarTarja({ ...OK, aparece: "5:00:00" }, null)).toBe(true);
    expect("dados" in validarTarja({ ...OK, aparece: "5:00:00" }, 0)).toBe(true);
  });

  it("duração entre 3 e 600 (vazia = 15)", () => {
    expect((validarTarja({ ...OK, duracao_seg: "" }, null) as { dados: { duracaoSeg: number } }).dados.duracaoSeg).toBe(15);
    expect("dados" in validarTarja({ ...OK, duracao_seg: "3" }, null)).toBe(true);
    expect("dados" in validarTarja({ ...OK, duracao_seg: "600" }, null)).toBe(true);
    for (const duracao_seg of ["2", "601", "-5", "1.5", "abc"]) {
      expect(validarTarja({ ...OK, duracao_seg }, null)).toEqual({ erro: "A duração vai de 3 a 600 segundos." });
    }
  });

  it("posição e cor só das listas", () => {
    expect(validarTarja({ ...OK, posicao: "meio" }, null)).toEqual({ erro: "Escolha a posição da tarja." });
    expect(validarTarja({ ...OK, cor: "azul" }, null)).toEqual({ erro: "Escolha a cor da tarja." });
    for (const cor of ["vermelho", "amarelo", "verde", "preto"]) expect("dados" in validarTarja({ ...OK, cor }, null)).toBe(true);
    expect((validarTarja({ ...OK, posicao: "base" }, null) as { dados: { posicao: string } }).dados.posicao).toBe("base");
  });

  it("ligada: sem o campo nasce ligada; com o campo vale o checkbox", () => {
    expect((validarTarja({ ...OK, ligada: "on" }, null) as { dados: { ligada: boolean } }).dados.ligada).toBe(true);
    expect((validarTarja({ ...OK, ligada: "" }, null) as { dados: { ligada: boolean } }).dados.ligada).toBe(false);
  });
});

describe("tarjaAtiva", () => {
  const A = { id: "a", apareceSeg: 2, duracaoSeg: 15 };
  const B = { id: "b", apareceSeg: 10, duracaoSeg: 5 };

  it("vale aparece <= segundo < aparece + duração", () => {
    expect(tarjaAtiva([A], 1)).toBeNull();
    expect(tarjaAtiva([A], 2)).toBe(A);
    expect(tarjaAtiva([A], 16)).toBe(A);
    expect(tarjaAtiva([A], 17)).toBeNull();
  });

  it("duas se cruzando: a que apareceu por último (qualquer ordem na lista)", () => {
    expect(tarjaAtiva([A, B], 11)).toBe(B);
    expect(tarjaAtiva([B, A], 11)).toBe(B);
    expect(tarjaAtiva([A, B], 15)).toBe(A);
  });

  it("lista vazia: nenhuma", () => {
    expect(tarjaAtiva([], 5)).toBeNull();
  });
});

describe("formatação do momento", () => {
  it("h:mm:ss sempre com as horas", () => {
    expect(formatarMomentoTarja(2)).toBe("0:00:02");
    expect(formatarMomentoTarja(3723)).toBe("1:02:03");
  });

  it("lerMomentoTarja aceita o que formatarMomentoTarja escreve", () => {
    for (const s of [0, 2, 59, 60, 3599, 3600, 7322]) expect(lerMomentoTarja(formatarMomentoTarja(s))).toBe(s);
  });
});
