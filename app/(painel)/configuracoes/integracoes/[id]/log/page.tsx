import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { rotuloGatilho, type Gatilho } from "@/src/lib/regras/regras-webhook";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import Link from "next/link";
import { BotaoLink, estiloCelula, estiloSegmento, estiloSegmentos, Pagina, Selo, Tabela } from "../../../../_componentes/ui";
import { Paginacao } from "../../../../_componentes/paginacao";

export const metadata: Metadata = { title: `Log das integrações · ${NOME_SISTEMA}` };

const POR_PAGINA = 20;
const STATUS_VALIDOS = ["todos", "ok", "erro", "fila"] as const;
type StatusFiltro = (typeof STATUS_VALIDOS)[number];

type LinhaLog = {
  id: string;
  status: "fila" | "ok" | "erro";
  tentativas: number;
  resposta: { status: number; corpo: string | null } | null;
  created_at: string;
  regras: { gatilho: Gatilho } | null;
  sessoes: { participantes: { nome: string } | null } | null;
};

function statusValido(v: string | undefined): StatusFiltro {
  return (STATUS_VALIDOS as readonly string[]).includes(v ?? "") ? (v as StatusFiltro) : "todos";
}

const SELO_STATUS: Record<"ok" | "erro" | "fila", { cor: "ok" | "erro" | "aviso"; texto: string }> = {
  ok: { cor: "ok", texto: "Sucesso" },
  erro: { cor: "erro", texto: "Erro" },
  fila: { cor: "aviso", texto: "Na fila" },
};

export default async function LogIntegracoes({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; pagina?: string }>;
}) {
  await exigirAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const status = statusValido(sp.status);
  const pagina = Math.max(1, Number(sp.pagina) || 1);

  const db = await dbUsuario();
  const { data: webinar } = await db.from("webinars").select("id, nome, slug").eq("id", id).maybeSingle();
  if (!webinar) notFound();

  const inicio = (pagina - 1) * POR_PAGINA;
  let consulta = db
    .from("disparos")
    .select("id, status, tentativas, resposta, created_at, regras!inner(gatilho, webinar_id), sessoes(participantes(nome))", { count: "exact" })
    .eq("regras.webinar_id", id)
    .order("created_at", { ascending: false })
    .range(inicio, inicio + POR_PAGINA - 1);
  if (status !== "todos") consulta = consulta.eq("status", status);

  const { data, count } = await consulta;
  const itens = (data ?? []) as unknown as LinhaLog[];
  const total = count ?? 0;

  function href(p: number, s: StatusFiltro = status): string {
    const qs = new URLSearchParams();
    if (s !== "todos") qs.set("status", s);
    if (p > 1) qs.set("pagina", String(p));
    const q = qs.toString();
    return `/configuracoes/integracoes/${id}/log${q ? `?${q}` : ""}`;
  }
  const FILTROS: { valor: StatusFiltro; rotulo: string }[] = [
    { valor: "todos", rotulo: "Todos" },
    { valor: "ok", rotulo: "Sucesso" },
    { valor: "erro", rotulo: "Erro" },
    { valor: "fila", rotulo: "Na fila" },
  ];

  return (
    <Pagina
      titulo="Logs de integrações"
      sobretitulo={webinar.nome}
      acoes={
        <BotaoLink href={`/configuracoes/integracoes/${id}`} variante="secundario">
          Voltar às integrações
        </BotaoLink>
      }
    >
      <nav aria-label="Filtrar por status" className={estiloSegmentos}>
        {FILTROS.map((f) => (
          <Link key={f.valor} href={href(1, f.valor)} aria-current={f.valor === status ? "page" : undefined} className={estiloSegmento(f.valor === status)}>
            {f.rotulo}
          </Link>
        ))}
      </nav>

      <Tabela
        colunas={["Data", "Evento", "Participante", "Status", "Tentativas", "Mensagem"]}
        vazio={itens.length === 0 ? "Sem resultados." : undefined}
        rodape={<Paginacao total={total} pagina={pagina} porPagina={POR_PAGINA} href={(p) => href(p)} />}
      >
        {itens.map((item) => (
          <tr key={item.id}>
            <td className={`${estiloCelula} whitespace-nowrap text-texto-2`}>{new Date(item.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
            <td className={estiloCelula}>{item.regras ? rotuloGatilho(item.regras.gatilho) : "—"}</td>
            <td className={estiloCelula}>{item.sessoes?.participantes?.nome ?? "—"}</td>
            <td className={estiloCelula}>
              <Selo cor={SELO_STATUS[item.status].cor}>{SELO_STATUS[item.status].texto}</Selo>
            </td>
            <td className={`${estiloCelula} tabular-nums`}>{item.tentativas}</td>
            <td className={`${estiloCelula} max-w-[320px] truncate text-texto-2`} title={item.resposta?.corpo ?? ""}>
              {item.resposta ? `${item.resposta.status} · ${item.resposta.corpo ?? ""}` : "—"}
            </td>
          </tr>
        ))}
      </Tabela>
    </Pagina>
  );
}
