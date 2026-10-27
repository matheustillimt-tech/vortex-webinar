import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { Clapperboard, HardDrive } from "lucide-react";
import { urlsBunny } from "@/src/lib/bunny/cliente";
import { bunnyConfig } from "@/src/lib/env";
import { hrefCom, intervaloDaPagina, opcaoDe, OPCOES_ORDEM, ordemDe, paginaDe, POR_PAGINA_LISTA, textoDe, type ParametrosUrl } from "@/src/lib/regras/filtros-lista";
import { escaparIlike } from "@/src/lib/regras/lista-webinars";
import { podeBaixarBunny, podeBaixarExterno } from "@/src/lib/regras/video";
import { lerTudo } from "@/src/lib/supabase/paginar";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Paginacao } from "../_componentes/paginacao";
import { Cartao, Pagina, Tabela } from "../_componentes/ui";
import { BarraFiltros } from "../_componentes/barra-filtros";
import { BuscaUrl, FiltroUrl } from "../_componentes/filtros-url";
import { EnviarVideo } from "./enviar";
import { formatarTamanho } from "@/src/lib/regras/video";
import { LinhaVideo, type VideoLinha } from "./linha";

export const metadata: Metadata = { title: `Vídeos · ${NOME_SISTEMA}` };

type LinhaDb = VideoLinha & { bunny_guid: string | null; hls_url: string | null };

const STATUS_VIDEO = [
  { valor: "todos", rotulo: "Todos os status" },
  { valor: "pronto", rotulo: "Publicados" },
  { valor: "processando", rotulo: "Convertendo" },
  { valor: "enviando", rotulo: "Enviando" },
  { valor: "erro", rotulo: "Com erro" },
] as const;
type StatusVideoFiltro = (typeof STATUS_VIDEO)[number]["valor"];

export default async function Videos({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  await exigirAdmin();
  const sp = await searchParams;
  const busca = textoDe(sp, "busca");
  const ordem = ordemDe(sp);
  const status = opcaoDe<StatusVideoFiltro>(sp, "status", STATUS_VIDEO.map((s) => s.valor), "todos");
  const pagina = paginaDe(sp);
  const db = await dbUsuario();

  let consulta = db
    .from("videos")
    .select("id, nome, origem, status, progresso, duracao_seg, bytes, thumb_url, hls_url, bunny_guid, created_at", { count: "exact" })
    .order("created_at", { ascending: ordem === "antigos" })
    .order("id");
  if (busca) consulta = consulta.ilike("nome", `%${escaparIlike(busca)}%`);
  if (status !== "todos") consulta = consulta.eq("status", status);
  const { desde, ate } = intervaloDaPagina(pagina);

  const [{ data, count, error }, consumo] = await Promise.all([
    consulta.range(desde, ate),
    // "Seu consumo": soma do que está guardado no Bunny (links externos não ocupam espaço). Lê em páginas de 1000.
    lerTudo<{ bytes: number | null }>(() => db.from("videos").select("bytes").eq("origem", "bunny").order("id")),
  ]);
  const videos = (data ?? []) as LinhaDb[];
  const ids = videos.map((v) => v.id);

  const { data: vinculosData } = ids.length
    ? await db.from("webinar_video").select("video_id, webinars(id, nome)").in("video_id", ids)
    : { data: [] };
  const vinculos = new Map<string, { id: string; nome: string }[]>();
  for (const v of (vinculosData ?? []) as unknown as { video_id: string; webinars: { id: string; nome: string } | null }[]) {
    if (!v.webinars) continue;
    vinculos.set(v.video_id, [...(vinculos.get(v.video_id) ?? []), v.webinars]);
  }

  const cfg = bunnyConfig();
  const usados = consumo.data.reduce((t, v) => t + (v.bytes ?? 0), 0);
  const atuais = { busca, ordem: ordem === "recentes" ? "" : ordem, status: status === "todos" ? "" : status };
  const filtrando = !!(busca || status !== "todos");

  return (
    <Pagina titulo="Vídeos">
      <Cartao titulo="Seu consumo" icone={HardDrive} ajuda="Espaço ocupado pelos vídeos enviados ao Bunny Stream. Vídeos por link não ocupam espaço.">
        <div className="grid grid-cols-2 gap-6 max-tela-sm:grid-cols-1">
          <div>
            <p className="text-sm text-texto-3">Armazenamento usado</p>
            <p className="text-valor font-bold tabular-nums text-texto">{formatarTamanho(usados) ?? "0 MB"}</p>
          </div>
          <div>
            <p className="text-sm text-texto-3">Vídeos enviados</p>
            <p className="text-valor font-bold tabular-nums text-texto">{consumo.data.length}</p>
          </div>
        </div>
      </Cartao>

      <Cartao titulo="Sua biblioteca de vídeos" icone={Clapperboard}>
        <div className="space-y-4">
          <BarraFiltros acao={<EnviarVideo ligado={!!cfg} />}>
            <BuscaUrl valor={busca} />
            <FiltroUrl parametro="ordem" rotulo="Ordenar" valor={ordem} padrao="recentes" opcoes={OPCOES_ORDEM} />
            <FiltroUrl parametro="status" rotulo="Status" valor={status} padrao="todos" opcoes={[...STATUS_VIDEO]} />
          </BarraFiltros>

          {error && <p role="alert" className="rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro">Não deu para carregar os vídeos. Tente de novo.</p>}

          <Tabela
            colunas={["Vídeos", "Publicado em", "Tamanho", <span key="a" className="block text-right">Ação</span>]}
            vazio={videos.length === 0 ? (filtrando ? "Sem resultados." : "Nenhum vídeo ainda.") : undefined}
            vazioDetalhe={videos.length === 0 && !filtrando ? "Envie um arquivo ou use um link para ter vídeos nos webinars." : undefined}
            rodape={<Paginacao total={count ?? 0} pagina={pagina} porPagina={POR_PAGINA_LISTA} href={(p) => hrefCom("/videos", atuais, { pagina: String(p) })} />}
          >
            {videos.map((v) => {
              const baixarUrl =
                v.origem === "bunny"
                  ? cfg && v.bunny_guid && podeBaixarBunny(v.status) ? urlsBunny(cfg, v.bunny_guid, null).original : null
                  : podeBaixarExterno(v.hls_url) ? v.hls_url : null;
              const previaUrl = v.hls_url ?? (cfg && v.bunny_guid && v.status !== "enviando" ? urlsBunny(cfg, v.bunny_guid, null).hls : null);
              return <LinhaVideo key={v.id} video={v} vinculados={vinculos.get(v.id) ?? []} baixarUrl={baixarUrl} previaUrl={previaUrl} />;
            })}
          </Tabela>
        </div>
      </Cartao>
    </Pagina>
  );
}
