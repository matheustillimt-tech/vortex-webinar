import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { emailConfig } from "@/src/lib/env";
import { opcoesDePaginas } from "@/src/lib/paginas";
import { modelosPadrao, VARIAVEIS_EMAIL, type ModeloEmail } from "@/src/lib/regras/emails";
import { formatarSessao, FUSOS, utcParaLocal } from "@/src/lib/regras/fuso";
import { MAX_ASSUNTO, MAX_HORARIOS_JIT, MAX_TEXTO, TIPOS_EMAIL } from "@/src/lib/regras/jit-form";
import { proximosHorariosJit } from "@/src/lib/regras/jit";
import {
  AVISO_SEM_EMAIL,
  configDeLinha,
  descreverHorario,
  fusoDoPainelJit,
  horarioDeLinha,
  modeloDeLinha,
  QUANDO_EMAIL,
  ROTULO_EXIBICAO,
  ROTULO_TIPO_EMAIL,
  type LinhaConfigJit,
  type LinhaEmailJit,
  type LinhaHorarioJit,
} from "@/src/lib/regras/jit-painel";
import { mascararEmail } from "@/src/lib/regras/metricas";
import type { Idioma } from "@/src/lib/regras/textos-sala";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Selo, Tabela, type CorSelo } from "../../../../_componentes/ui";
import { Acordeao } from "../../../_componentes/campos";
import { SeletoresPagina } from "../../../../paginas/seletor";
import { FORM_PASSO, TelaPasso, TituloSecao } from "../../_passos";
import { TipoAgenda } from "../tipo-agenda";
import { ConfigJit } from "./config";
import { CartaoEmail, type ValoresEmail } from "./emails";
import { salvarPaginasJit } from "./actions";
import { HorariosJit } from "./horarios";

export const metadata: Metadata = { title: `Just in time · ${NOME_SISTEMA}` };

type LinhaEnvio = {
  id: string;
  tipo: keyof typeof ROTULO_TIPO_EMAIL;
  status: "fila" | "enviado" | "erro" | "expirado";
  erro: string | null;
  enviar_em: string;
  enviado_em: string | null;
  sessoes: { participantes: { email: string | null } | null } | null;
};

const STATUS: Record<LinhaEnvio["status"], { rotulo: string; cor: CorSelo }> = {
  fila: { rotulo: "Na fila", cor: "neutro" },
  enviado: { rotulo: "Enviado", cor: "ok" },
  erro: { rotulo: "Erro", cor: "erro" },
  expirado: { rotulo: "Expirado", cor: "aviso" },
};

function valoresEmail(m: ModeloEmail): ValoresEmail {
  return { remetenteNome: m.remetenteNome, assunto: m.assunto, texto: m.texto, minutosAntes: m.minutosAntes === null ? "" : String(m.minutosAntes) };
}

