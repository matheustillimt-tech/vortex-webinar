import { describe, expect, it } from "vitest";
import {
  linhasParaMensagens,
  linhasParaVendas,
  mensagensParaLinhas,
  vendasParaLinhas,
} from "../src/lib/regras/planilha";

describe("linhasParaMensagens", () => {
  const cabecalho = ["Hora", "Minuto", "Segundo", "Nome", "Texto", "Suporte"];

  it("ignora o cabeçalho e lê as linhas válidas", () => {
    const r = linhasParaMensagens([cabecalho, [0, 1, 30, "Ana", "Oi gente", ""]]);
    expect(r).toEqual({ mensagens: [{ segundo: 90, nome: "Ana", texto: "Oi gente", suporte: false }], erros: [] });
  });

  it("ignora linha totalmente vazia", () => {
    const r = linhasParaMensagens([cabecalho, [], [0, 0, 1, "Ana", "Oi", ""]]);
    expect(r.mensagens).toHaveLength(1);
    expect(r.erros).toEqual([]);
  });

  it("hora/minuto/segundo vazios → 0", () => {
    const r = linhasParaMensagens([cabecalho, ["", "", "", "Ana", "Oi", ""]]);
    expect(r).toEqual({ mensagens: [{ segundo: 0, nome: "Ana", texto: "Oi", suporte: false }], erros: [] });
  });

  it("linha sem nome → erro", () => {
    const r = linhasParaMensagens([cabecalho, [0, 0, 1, "", "Oi", ""]]);
    expect(r).toEqual({ mensagens: [], erros: ["Linha 2: falta o nome."] });
  });

  it("linha sem texto → erro no formato 'Linha N: falta o texto.'", () => {
    const r = linhasParaMensagens([cabecalho, [0, 0, 1, "Ana", "", ""], [0, 0, 1, "Ana", "", ""], [0, 0, 1, "Ana", "", ""]]);
    expect(r.erros[2]).toBe("Linha 4: falta o texto.");
  });

  it("suporte marcado com qualquer valor não vazio → true", () => {
    const r = linhasParaMensagens([cabecalho, [0, 0, 1, "Ana", "Oi", "x"]]);
    expect(r.mensagens[0].suporte).toBe(true);
  });

  it("hora/minuto/segundo não numérico (texto) → erro", () => {
    const r = linhasParaMensagens([cabecalho, ["abc", 0, 0, "Ana", "Oi", ""]]);
    expect(r).toEqual({ mensagens: [], erros: ["Linha 2: use números inteiros em Hora, Minuto e Segundo."] });
  });

  it("Date em Hora (Excel formata hora digitada como data) → erro", () => {
    const r = linhasParaMensagens([cabecalho, [new Date("2026-01-01T00:00:00Z"), 0, 0, "Ana", "Oi", ""]]);
    expect(r).toEqual({ mensagens: [], erros: ["Linha 2: use números inteiros em Hora, Minuto e Segundo."] });
  });

  it.each(["1,5", 1.5, -1])("valor não inteiro/negativo (%s) em Hora → erro", (valor) => {
    const r = linhasParaMensagens([cabecalho, [valor, 0, 0, "Ana", "Oi", ""]]);
    expect(r).toEqual({ mensagens: [], erros: ["Linha 2: use números inteiros em Hora, Minuto e Segundo."] });
  });

  it("75 em Segundo → erro de faixa", () => {
    const r = linhasParaMensagens([cabecalho, [0, 0, 75, "Ana", "Oi", ""]]);
    expect(r).toEqual({ mensagens: [], erros: ["Linha 2: minuto e segundo vão de 0 a 59."] });
  });

  it("'12' como string em Hora/Minuto/Segundo → ok", () => {
    const r = linhasParaMensagens([cabecalho, ["12", "12", "12", "Ana", "Oi", ""]]);
    expect(r).toEqual({ mensagens: [{ segundo: 12 * 3600 + 12 * 60 + 12, nome: "Ana", texto: "Oi", suporte: false }], erros: [] });
  });

  it("mais de 5000 mensagens → para no limite com erro", () => {
    const linhas: unknown[][] = [cabecalho];
    for (let i = 0; i < 5002; i++) linhas.push([0, 0, 1, "Ana", "Oi", ""]);
    const r = linhasParaMensagens(linhas);
    expect(r.mensagens).toHaveLength(5000);
    expect(r.erros).toEqual(["A planilha passa de 5000 mensagens."]);
  });
});

