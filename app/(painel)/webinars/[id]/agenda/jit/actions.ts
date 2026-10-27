"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { enviarEmail } from "@/src/lib/email/resend";
import { emailConfig } from "@/src/lib/env";
import { erroVinculo, idPaginaDoCampo } from "@/src/lib/paginas";
import { remetenteEmail, renderizarEmail, varsEmail } from "@/src/lib/regras/emails";
import { FUSO_PADRAO_JIT, validarConfigJit, validarEmailJit, validarHorariosJit, type EntradaHorarioJit } from "@/src/lib/regras/jit-form";
import { AVISO_SEM_EMAIL, linhaDeHorario, ROTULO_TIPO_EMAIL } from "@/src/lib/regras/jit-painel";
import type { Idioma } from "@/src/lib/regras/textos-sala";
import { dbUsuario, exigirAdmin, exigirUsuario } from "@/src/lib/supabase/usuario";
import { seguirParaProximo } from "../../_proximo";

export type Resultado = { erro?: string; ok?: boolean; mensagem?: string; valores?: Record<string, string> };

function camposDe(form: FormData): Record<string, string> {
  return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]));
}

function revalidar(webinarId: string) {
  revalidatePath(`/webinars/${webinarId}/agenda/jit`);
  revalidatePath(`/webinars/${webinarId}/pronto`);
}

async function fusoDoJit(db: Awaited<ReturnType<typeof dbUsuario>>, webinarId: string): Promise<string> {
  const { data } = await db.from("jit_config").select("fuso").eq("webinar_id", webinarId).maybeSingle();
  return (data as { fuso?: string } | null)?.fuso ?? FUSO_PADRAO_JIT;
}

export async function adicionarHorarioJit(webinarId: string, _: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = camposDe(form);
  const db = await dbUsuario();
  const fuso = await fusoDoJit(db, webinarId);

  const { data: existentes, error: erroLer } = await db
    .from("jit_horarios")
    .select("quando, hora, intervalo_min, data, dia_semana")
    .eq("webinar_id", webinarId);
  if (erroLer) return { erro: "Não deu para ler os horários.", valores: campos };

  const lista = [...((existentes ?? []) as EntradaHorarioJit[]), campos as EntradaHorarioJit];
  const r = validarHorariosJit(lista, fuso);
  if ("erro" in r) return { erro: r.erro, valores: campos };

  const depois = { webinar_id: webinarId, ...linhaDeHorario(r.dados[r.dados.length - 1]) };
  const { error } = await db.from("jit_horarios").insert(depois);
  if (error) return { erro: "Não deu para adicionar o horário.", valores: campos };

  revalidar(webinarId);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "criou", descricao: "Adicionou um horário do just in time", depois });
  return { ok: true };
}

export async function excluirHorarioJit(webinarId: string, _: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const horarioId = String(form.get("id") ?? "");
  if (!horarioId) return { erro: "Horário não encontrado." };
  const db = await dbUsuario();

  const { data: existentes, error: erroLer } = await db
    .from("jit_horarios")
    .select("id, quando, hora, intervalo_min, data, dia_semana")
    .eq("webinar_id", webinarId);
  if (erroLer) return { erro: "Não deu para ler os horários." };
  const lista = (existentes ?? []) as { id: string }[];
  const antes = lista.find((h) => h.id === horarioId);
  if (!antes) return { erro: "Horário não encontrado." };
  if (lista.length <= 1) return { erro: "O just in time precisa de pelo menos um horário. Adicione outro antes de excluir este." };

  const { error } = await db.from("jit_horarios").delete().eq("id", horarioId).eq("webinar_id", webinarId);
  if (error) return { erro: "Não deu para excluir o horário." };

  revalidar(webinarId);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "excluiu", descricao: "Excluiu um horário do just in time", antes });
  return { ok: true };
}

export async function salvarConfigJit(webinarId: string, _: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = camposDe(form);
  const r = validarConfigJit(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const db = await dbUsuario();
  const { data: antes } = await db
    .from("jit_config")
    .select("fuso, esconder_de, esconder_ate, exibicao, fim")
    .eq("webinar_id", webinarId)
    .maybeSingle();

  const depois = {
    webinar_id: webinarId,
    fuso: d.fuso,
    esconder_de: d.esconderDe,
    esconder_ate: d.esconderAte,
    exibicao: d.exibicao,
    fim: d.fim?.toISOString() ?? null,
  };
  const { error } = await db.from("jit_config").upsert(depois, { onConflict: "webinar_id" });
  if (error) return { erro: "Não deu para salvar a configuração.", valores: campos };

  revalidar(webinarId);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: "Editou a configuração do just in time", antes, depois });
  seguirParaProximo(form, webinarId);
  return { ok: true };
}

