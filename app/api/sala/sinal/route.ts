import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { autenticarSala, corpoJson, respostaErro } from "@/src/lib/sala/api";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { ehConflito } from "@/src/lib/sala/sessao";
import { enfileirarPermaneceu } from "@/src/lib/disparos";
import { cacheCurto } from "@/src/lib/cache-curto";

type LinhaDuracao = { videos: { duracao_seg: number | null } | null };

/** Só a duração do vídeo do webinar (uma consulta, com o join `webinar_video → videos`), em vez da sala inteira.
 *  O sinal é a rota mais chamada da sala (cada pessoa, a cada 30 s): a duração fica 60 s no cache da instância
 *  (ver `cacheCurto`). Sem vídeo ou com erro, não guarda (0 = "duração desconhecida", sem limite). */
const duracaoDoVideo = cacheCurto<number>(
  async (webinarId) => {
    const { data } = await dbAdmin().from("webinar_video").select("videos(duracao_seg)").eq("webinar_id", webinarId).maybeSingle();
    return (data as LinhaDuracao | null)?.videos?.duracao_seg ?? 0;
  },
  { ttlMs: 60_000, guardar: (d) => d > 0 },
);


function semConteudo(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/** Sinal de vida da sessão (presença): atualiza `ultimo_sinal_em`, a maior posição (`max_segundo`) e, no replay,
 *  a posição do vídeo (função `registrar_sinal`); também soma
 *  a retenção do minuto — cada sessão conta cada minuto do vídeo uma única vez (insere em `retencao_sessao`, que
 *  tem `unique (sessao_id, minuto)`, e só quando o insert realmente entra chama `somar_retencao`). Modo teste: 204
 *  sem tocar no banco. */
export async function POST(req: Request) {
  const corpo = await corpoJson(req);
  if (!corpo || typeof corpo !== "object") return respostaErro("Corpo inválido.", 400);
  const { w, segundo } = corpo as Record<string, unknown>;

  const auth = await autenticarSala(w);
  if ("erro" in auth) return auth.erro;
  if (typeof segundo !== "number" || !Number.isInteger(segundo) || segundo < 0) return respostaErro("Segundo inválido.", 400);

  // Modo teste não deixa rastro: nem presença (contaria na sala cheia), nem retenção.
  if (auth.sessao.modo === "teste") return semConteudo();

  const db = dbAdmin();
  const agora = new Date();

  // O segundo vem do navegador: limitado à duração do vídeo (quando conhecida), senão um sinal forjado com um
  // número enorme dispararia todo `permaneceu` de uma vez.
  const duracaoSeg = await duracaoDoVideo(auth.sessao.webinarId);
  const segundoValido = duracaoSeg > 0 ? Math.min(segundo, duracaoSeg) : segundo;

  // Atômico no banco: `max_segundo = greatest(...)` e devolve o anterior e o novo.
  const { data: sinal, error: erroSinal } = await db.rpc("registrar_sinal", {
    p_sessao: auth.sessao.sessaoId,
    p_segundo: segundoValido,
    p_replay: auth.sessao.modo === "replay",
  });
  if (erroSinal) return respostaErro("Não deu para gravar o sinal.", 500);
  const linha = (Array.isArray(sinal) ? sinal[0] : sinal) as { anterior: number; atual: number } | null | undefined;

  // Só quando a maior posição cresceu (sinal repetido ou voltando no vídeo não consulta regras). Falha de
  // enfileirar nunca derruba a rota: só loga e segue.
  if (linha && linha.atual > linha.anterior) {
    try {
      await enfileirarPermaneceu({ sessaoId: auth.sessao.sessaoId, webinarId: auth.sessao.webinarId, modo: auth.sessao.modo }, linha.atual);
    } catch (e) {
      console.error(`api/sala/sinal: não deu para enfileirar disparos 'permaneceu' da sessão ${auth.sessao.sessaoId}: ${e}`);
    }
  }

  const minuto = Math.floor(segundo / 60);
  const minutoMaximo = Math.floor(duracaoSeg / 60) + 1;

  if (minuto >= 1 && minuto <= minutoMaximo) {
    const { error: erroRetencao } = await db.from("retencao_sessao").insert({ sessao_id: auth.sessao.sessaoId, minuto });
    if (!erroRetencao) {
      // Dia de Brasília (retenção sempre agrupada no fuso de Brasília) — nunca o dia em
      // UTC, que viraria antes/depois da meia-noite local perto da virada do dia.
      const hoje = DateTime.fromJSDate(agora, { zone: "America/Sao_Paulo" }).toISODate();
      await db.rpc("somar_retencao", { p_webinar: auth.sessao.webinarId, p_data: hoje, p_minuto: minuto });
    } else if (!ehConflito(erroRetencao)) {
      return respostaErro("Não deu para gravar a retenção.", 500);
    }
  }

  return semConteudo();
}
