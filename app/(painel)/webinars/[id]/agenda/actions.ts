"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { erroVinculo, idPaginaDoCampo } from "@/src/lib/paginas";
import { validarAgenda } from "@/src/lib/regras/agenda-form";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { seguirParaProximo } from "../_proximo";

export type Resultado = { erro?: string; ok?: boolean; valores?: Record<string, string> };

export async function salvarAgenda(webinarId: string, _: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const r = validarAgenda(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const db = await dbUsuario();
  const { data: atual } = await db
    .from("agendas")
    .select("fuso, repeticao, inicio, fim, dia_semana, hora_inicio, hora_fim, usar_sala_espera, vigencia_fim")
    .eq("webinar_id", webinarId)
    .maybeSingle();

  const depois = {
    webinar_id: webinarId,
    fuso: d.fuso,
    repeticao: d.repeticao,
    inicio: d.inicio?.toISOString() ?? null,
    fim: d.fim?.toISOString() ?? null,
    dia_semana: d.diaSemana,
    hora_inicio: d.horaInicio,
    hora_fim: d.horaFim,
    usar_sala_espera: d.usarSalaEspera,
    vigencia_fim: d.vigenciaFim?.toISOString() ?? null,
  };

  const { error } = await db.from("agendas").upsert(depois, { onConflict: "webinar_id" });
  if (error) return { erro: "Não deu para salvar a agenda.", valores: campos };
  const { error: erroTipo } = await db.from("webinars").update({ tipo_agenda: d.repeticao === "nenhuma" ? "unica" : "recorrente" }).eq("id", webinarId);
  if (erroTipo) return { erro: "A agenda foi salva, mas não deu para atualizar o tipo do webinar.", valores: campos };
  revalidatePath(`/webinars/${webinarId}/agenda`);
  revalidatePath("/webinars");
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: "Editou a agenda", antes: atual, depois });
  seguirParaProximo(form, webinarId);
  return { ok: true };
}

/** Página de espera do editor para a sessão única/recorrente. Vazio = Padrão (null). */
export async function salvarPaginaEspera(webinarId: string, _: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const espera = idPaginaDoCampo(form.get("pagina_espera_id"));
  const db = await dbUsuario();
  const erro = await erroVinculo(db, espera, "espera_unica");
  if (erro) return { erro };

  const { data: antes } = await db.from("agendas").select("pagina_espera_id").eq("webinar_id", webinarId).maybeSingle();
  const depois = { webinar_id: webinarId, pagina_espera_id: espera };
  const { error } = await db.from("agendas").upsert(depois, { onConflict: "webinar_id" });
  if (error) return { erro: "Não deu para salvar a página de espera." };

  revalidatePath(`/webinars/${webinarId}/agenda`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: "Mudou a página de espera", antes, depois });
  return { ok: true };
}

/** Seletor do topo da Agenda: "Sessão única / Repetição" × "Just in time". Voltar do JIT usa a repetição salva em
 *  `agendas` (única ou recorrente); ir pro JIT abre a aba Just in time. */
export async function escolherTipoAgenda(webinarId: string, form: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const jit = String(form.get("tipo") ?? "") === "jit";
  const db = await dbUsuario();
  const { data: webinar } = await db.from("webinars").select("tipo_agenda").eq("id", webinarId).maybeSingle();
  const antes = (webinar as { tipo_agenda?: string } | null)?.tipo_agenda ?? null;

  let tipo: "jit" | "unica" | "recorrente" = "jit";
  if (!jit) {
    const { data: agenda } = await db.from("agendas").select("repeticao").eq("webinar_id", webinarId).maybeSingle();
    const repeticao = (agenda as { repeticao?: string } | null)?.repeticao ?? "nenhuma";
    tipo = repeticao === "nenhuma" ? "unica" : "recorrente";
  }

  if (antes !== tipo) {
    const { error } = await db.from("webinars").update({ tipo_agenda: tipo }).eq("id", webinarId);
    if (!error) {
      revalidatePath(`/webinars/${webinarId}/agenda`);
      revalidatePath(`/webinars/${webinarId}/agenda/jit`);
      revalidatePath("/webinars");
      await registrarAuditoria({
        usuarioId: eu.id,
        webinarId,
        acao: "editou",
        descricao: jit ? "Mudou a agenda para just in time" : "Mudou a agenda para sessão única ou repetição",
        antes: { tipo_agenda: antes },
        depois: { tipo_agenda: tipo },
      });
    }
  }
  redirect(jit ? `/webinars/${webinarId}/agenda/jit` : `/webinars/${webinarId}/agenda`);
}
