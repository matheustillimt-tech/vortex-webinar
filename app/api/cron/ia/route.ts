import { NextResponse } from "next/server";
import { segredosIguais } from "@/src/lib/crypto";
import { env } from "@/src/lib/env";
import { avancarGeracao, reivindicarGeracao } from "@/src/lib/geracao";

/** Transcrição (Scribe) pode levar até 240 s; dá folga pra terminar dentro de uma execução. */
export const maxDuration = 300;

function autenticado(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(auth);
  return !!m && segredosIguais(m[1], env("CRON_SECRET"));
}

/** Chamada a cada minuto pela Vercel Cron (`vercel.json`): reivindica a geração de chat por IA mais antiga em
 *  andamento (lease de 5 min, uma por execução — nunca duas execuções na mesma geração) e avança uma etapa. Sem
 *  nenhuma geração em andamento, não faz nada. */
export async function GET(req: Request) {
  if (!autenticado(req)) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

  const geracao = await reivindicarGeracao();
  if (!geracao) return NextResponse.json({ processada: false });

  await avancarGeracao(geracao);
  return NextResponse.json({ processada: true, id: geracao.id });
}
