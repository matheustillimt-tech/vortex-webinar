import { NextResponse } from "next/server";
import { autenticarSala, corpoJson, respostaErro } from "@/src/lib/sala/api";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { ehConflito } from "@/src/lib/sala/sessao";
import { enfileirarPorEvento, eventoDisparaNoTeste } from "@/src/lib/disparos";

const TIPOS_ACEITOS = ["acessou_sala", "clicou_video", "min_15", "min_30", "min_45", "min_60", "pitch", "oferta", "clicou_oferta"] as const;
type TipoEvento = (typeof TIPOS_ACEITOS)[number];

function tipoValido(v: unknown): v is TipoEvento {
  return typeof v === "string" && (TIPOS_ACEITOS as readonly string[]).includes(v);
}

function semConteudo(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/** Grava um evento de métrica (um por sessão e tipo — conflito por `unique (sessao_id, tipo)` é ignorado, nunca
 *  um erro). Modo teste (link assinado do Pronto): 204 sem gravar nada; só os eventos da oferta enfileiram os
 *  webhooks, pra testar a integração na mão. */
export async function POST(req: Request) {
  const corpo = await corpoJson(req);
  if (!corpo || typeof corpo !== "object") return respostaErro("Corpo inválido.", 400);
  const { w, tipo, segundo } = corpo as Record<string, unknown>;

  const auth = await autenticarSala(w);
  if ("erro" in auth) return auth.erro;

  if (!tipoValido(tipo)) return respostaErro("Tipo de evento inválido.", 400);
  if (typeof segundo !== "number" || !Number.isInteger(segundo) || segundo < 0) return respostaErro("Segundo inválido.", 400);

  if (auth.sessao.modo === "teste") {
    if (eventoDisparaNoTeste(tipo)) {
      try {
        await enfileirarPorEvento(auth.sessao.sessaoId, auth.sessao.webinarId, tipo);
      } catch (e) {
        console.error(`api/sala/evento: não deu para enfileirar disparos da sessão de teste ${auth.sessao.sessaoId} (${tipo}): ${e}`);
      }
    }
    return semConteudo();
  }

  const { error } = await dbAdmin()
    .from("eventos")
    .insert({ sessao_id: auth.sessao.sessaoId, webinar_id: auth.sessao.webinarId, tipo, segundo_video: segundo });
  if (error && !ehConflito(error)) return respostaErro("Não deu para gravar o evento.", 500);

  // Falha de enfileirar nunca derruba a rota: só loga e segue.
  try {
    await enfileirarPorEvento(auth.sessao.sessaoId, auth.sessao.webinarId, tipo);
  } catch (e) {
    console.error(`api/sala/evento: não deu para enfileirar disparos da sessão ${auth.sessao.sessaoId} (${tipo}): ${e}`);
  }

  return semConteudo();
}