export async function salvarEmailJit(webinarId: string, _: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = camposDe(form);
  const r = validarEmailJit(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const db = await dbUsuario();
  const { data: antes } = await db
    .from("emails_jit")
    .select("remetente_nome, assunto, modelo, minutos_antes")
    .eq("webinar_id", webinarId)
    .eq("tipo", d.tipo)
    .maybeSingle();

  const depois = {
    webinar_id: webinarId,
    tipo: d.tipo,
    remetente_nome: d.remetenteNome,
    assunto: d.assunto,
    modelo: { texto: d.texto },
    minutos_antes: d.minutosAntes,
  };
  const { error } = await db.from("emails_jit").upsert(depois, { onConflict: "webinar_id,tipo" });
  if (error) return { erro: "Não deu para salvar o e-mail.", valores: campos };

  revalidar(webinarId);
  await registrarAuditoria({
    usuarioId: eu.id,
    webinarId,
    acao: "editou",
    descricao: `Editou o e-mail "${ROTULO_TIPO_EMAIL[d.tipo]}" do just in time`,
    antes,
    depois,
  });
  return { ok: true };
}

/** Páginas do editor usadas pelo just in time: registro (`/lp`) e espera. Vazio = Padrão (null). */
export async function salvarPaginasJit(webinarId: string, _: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const registro = idPaginaDoCampo(form.get("pagina_registro_id"));
  const espera = idPaginaDoCampo(form.get("pagina_espera_id"));
  const db = await dbUsuario();
  const erro = (await erroVinculo(db, registro, "registro_jit")) ?? (await erroVinculo(db, espera, "espera_jit"));
  if (erro) return { erro };

  const { data: antes } = await db.from("jit_config").select("pagina_registro_id, pagina_espera_id").eq("webinar_id", webinarId).maybeSingle();
  const depois = { webinar_id: webinarId, pagina_registro_id: registro, pagina_espera_id: espera };
  const { error } = await db.from("jit_config").upsert(depois, { onConflict: "webinar_id" });
  if (error) return { erro: "Não deu para salvar as páginas." };

  revalidar(webinarId);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: "Mudou as páginas do just in time", antes, depois });
  return { ok: true };
}

/** "Enviar teste para mim": monta o e-mail com o que está no cartão (mesmo sem salvar) e dados de exemplo, e manda
 *  pro e-mail do admin logado. */
export async function enviarTesteEmailJit(webinarId: string, _: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = camposDe(form);
  const cfg = emailConfig();
  if (!cfg) return { erro: AVISO_SEM_EMAIL, valores: campos };

  const r = validarEmailJit(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const usuario = await exigirUsuario();
  const para = usuario.email;
  if (!para) return { erro: "Sua conta não tem e-mail para receber o teste.", valores: campos };

  const db = await dbUsuario();
  const { data: webinar } = await db.from("webinars").select("nome, slug, idioma").eq("id", webinarId).maybeSingle();
  if (!webinar) return { erro: "Webinar não encontrado.", valores: campos };
  const w = webinar as { nome: string; slug: string; idioma: Idioma };
  const fuso = await fusoDoJit(db, webinarId);

  const minutos = d.minutosAntes ?? 60;
  const vars = varsEmail({
    nome: eu.nome,
    webinar: w.nome,
    jitHorario: new Date(Date.now() + minutos * 60_000),
    fuso,
    link: `${process.env.NEXT_PUBLIC_SALA_URL ?? ""}/${w.slug}`,
    minutos: d.minutosAntes,
    idioma: w.idioma,
  });
  const email = renderizarEmail({ assunto: d.assunto, texto: d.texto }, vars);

  try {
    await enviarEmail(cfg, { de: remetenteEmail(d.remetenteNome, cfg.de), para, assunto: `[Teste] ${email.assunto}`, html: email.html, texto: email.texto });
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não deu para enviar o teste.", valores: campos };
  }
  return { ok: true, mensagem: `Teste enviado para ${para}.` };
}
