import { NextResponse } from "next/server";
import { autenticarSala, corpoJson, respostaErro } from "@/src/lib/sala/api";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { carregarSalaPorId } from "@/src/lib/sala/dados";
import { validarCadastro } from "@/src/lib/regras/sala";
import { ehConflito } from "@/src/lib/sala/sessao";
import { enfileirarPorEvento } from "@/src/lib/disparos";

function campoOpcionalString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Completa a sessão provisória (acesso facilitado / cadastro incompleto): valida com a tela de login do
 *  webinar, atualiza o participante (e marca `temporario = false`) e grava o evento `fez_login`. */
export async function POST(req: Request) {
  const corpo = await corpoJson(req);
  if (!corpo || typeof corpo !== "object") return respostaErro("Corpo inválido.", 400);
  const { w, nome, email, telefone } = corpo as Record<string, unknown>;
  if (
    (nome !== undefined && typeof nome !== "string") ||
    (email !== undefined && typeof email !== "string") ||
    (telefone !== undefined && typeof telefone !== "string")
  ) {
    return respostaErro("Dados inválidos.", 400);
  }

  const auth = await autenticarSala(w);
  if ("erro" in auth) return auth.erro;

  // Sessão não provisória: o cadastro já está feito (senão uma sessão logada poderia sobrescrever os próprios
  // dados — ou os de outra pessoa, se o participante_id da sessão fosse adulterado — a qualquer momento).
  if (!auth.sessao.temporario) return respostaErro("Seu cadastro já está feito.", 409);

  const sala = await carregarSalaPorId(auth.sessao.webinarId);
  if (!sala) return respostaErro("Sala não encontrada.", 400);

  const resultado = validarCadastro(
    { nome: campoOpcionalString(nome), email: campoOpcionalString(email), telefone: campoOpcionalString(telefone) },
    sala.telaLogin,
  );
  if ("erro" in resultado) return NextResponse.json({ erro: resultado.erro }, { status: 400 });

  const db = dbAdmin();
  const { error: erroParticipante } = await db
    .from("participantes")
    .update({ nome: resultado.dados.nome, email: resultado.dados.email, telefone_e164: resultado.dados.telefone, temporario: false })
    .eq("id", auth.sessao.participanteId);
  if (erroParticipante) return respostaErro("Não deu para completar o cadastro.", 500);

  // Modo teste não grava evento (hoje a sessão de teste nem é provisória, então nem chega aqui — defesa).
  if (auth.sessao.modo !== "teste") {
    const { error: erroEvento } = await db
      .from("eventos")
      .insert({ sessao_id: auth.sessao.sessaoId, webinar_id: auth.sessao.webinarId, tipo: "fez_login" });
    // Conflito (evento já gravado nessa sessão) é esperado; o cadastro em si já deu certo, não bloqueia a resposta.
    void (erroEvento && !ehConflito(erroEvento));

    // Falha de enfileirar nunca derruba a rota: só loga e segue.
    try {
      await enfileirarPorEvento(auth.sessao.sessaoId, auth.sessao.webinarId, "fez_login");
    } catch (e) {
      console.error(`api/sala/cadastro: não deu para enfileirar disparos da sessão ${auth.sessao.sessaoId}: ${e}`);
    }
  }

  return NextResponse.json({ ok: true, nome: resultado.dados.nome });
}
