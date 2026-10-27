import { NextResponse } from "next/server";
import { receberVenda } from "@/src/lib/checkout";
import type { Plataforma } from "@/src/lib/regras/checkout";

const PLATAFORMAS = ["vortexpay", "kiwify", "hotmart", "eduzz", "hubla", "themembers"] as const;
const MAX_CORPO = 1_000_000;

function muitoGrande(): NextResponse {
  return NextResponse.json({ erro: "Corpo muito grande." }, { status: 413 });
}

/** Lê o corpo como texto, parando (e devolvendo `null`) se passar de `max` bytes. */
async function lerAteOLimite(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      leitor.cancel().catch(() => {});
      return null;
    }
    partes.push(value);
  }
  const junto = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    junto.set(p, pos);
    pos += p.byteLength;
  }
  return new TextDecoder().decode(junto);
}

function plataformaValida(v: string): v is Plataforma {
  return (PLATAFORMAS as readonly string[]).includes(v);
}

/** Recebe o webhook de venda de uma plataforma de checkout. Nunca detalha o motivo de um 404 (o token da URL é
 *  a autenticação), responde 200 pra qualquer coisa que não deva ser reenviada pela plataforma (ignorada ou já
 *  recebida antes) e 500 quando a venda não pôde ser gravada (a plataforma reenvia). */
export async function POST(req: Request, { params }: { params: Promise<{ plataforma: string; token: string }> }) {
  const { plataforma, token } = await params;
  if (!plataformaValida(plataforma)) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });

  // Tamanho em bytes: confere o content-length antes de ler e, sem ele (ou mentindo), corta na leitura.
  const tamanhoDeclarado = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(tamanhoDeclarado) && tamanhoDeclarado > MAX_CORPO) return muitoGrande();
  const corpo = await lerAteOLimite(req, MAX_CORPO);
  if (corpo === null) return muitoGrande();

  const headers: Record<string, string> = {};
  req.headers.forEach((valor, nome) => {
    headers[nome] = valor;
  });

  // A Kiwify assina na query string (`?signature=`); as outras não usam a query.
  const consulta = { signature: new URL(req.url).searchParams.get("signature") };

  const resultado = await receberVenda(plataforma, token, corpo, headers, consulta);
  if (resultado.tipo === "nao_encontrado") return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  if (resultado.tipo === "erro") return NextResponse.json({ erro: "Tente de novo." }, { status: 500 });
  if (resultado.tipo === "nao_autorizada") return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ ok: true });
}
