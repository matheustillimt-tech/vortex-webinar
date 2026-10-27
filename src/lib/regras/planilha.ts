export type MensagemPlanilha = { segundo: number; nome: string; texto: string; suporte: boolean };
export type VendaPlanilha = { segundo: number; texto: string };

const MAX_MENSAGENS = 5000;
const MAX_VENDAS = 1000;

/** Teto do arquivo de importação (.xlsx): a Vercel limita o corpo de uma requisição serverless a 4.5 MB, então
 *  4 MB sobra margem; 5000 linhas de chat ocupam ~300 KB. Compartilhado entre a action (server) e o formulário
 *  (client, checagem antes de enviar) — por isso mora aqui e não em `src/lib/planilha.ts` (server-only). */
export const LIMITE_BYTES_PLANILHA = 4 * 1024 * 1024;
export const ERRO_LIMITE_BYTES_PLANILHA = "A planilha passa de 4 MB. Divida em arquivos menores.";

function linhaVazia(linha: unknown[]): boolean {
  return linha.every((c) => c === undefined || c === null || String(c).trim() === "");
}

/** Inteiro não negativo (vazio = 0), ou `null` se não for um inteiro válido. Recusa `Date` (o Excel formata
 *  células de hora/minuto/segundo digitadas como data/hora, o que não é o que a planilha espera aqui),
 *  decimais, negativos e texto que não seja só dígitos. */
function numeroInteiro(v: unknown): number | null {
  if (v === undefined || v === null || String(v).trim() === "") return 0;
  if (v instanceof Date) return null;
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? v : null;
  const s = String(v).trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

function texto(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

export function linhasParaMensagens(linhas: unknown[][]): { mensagens: MensagemPlanilha[]; erros: string[] } {
  const mensagens: MensagemPlanilha[] = [];
  const erros: string[] = [];

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i] ?? [];
    if (linhaVazia(linha)) continue;
    const numeroLinha = i + 1;

    const hora = numeroInteiro(linha[0]);
    const minuto = numeroInteiro(linha[1]);
    const segundo = numeroInteiro(linha[2]);
    if (hora === null || minuto === null || segundo === null) {
      erros.push(`Linha ${numeroLinha}: use números inteiros em Hora, Minuto e Segundo.`);
      continue;
    }
    if (minuto > 59 || segundo > 59) {
      erros.push(`Linha ${numeroLinha}: minuto e segundo vão de 0 a 59.`);
      continue;
    }

    const nome = texto(linha[3]);
    if (!nome) {
      erros.push(`Linha ${numeroLinha}: falta o nome.`);
      continue;
    }

    const txt = texto(linha[4]);
    if (!txt) {
      erros.push(`Linha ${numeroLinha}: falta o texto.`);
      continue;
    }

    if (mensagens.length >= MAX_MENSAGENS) {
      erros.push("A planilha passa de 5000 mensagens.");
      break;
    }
    mensagens.push({ segundo: hora * 3600 + minuto * 60 + segundo, nome, texto: txt, suporte: texto(linha[5]) !== "" });
  }

  return { mensagens, erros };
}

export function linhasParaVendas(linhas: unknown[][]): { vendas: VendaPlanilha[]; erros: string[] } {
  const vendas: VendaPlanilha[] = [];
  const erros: string[] = [];

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i] ?? [];
    if (linhaVazia(linha)) continue;
    const numeroLinha = i + 1;

    const hora = numeroInteiro(linha[0]);
    const minuto = numeroInteiro(linha[1]);
    const segundo = numeroInteiro(linha[2]);
    if (hora === null || minuto === null || segundo === null) {
      erros.push(`Linha ${numeroLinha}: use números inteiros em Hora, Minuto e Segundo.`);
      continue;
    }
    if (minuto > 59 || segundo > 59) {
      erros.push(`Linha ${numeroLinha}: minuto e segundo vão de 0 a 59.`);
      continue;
    }

    const txt = texto(linha[3]);
    if (!txt) {
      erros.push(`Linha ${numeroLinha}: falta o texto.`);
      continue;
    }

    if (vendas.length >= MAX_VENDAS) {
      erros.push("A planilha passa de 1000 vendas.");
      break;
    }
    vendas.push({ segundo: hora * 3600 + minuto * 60 + segundo, texto: txt });
  }

  return { vendas, erros };
}

function paraHms(segundo: number): [number, number, number] {
  const h = Math.floor(segundo / 3600);
  const m = Math.floor((segundo % 3600) / 60);
  const s = segundo % 60;
  return [h, m, s];
}

export function mensagensParaLinhas(lista: MensagemPlanilha[]): unknown[][] {
  const linhas: unknown[][] = [["Hora", "Minuto", "Segundo", "Nome", "Texto", "Suporte"]];
  for (const m of lista) {
    const [h, min, s] = paraHms(m.segundo);
    linhas.push([h, min, s, m.nome, m.texto, m.suporte ? "x" : ""]);
  }
  return linhas;
}

export function vendasParaLinhas(lista: VendaPlanilha[]): unknown[][] {
  const linhas: unknown[][] = [["Hora", "Minuto", "Segundo", "Texto"]];
  for (const v of lista) {
    const [h, min, s] = paraHms(v.segundo);
    linhas.push([h, min, s, v.texto]);
  }
  return linhas;
}
