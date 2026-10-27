import "server-only";
import ExcelJS from "exceljs";

function valorCelula(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return (v as { result: unknown }).result; // fórmula: usa o resultado calculado
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    if ("text" in v) return (v as { text: unknown }).text;
    if ("error" in v) return null;
  }
  return v;
}

/** Lê a primeira aba de um .xlsx como matriz de células (valores simples; fórmula → resultado). */
export async function lerXlsx(buf: ArrayBuffer): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const aba = wb.worksheets[0];
  const linhas: unknown[][] = [];
  if (!aba) return linhas;

  aba.eachRow({ includeEmpty: true }, (row) => {
    const linha: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      linha.push(valorCelula(cell.value));
    });
    linhas.push(linha);
  });
  return linhas;
}

/** Gera um .xlsx de uma aba a partir de uma matriz de células (primeira linha costuma ser o cabeçalho).
 *  `formatosColuna` (opcional) pede um `numFmt` do ExcelJS pra uma coluna (chave 1-based, igual a `COLUNA_VALOR_
 *  VENDAS_EXPORT`) — usado pra "Valor" sair como número de moeda de verdade, não texto já formatado. */
export async function gerarXlsx(linhas: unknown[][], formatosColuna?: Record<number, string>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const aba = wb.addWorksheet("Planilha");
  for (const linha of linhas) aba.addRow(linha);
  if (formatosColuna) {
    for (const [coluna, numFmt] of Object.entries(formatosColuna)) {
      aba.getColumn(Number(coluna)).numFmt = numFmt;
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
