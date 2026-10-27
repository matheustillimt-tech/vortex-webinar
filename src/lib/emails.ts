import "server-only";
import { dbAdmin } from "./supabase/admin";
import { agendaDeEmails, modelosPadrao, remetenteEmail, renderizarEmail, varsEmail, type TipoEmail } from "./regras/emails";
import { FUSO_PADRAO_JIT, MINUTOS_LEMBRETE_PADRAO } from "./regras/jit-form";
import { modeloDeLinha, type LinhaEmailJit } from "./regras/jit-painel";
import type { Idioma } from "./regras/textos-sala";
import { emailConfig } from "./env";
import { enviarEmail } from "./email/resend";
import { linkDeAcessoDaSessao } from "./sala/sessao";

export type InscricaoParaEmails = {
  sessaoId: string;
  webinarId: string;
  /** Sem e-mail (a tela de login não pede) não há para quem mandar: nada é enfileirado. */
  email: string | null;
  jitHorario: Date;
  agora: Date;
};

/** Minutos do lembrete: o do modelo salvo em `emails_jit` (sem valor → padrão), ou o padrão sem modelo. */
async function minutosDoLembrete(webinarId: string): Promise<number> {
  const { data, error } = await dbAdmin()
    .from("emails_jit")
    .select("minutos_antes")
    .eq("webinar_id", webinarId)
    .eq("tipo", "lembrete")
    .maybeSingle();
  if (error) throw new Error((error as { message?: string }).message ?? "erro ao ler emails_jit");
  const minutos = (data as { minutos_antes: number | null } | null)?.minutos_antes;
  return minutos ?? MINUTOS_LEMBRETE_PADRAO;
}

/** Enfileira em `envios_email` os e-mails de uma inscrição do just in time (`agendaDeEmails`: inscrição agora,
 *  lembrete `minutos_antes` antes do horário se ainda der, "começando" no horário). Inscrição repetida não duplica
 *  (`unique (sessao_id, tipo)`, conflito ignorado). Nunca lança: falha aqui não pode derrubar a inscrição (só loga).
 *  Devolve quantos tipos foram mandados para a fila (0 quando nada foi enfileirado). */
export async function enfileirarEmailsDaInscricao(p: InscricaoParaEmails): Promise<number> {
  if (!p.email) return 0;
  try {
    const minutos = await minutosDoLembrete(p.webinarId);
    const linhas = agendaDeEmails(p.jitHorario, p.agora, minutos).map((e) => ({
      sessao_id: p.sessaoId,
      webinar_id: p.webinarId,
      tipo: e.tipo,
      enviar_em: e.enviarEm.toISOString(),
    }));
    const { error } = await dbAdmin().from("envios_email").upsert(linhas, { onConflict: "sessao_id,tipo", ignoreDuplicates: true });
    if (error) throw new Error((error as { message?: string }).message ?? "erro ao gravar envios_email");
    return linhas.length;
  } catch (e) {
    console.error(`emails: não deu para enfileirar os e-mails da sessão ${p.sessaoId}: ${e instanceof Error ? e.message : e}`);
    return 0;
  }
}

type Db = ReturnType<typeof dbAdmin>;

const DUAS_HORAS_MS = 2 * 60 * 60_000;
const ESPERA_RETENTATIVA_MS = 5 * 60_000;
const MAX_TENTATIVAS = 3;
const ORCAMENTO_PADRAO_MS = 20_000;
const CONCORRENCIA_PADRAO = 5;

type EnvioPego = { id: string; sessao_id: string; webinar_id: string; tipo: TipoEmail; tentativas: number };
type LinhaSessaoEmail = {
  id: string;
  webinar_id: string;
  jit_horario: string | null;
  jit_fuso: string | null;
  modo: string;
  participantes: { nome: string; email: string | null } | null;
};
type LinhaWebinarEmail = { id: string; nome: string; slug: string; idioma: Idioma; status: string };
type LinhaEmailJitDoWebinar = LinhaEmailJit & { webinar_id: string };

export type DepsEmails = {
  db?: Db;
  config?: typeof emailConfig;
  enviar?: typeof enviarEmail;
  /** Relógio em ms (padrão `Date.now`) e instante, nele, depois do qual nenhum envio novo começa (padrão: 20 s). */
  relogio?: () => number;
  prazo?: number;
  /** Quantos envios ao mesmo tempo (padrão 5). */
  concorrencia?: number;
};