export default async function AgendaJit({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();
  const { data: webinar } = await db.from("webinars").select("id, nome, slug, idioma, tipo_agenda").eq("id", id).maybeSingle();
  if (!webinar) notFound();
  if (webinar.tipo_agenda !== "jit") redirect(`/webinars/${id}/agenda`);

  const [{ data: linhasHorarios }, { data: linhaConfig }, { data: linhasEmails }, { data: linhasEnvios }] = await Promise.all([
    db.from("jit_horarios").select("id, quando, hora, intervalo_min, data, dia_semana").eq("webinar_id", id).order("created_at", { ascending: true }),
    db.from("jit_config").select("fuso, esconder_de, esconder_ate, exibicao, fim, pagina_registro_id, pagina_espera_id").eq("webinar_id", id).maybeSingle(),
    db.from("emails_jit").select("tipo, remetente_nome, assunto, modelo, minutos_antes").eq("webinar_id", id),
    db
      .from("envios_email")
      .select("id, tipo, status, erro, enviar_em, enviado_em, sessoes(participantes(email))")
      .eq("webinar_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const cfg = configDeLinha(linhaConfig as LinhaConfigJit | null);
  const vinculo = (linhaConfig ?? {}) as { pagina_registro_id?: string | null; pagina_espera_id?: string | null };
  const paginas = await opcoesDePaginas(db, ["registro_jit", "espera_jit"]);
  const fusoPainel = fusoDoPainelJit(cfg.fuso);
  const horariosLinhas = (linhasHorarios ?? []) as (LinhaHorarioJit & { id: string })[];
  const horarios = horariosLinhas.map(horarioDeLinha);
  const proximos = proximosHorariosJit(horarios, cfg, new Date());

  const padroes = modelosPadrao((webinar.idioma as Idioma) ?? "pt-BR");
  const emails = (linhasEmails ?? []) as LinhaEmailJit[];
  const emailLigado = emailConfig() !== null;
  const envios = (linhasEnvios ?? []) as unknown as LinhaEnvio[];

  return (
    <TelaPasso webinarId={id} nome={webinar.nome} atual="agenda" formulario={FORM_PASSO}>
      <div className="space-y-8">
        <section>
          <TituloSecao titulo="Tipo do webinar" descricao="Webinar único (com ou sem repetição automática) ou just in time, em que a pessoa escolhe o horário." />
          <TipoAgenda webinarId={id} jit />
        </section>

        <section>
          <TituloSecao titulo="Horários" descricao="A pessoa escolhe um destes horários na página de inscrição e a sala abre no horário escolhido. Cada horário salva na hora." />
          <HorariosJit
            webinarId={id}
            max={MAX_HORARIOS_JIT}
            itens={horariosLinhas.map((l, i) => ({ id: l.id, descricao: descreverHorario(horarios[i], cfg.fuso) }))}
          />
        </section>

        <section className="border-t border-linha pt-8">
          <TituloSecao titulo="Configuração" descricao="Salva com o “Continuar”." />
          <ConfigJit
            idFormulario={FORM_PASSO}
            webinarId={id}
            fusos={FUSOS}
            exibicoes={Object.entries(ROTULO_EXIBICAO).map(([valor, rotulo]) => ({ valor, rotulo }))}
            valores={{
              fuso: cfg.fuso,
              esconderDe: cfg.esconderDe === null ? "" : String(cfg.esconderDe),
              esconderAte: cfg.esconderAte === null ? "" : String(cfg.esconderAte),
              exibicao: cfg.exibicao,
              fim: cfg.fim ? utcParaLocal(cfg.fim, fusoPainel) : "",
            }}
          />
        </section>

        <section className="border-t border-linha pt-8">
          <TituloSecao titulo="Próximos horários que a pessoa vai ver" />
          {cfg.fuso === "participante" && <p className="mb-2 text-xs text-texto-3">Mostrados no horário de Brasília; cada pessoa vê no fuso dela.</p>}
          {horarios.length === 0 ? (
            <p className="text-sm text-texto-3">Adicione um horário para ver a prévia.</p>
          ) : proximos.length === 0 ? (
            <p className="text-sm text-texto-3">Nenhum horário futuro com essa configuração.</p>
          ) : (
            <ul className="divide-y divide-linha rounded-lg border border-linha text-sm">
              {proximos.map((d) => (
                <li key={d.toISOString()} className="px-4 py-2.5">
                  {formatarSessao(d, fusoPainel)}
                </li>
              ))}
            </ul>
          )}
          {cfg.exibicao === "entrar_direto" && proximos.length > 0 && (
            <p className="mt-2 text-xs text-texto-3">Com “entra no mais próximo”, a pessoa não escolhe: vai para este horário.</p>
          )}
        </section>

        <section className="border-t border-linha pt-8">
          <TituloSecao
            titulo="Customizar páginas do just in time"
            descricao="Páginas de registro e de espera feitas no editor. Em “Padrão”, a sala usa as telas padrão do sistema. Salvam à parte."
          />
          <SeletoresPagina
            acao={salvarPaginasJit.bind(null, id)}
            seletores={[
              { campo: "pagina_registro_id", rotulo: "Página de registro", tipo: "registro_jit", valor: vinculo.pagina_registro_id ?? null, opcoes: paginas.registro_jit },
              { campo: "pagina_espera_id", rotulo: "Página de espera", tipo: "espera_jit", valor: vinculo.pagina_espera_id ?? null, opcoes: paginas.espera_jit },
            ]}
          />
        </section>

        <section className="border-t border-linha pt-8">
          <TituloSecao titulo="Personalizar notificações" descricao="E-mails enviados a quem se inscreve. Cada e-mail salva à parte." />
          <div className="space-y-3">
            {TIPOS_EMAIL.map((tipo) => (
              <Acordeao key={tipo} titulo={ROTULO_TIPO_EMAIL[tipo]}>
                <CartaoEmail
                  webinarId={id}
                  tipo={tipo}
                  titulo={ROTULO_TIPO_EMAIL[tipo]}
                  quando={QUANDO_EMAIL[tipo]}
                  valores={valoresEmail(modeloDeLinha(emails.find((e) => e.tipo === tipo), padroes[tipo]))}
                  padrao={valoresEmail(padroes[tipo])}
                  variaveis={[...VARIAVEIS_EMAIL]}
                  emailLigado={emailLigado}
                  aviso={AVISO_SEM_EMAIL}
                  maxAssunto={MAX_ASSUNTO}
                  maxTexto={MAX_TEXTO}
                />
              </Acordeao>
            ))}
          </div>
        </section>

        <section className="border-t border-linha pt-8">
          <TituloSecao titulo="Últimos envios" />
          <Tabela colunas={["Data", "Tipo", "Destinatário", "Status", "Erro"]} vazio={envios.length === 0 ? "Nenhum e-mail enviado ainda." : undefined}>
            {envios.map((e) => {
              const email = e.sessoes?.participantes?.email;
              return (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-2 py-2">{formatarSessao(new Date(e.enviado_em ?? e.enviar_em), fusoPainel)}</td>
                  <td className="px-2 py-2">{ROTULO_TIPO_EMAIL[e.tipo]}</td>
                  <td className="px-2 py-2">{email ? mascararEmail(email) : "—"}</td>
                  <td className="px-2 py-2">
                    <Selo cor={STATUS[e.status].cor}>{STATUS[e.status].rotulo}</Selo>
                  </td>
                  <td className="px-2 py-2 text-xs text-texto-3">{e.erro ?? ""}</td>
                </tr>
              );
            })}
          </Tabela>
        </section>
      </div>
    </TelaPasso>
  );
}