describe("linhasParaVendas", () => {
  const cabecalho = ["Hora", "Minuto", "Segundo", "Texto"];

  it("lê as linhas válidas", () => {
    const r = linhasParaVendas([cabecalho, [0, 1, 0, "Fulano comprou"]]);
    expect(r).toEqual({ vendas: [{ segundo: 60, texto: "Fulano comprou" }], erros: [] });
  });

  it("ignora linha vazia", () => {
    const r = linhasParaVendas([cabecalho, [null, null, null, null], [0, 0, 1, "Venda"]]);
    expect(r.vendas).toHaveLength(1);
  });

  it("sem texto → erro", () => {
    const r = linhasParaVendas([cabecalho, [0, 0, 1, ""]]);
    expect(r).toEqual({ vendas: [], erros: ["Linha 2: falta o texto."] });
  });

  it("Date em Hora → erro", () => {
    const r = linhasParaVendas([cabecalho, [new Date("2026-01-01T00:00:00Z"), 0, 0, "Venda"]]);
    expect(r).toEqual({ vendas: [], erros: ["Linha 2: use números inteiros em Hora, Minuto e Segundo."] });
  });

  it("75 em Segundo → erro de faixa", () => {
    const r = linhasParaVendas([cabecalho, [0, 0, 75, "Venda"]]);
    expect(r).toEqual({ vendas: [], erros: ["Linha 2: minuto e segundo vão de 0 a 59."] });
  });

  it("mais de 1000 vendas → para no limite com erro", () => {
    const linhas: unknown[][] = [cabecalho];
    for (let i = 0; i < 1002; i++) linhas.push([0, 0, 1, "Venda"]);
    const r = linhasParaVendas(linhas);
    expect(r.vendas).toHaveLength(1000);
    expect(r.erros).toEqual(["A planilha passa de 1000 vendas."]);
  });
});

describe("mensagensParaLinhas / vendasParaLinhas", () => {
  it("monta a matriz com cabeçalho", () => {
    const linhas = mensagensParaLinhas([{ segundo: 90, nome: "Ana", texto: "Oi", suporte: true }]);
    expect(linhas).toEqual([
      ["Hora", "Minuto", "Segundo", "Nome", "Texto", "Suporte"],
      [0, 1, 30, "Ana", "Oi", "x"],
    ]);
  });

  it("vendasParaLinhas monta a matriz com cabeçalho", () => {
    const linhas = vendasParaLinhas([{ segundo: 3661, texto: "Venda" }]);
    expect(linhas).toEqual([
      ["Hora", "Minuto", "Segundo", "Texto"],
      [1, 1, 1, "Venda"],
    ]);
  });

  it("ida e volta: linhasParaMensagens(mensagensParaLinhas(x)) recupera x", () => {
    const original = [{ segundo: 125, nome: "Bruno", texto: "Oi, tudo bem?", suporte: false }];
    const r = linhasParaMensagens(mensagensParaLinhas(original));
    expect(r).toEqual({ mensagens: original, erros: [] });
  });

  it("ida e volta: linhasParaVendas(vendasParaLinhas(x)) recupera x", () => {
    const original = [{ segundo: 42, texto: "Comprou o curso" }];
    const r = linhasParaVendas(vendasParaLinhas(original));
    expect(r).toEqual({ vendas: original, erros: [] });
  });
});

describe("lerXlsx / gerarXlsx (exceljs)", () => {
  it("ida e volta: gerarXlsx → lerXlsx recupera as mesmas linhas", async () => {
    const { gerarXlsx, lerXlsx } = await import("../src/lib/planilha");
    const linhas = [
      ["Hora", "Minuto", "Segundo", "Nome", "Texto", "Suporte"],
      [0, 1, 30, "Ana", "Oi gente", ""],
      [0, 2, 0, "Bruno", "Boa aula!", "x"],
    ];
    const buf = await gerarXlsx(linhas);
    const lidas = await lerXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(lidas).toEqual(linhas);
  });

  it("fórmula e rich text → valorCelula devolve o resultado calculado e o texto concatenado", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { lerXlsx } = await import("../src/lib/planilha");

    const wb = new ExcelJS.Workbook();
    const aba = wb.addWorksheet("Planilha");
    aba.addRow(["Fórmula", "Rich text"]);
    const linha = aba.addRow([]);
    linha.getCell(1).value = { formula: "1+2", result: 3 } as never;
    linha.getCell(2).value = { richText: [{ text: "Olá, " }, { text: "mundo!", font: { bold: true } }] } as never;

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const lidas = await lerXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);

    expect(lidas).toEqual([
      ["Fórmula", "Rich text"],
      [3, "Olá, mundo!"],
    ]);
  });

  it("formatosColuna aplica numFmt na coluna pedida (Revisão final: 'Valor' numérico com moeda)", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { gerarXlsx } = await import("../src/lib/planilha");
    const linhas = [
      ["Data", "Valor"],
      ["21/10/2026", 197],
    ];
    const buf = await gerarXlsx(linhas, { 2: "R$ #,##0.00" });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const aba = wb.worksheets[0]!;
    expect(aba.getColumn(2).numFmt).toBe("R$ #,##0.00");
    expect(aba.getRow(2).getCell(2).value).toBe(197);
  });

  it("planilha sem abas → lerXlsx devolve []", async () => {
    // Um .xlsx mínimo sem nenhuma linha de dados ainda tem 1 aba vazia; aqui simulamos o caso defensivo
    // chamando gerarXlsx com matriz vazia (aba criada, 0 linhas).
    const { gerarXlsx, lerXlsx } = await import("../src/lib/planilha");
    const buf = await gerarXlsx([]);
    const lidas = await lerXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(lidas).toEqual([]);
  });
});