export type ResultadoEmails = { enviados: number; falhas: number; expirados: number };

function msgErro(e: unknown, padrao: string): string {
  return e instanceof Error && e.message ? e.message : padrao;
}

/** Lê em lote (`in`) uma tabela; erro vira exceção (a reserva expira sozinha e o próximo cron tenta de novo). */
async function lerEmLote<T>(db: Db, tabela: string, colunas: string, coluna: string, valores: string[]): Promise<T[]> {
  if (valores.length === 0) return [];
  const { data, error } = await db.from(tabela).select(colunas).in(coluna, valores);
  if (error) throw new Error(`Não deu para ler ${tabela}.`);
  return (data ?? []) as unknown as T[];
}

async function gravar(db: Db, id: string, valores: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("envios_email").update(valores).eq("id", id);
  if (error) console.error(`emails: não deu para gravar o envio ${id}: ${(error as { message?: string }).message ?? error}`);
}

/** Processa a fila dos e-mails do just in time (chamada pelo `/api/cron/tick`).
 *  1) Sempre expira os que ficaram na fila mais de 2 h depois do horário de envio (não faz sentido mandar
 *     "estamos começando" horas depois). 2) Sem Resend configurado (`emailConfig()`), para aí. 3) Com Resend, reserva
 *     até `limite` vencidos (`pegar_emails`: lease de 3 min, tentativa já somada), lê sessões/webinars/modelos/fuso
 *     em lote, monta cada e-mail (modelo do webinar ou o padrão do idioma) e envia, até `concorrencia` ao mesmo
 *     tempo. Enviado → `enviado`; falha → volta pra fila em 5 min, ou `erro` na 3ª tentativa; sessão sem e-mail
 *     ou sem horário, e lembrete/"começando" de webinar não ativo ou de sessão que não está mais ao vivo →
 *  `expirado` com o motivo. Passado o `prazo`, não começa envio novo: os que sobraram voltam pra fila na hora
 *     (tentativa desfeita). */
