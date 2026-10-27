import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { CalendarClock, Headset } from "lucide-react";
import { agendaDeLinha, estadoSala, type LinhaAgenda } from "@/src/lib/regras/agenda";
import { hrefCom, intervaloDaPagina, opcaoDe, paginaDe, POR_PAGINA_LISTA, textoDe, type ParametrosUrl } from "@/src/lib/regras/filtros-lista";
import { formatarSessao } from "@/src/lib/regras/fuso";
import { escaparIlike } from "@/src/lib/regras/lista-webinars";
import { exigirMembro } from "@/src/lib/supabase/usuario";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { Paginacao } from "../_componentes/paginacao";
import { BotaoLink, Pagina, Selo, Vazio, estiloCartao, type CorSelo } from "../_componentes/ui";
import { BarraFiltros } from "../_componentes/barra-filtros";
import { BuscaUrl, FiltroUrl } from "../_componentes/filtros-url";

export const metadata: Metadata = { title: `Salas de Atendimento · ${NOME_SISTEMA}` };

type TipoAgenda = "unica" | "recorrente" | "jit";
type LinhaWebinar = { id: string; nome: string; slug: string; tipo_agenda: TipoAgenda };
type Situacao = "andamento" | "programado" | "concluido";

const STATUS = [
  { valor: "todos", rotulo: "Todos os status" },
  { valor: "andamento", rotulo: "Em andamento" },
  { valor: "programado", rotulo: "Programados" },
  { valor: "concluido", rotulo: "Concluídos" },
] as const;
const TIPOS = [
  { valor: "todos", rotulo: "Todos os tipos" },
  { valor: "unica", rotulo: "Único" },
  { valor: "recorrente", rotulo: "Recorrente" },
  { valor: "jit", rotulo: "Just in time" },
] as const;

const SITUACAO: Record<Situacao, { rotulo: string; cor: CorSelo }> = {
  andamento: { rotulo: "Em andamento", cor: "ok" },
  programado: { rotulo: "Programado", cor: "aviso" },
  concluido: { rotulo: "Concluído", cor: "neutro" },
};
const ROTULO_TIPO: Record<TipoAgenda, string> = { unica: "Único", recorrente: "Recorrente", jit: "Just in time" };
const ORDEM_SITUACAO: Record<Situacao, number> = { andamento: 0, programado: 1, concluido: 2 };

/**
 * "Atendimento": busca, filtros de status (Em andamento / Programados / Concluídos) e tipo, e um cartão
 * por webinar com o botão "Sala de Atendimento". O status sai da agenda (calculado aqui, não no banco), então a lista
 * de webinars ativos é lida inteira (até 1000) e a página é cortada no servidor depois do filtro.
 * Just in time: cada participante tem a sua sessão, então a sala fica sempre "Em andamento".
 */
