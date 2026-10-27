import { NextResponse } from "next/server";
import { segredosIguais } from "@/src/lib/crypto";
import { env } from "@/src/lib/env";
import { avaliarFimDeSessoes, processarFila } from "@/src/lib/disparos";
import { processarEmails, type ResultadoEmails } from "@/src/lib/emails";

/** A Vercel corta a função em 60 s; os envios param de começar em 40 s (com até 10 s de timeout cada, sobra
 *  folga pra gravar os resultados e avaliar as sessões). */
export const maxDuration = 60;

const LIMITE_DISPAROS = 50;
const LIMITE_SESSOES = 200;
const ORCAMENTO_ENVIOS_MS = 40_000;
const LIMITE_EMAILS = 50;
/** E-mails param de começar 20 s depois de chegar a vez deles, e nunca depois do prazo dos disparos (40 s): com
 *  15 s de timeout do Resend, sobra folga pra avaliar as sessões dentro dos 60 s. */
const ORCAMENTO_EMAILS_MS = 20_000;

function autenticado(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(auth);
  return !!m && segredosIguais(m[1], env("CRON_SECRET"));
}

/** Chamada a cada minuto pela Vercel Cron (`vercel.json`): processa a fila de disparos, a dos e-mails do just in
 *  time e avalia fim de sessão. Uma parte falhar não impede as outras; a resposta traz os totais e, se houver, só o
 *  nome da parte que falhou (o detalhe vai pro log). Falha nos e-mails nunca vira 500: só `emails: null`. */
export async function GET(req: Request) {
  if (!autenticado(req)) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

  const agora = new Date();
  const prazo = Date.now() + ORCAMENTO_ENVIOS_MS;
  const erros: string[] = [];
  let disparos = 0;
  let sessoes = 0;

  try {
    ({ processados: disparos } = await processarFila(LIMITE_DISPAROS, agora, fetch, { prazo }));
  } catch (e) {
    console.error(`cron/tick: fila de disparos falhou: ${e}`);
    erros.push("disparos");
  }

  let emails: ResultadoEmails | null = null;
  try {
    emails = await processarEmails(agora, LIMITE_EMAILS, { prazo: Math.min(Date.now() + ORCAMENTO_EMAILS_MS, prazo) });
  } catch (e) {
    console.error(`cron/tick: fila de e-mails falhou: ${e}`);
  }

  try {
    ({ avaliadas: sessoes } = await avaliarFimDeSessoes(LIMITE_SESSOES, agora));
  } catch (e) {
    console.error(`cron/tick: avaliação de fim de sessão falhou: ${e}`);
    erros.push("sessoes");
  }

  if (erros.length > 0) return NextResponse.json({ disparos, sessoes, emails, erros }, { status: 500 });
  return NextResponse.json({ disparos, sessoes, emails });
}