export async function processarEmails(agora: Date, limite = 50, deps: DepsEmails = {}): Promise<ResultadoEmails> {
  const db = deps.db ?? dbAdmin();
  const relogio = deps.relogio ?? Date.now;
  const prazo = deps.prazo ?? relogio() + ORCAMENTO_PADRAO_MS;
  const concorrencia = Math.max(1, deps.concorrencia ?? CONCORRENCIA_PADRAO);
  const enviar = deps.enviar ?? enviarEmail;
  const resultado: ResultadoEmails = { enviados: 0, falhas: 0, expirados: 0 };

  const { data: vencidos, error: erroExpirar } = await db
    .from("envios_email")
    .update({ status: "expirado", erro: "Passou do horário sem enviar." })
    .eq("status", "fila")
    .lt("enviar_em", new Date(agora.getTime() - DUAS_HORAS_MS).toISOString())
    .select("id");
  if (erroExpirar) throw new Error("Não deu para expirar os e-mails vencidos.");
  resultado.expirados += (vencidos ?? []).length;

  const cfg = (deps.config ?? emailConfig)();
  if (!cfg) return resultado;

  const { data: pegos, error: erroPegar } = await db.rpc("pegar_emails", { p_limite: limite });
  if (erroPegar) throw new Error("Não deu para pegar a fila de e-mails.");
  const envios = (pegos ?? []) as EnvioPego[];
  if (envios.length === 0) return resultado;

  const unicos = (xs: string[]) => [...new Set(xs)];
  const webinarIds = unicos(envios.map((e) => e.webinar_id));
  const [sessoes, webinars, modelos, configs] = await Promise.all([
    lerEmLote<LinhaSessaoEmail>(db, "sessoes", "id, webinar_id, jit_horario, jit_fuso, modo, participantes(nome, email)", "id", unicos(envios.map((e) => e.sessao_id))),
    lerEmLote<LinhaWebinarEmail>(db, "webinars", "id, nome, slug, idioma, status", "id", webinarIds),
    lerEmLote<LinhaEmailJitDoWebinar>(db, "emails_jit", "webinar_id, tipo, remetente_nome, assunto, modelo, minutos_antes", "webinar_id", webinarIds),
    lerEmLote<{ webinar_id: string; fuso: string }>(db, "jit_config", "webinar_id, fuso", "webinar_id", webinarIds),
  ]);
  const sessaoPorId = new Map(sessoes.map((s) => [s.id, s]));
  const webinarPorId = new Map(webinars.map((w) => [w.id, w]));
  const fusoPorWebinar = new Map(configs.map((c) => [c.webinar_id, c.fuso]));
  const modeloPor = new Map(modelos.map((m) => [`${m.webinar_id}:${m.tipo}`, m]));

  async function processarUm(envio: EnvioPego): Promise<void> {
    const sessao = sessaoPorId.get(envio.sessao_id);
    const webinar = webinarPorId.get(envio.webinar_id);
    const motivo = !sessao
      ? "Inscrição não encontrada."
      : !webinar
        ? "Webinar não encontrado."
        : !sessao.participantes?.email
          ? "A inscrição não tem e-mail."
          : !sessao.jit_horario
            ? "A inscrição não tem horário escolhido."
            : // Lembrete e "começando" chamam pra sala ao vivo: não fazem sentido com o webinar arquivado nem com a
              // sessão que já virou replay (ou teste).
              envio.tipo !== "inscricao" && webinar.status !== "ativo"
              ? "O webinar não está ativo."
              : envio.tipo !== "inscricao" && sessao.modo !== "ao_vivo"
                ? "A sessão não está mais ao vivo."
                : null;
    if (motivo || !sessao || !webinar || !sessao.jit_horario || !sessao.participantes?.email) {
      await gravar(db, envio.id, { status: "expirado", erro: motivo });
      resultado.expirados += 1;
      return;
    }

    try {
      const idioma = webinar.idioma ?? "pt-BR";
      const modelo = modeloDeLinha(modeloPor.get(`${webinar.id}:${envio.tipo}`), modelosPadrao(idioma)[envio.tipo]);
      const jitHorario = new Date(sessao.jit_horario);
      const vars = varsEmail({
        nome: sessao.participantes.nome,
        webinar: webinar.nome,
        jitHorario,
        // O fuso em que a pessoa escolheu o horário (gravado na inscrição); inscrição sem ele usa o da configuração.
        fuso: sessao.jit_fuso ?? fusoPorWebinar.get(webinar.id) ?? FUSO_PADRAO_JIT,
        link: linkDeAcessoDaSessao({ slug: webinar.slug, sessaoId: sessao.id, webinarId: webinar.id, jitHorario }),
        minutos: modelo.minutosAntes,
        idioma,
      });
      const pronto = renderizarEmail(modelo, vars);
      await enviar(cfg!, { de: remetenteEmail(modelo.remetenteNome, cfg!.de), para: sessao.participantes.email, ...pronto });
    } catch (e) {
      const erro = msgErro(e, "Não deu para enviar o e-mail.");
      resultado.falhas += 1;
      if (envio.tentativas >= MAX_TENTATIVAS) await gravar(db, envio.id, { status: "erro", erro });
      else await gravar(db, envio.id, { status: "fila", enviar_em: new Date(agora.getTime() + ESPERA_RETENTATIVA_MS).toISOString(), erro });
      return;
    }
    await gravar(db, envio.id, { status: "enviado", enviado_em: agora.toISOString(), erro: null });
    resultado.enviados += 1;
  }

  let proximo = 0;
  const sobras: EnvioPego[] = [];
  async function trabalhador(): Promise<void> {
    while (proximo < envios.length) {
      const envio = envios[proximo++];
      if (relogio() >= prazo) {
        sobras.push(envio);
        continue;
      }
      try {
        await processarUm(envio);
      } catch (e) {
        console.error(`emails: falha ao processar o envio ${envio.id}: ${msgErro(e, String(e))}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, envios.length) }, () => trabalhador()));

  // Não deu tempo: devolve à fila já (sem esperar o lease) e desfaz a tentativa contada na reserva.
  for (const envio of sobras) {
    await gravar(db, envio.id, { tentativas: Math.max(0, envio.tentativas - 1), enviar_em: agora.toISOString() });
  }

  return resultado;
}