export default async function Atendimento({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  await exigirMembro();
  const sp = await searchParams;
  const busca = textoDe(sp, "busca");
  const status = opcaoDe(sp, "status", STATUS.map((s) => s.valor), "todos");
  const tipo = opcaoDe(sp, "tipo", TIPOS.map((t) => t.valor), "todos");
  const pagina = paginaDe(sp);
  const db = dbAdmin();

  let consulta = db.from("webinars").select("id, nome, slug, tipo_agenda").eq("status", "ativo").order("nome").limit(1000);
  if (busca) consulta = consulta.ilike("nome", `%${escaparIlike(busca)}%`);
  if (tipo !== "todos") consulta = consulta.eq("tipo_agenda", tipo);
  const { data: webinarsData, error } = await consulta;
  const webinars = (webinarsData ?? []) as LinhaWebinar[];
  const ids = webinars.map((w) => w.id);

  const { data: agendasData } = ids.length
    ? await db.from("agendas").select("webinar_id, fuso, inicio, fim, repeticao, dia_semana, hora_inicio, hora_fim, vigencia_fim").in("webinar_id", ids)
    : { data: [] as (LinhaAgenda & { webinar_id: string })[] };
  const agendaPorWebinar = new Map(((agendasData ?? []) as (LinhaAgenda & { webinar_id: string })[]).map((a) => [a.webinar_id, a]));

  const agora = new Date();
  const comSituacao = webinars.map((w) => {
    const linha = agendaPorWebinar.get(w.id);
    if (w.tipo_agenda === "jit") return { ...w, situacao: "andamento" as Situacao, quando: null as string | null };
    if (!linha) return { ...w, situacao: "programado" as Situacao, quando: null };
    const e = estadoSala(agendaDeLinha(linha), agora);
    const situacao: Situacao = e.estado === "aberta" ? "andamento" : e.estado === "espera" ? "programado" : "concluido";
    return { ...w, situacao, quando: e.janela ? formatarSessao(e.janela.inicio, linha.fuso) : null };
  });
  const filtrados = comSituacao
    .filter((w) => status === "todos" || w.situacao === status)
    .sort((a, b) => ORDEM_SITUACAO[a.situacao] - ORDEM_SITUACAO[b.situacao] || a.nome.localeCompare(b.nome, "pt-BR"));
  const { desde, ate } = intervaloDaPagina(pagina, POR_PAGINA_LISTA);
  const visiveis = filtrados.slice(desde, ate + 1);
  const filtrando = !!(busca || status !== "todos" || tipo !== "todos");
  const atuais = { busca, status: status === "todos" ? "" : status, tipo: tipo === "todos" ? "" : tipo };

  return (
    <Pagina titulo="Atendimento">
      <BarraFiltros>
        <BuscaUrl valor={busca} />
        <FiltroUrl parametro="status" rotulo="Status" valor={status} padrao="todos" opcoes={[...STATUS]} />
        <FiltroUrl parametro="tipo" rotulo="Tipo do evento" valor={tipo} padrao="todos" opcoes={[...TIPOS]} />
      </BarraFiltros>

      {error && <p role="alert" className="rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro">Não deu para carregar os webinars. Tente de novo.</p>}

      {visiveis.length === 0 ? (
        <div className={estiloCartao}>
          <Vazio
            icone={<Headset size={20} aria-hidden />}
            texto={filtrando ? "Sem resultados." : "Nenhum webinar ativo."}
            detalhe={filtrando ? undefined : "Quando um administrador ativar um webinar, a sala de atendimento dele aparece aqui."}
          />
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-6 max-tela-lg:grid-cols-2 max-tela-md:grid-cols-1">
          {visiveis.map((w) => {
            const s = SITUACAO[w.situacao];
            return (
              <li key={w.id} className={`${estiloCartao} flex flex-col gap-4 p-6 max-tela-sm:p-4`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Selo cor={s.cor}>{s.rotulo}</Selo>
                  <Selo cor={w.tipo_agenda === "unica" ? "destaque" : "neutro"}>{ROTULO_TIPO[w.tipo_agenda]}</Selo>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-xs text-texto-3">
                    <CalendarClock size={14} aria-hidden />
                    {w.tipo_agenda === "jit" ? "Sessão sob demanda" : (w.quando ?? "Sem sessão marcada")}
                  </p>
                  <p className="mt-1 break-words text-base font-semibold text-titulo">{w.nome}</p>
                  <p className="truncate text-sm text-texto-3">/{w.slug}</p>
                </div>
                <BotaoLink href={`/atendimento/${w.id}`} variante="contorno" icone={<Headset aria-hidden />} className="w-full">
                  Sala de Atendimento
                </BotaoLink>
              </li>
            );
          })}
        </ul>
      )}

      {filtrados.length > 0 && (
        <Paginacao total={filtrados.length} pagina={pagina} porPagina={POR_PAGINA_LISTA} href={(p) => hrefCom("/atendimento", atuais, { pagina: String(p) })} />
      )}
    </Pagina>
  );
}
