import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { FileText, Plus } from "lucide-react";
import { formatarSessao } from "@/src/lib/regras/fuso";
import { hrefCom, intervaloDaPagina, opcaoDe, paginaDe, POR_PAGINA_LISTA, textoDe, type ParametrosUrl } from "@/src/lib/regras/filtros-lista";
import { escaparIlike } from "@/src/lib/regras/lista-webinars";
import { TIPOS_PAGINA, type TipoPagina } from "@/src/lib/regras/paginas";
import { ROTULO_TIPO_PAGINA } from "@/src/lib/regras/paginas-editor";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Paginacao } from "../_componentes/paginacao";
import { BotaoLink, Cartao, Pagina, Tabela } from "../_componentes/ui";
import { BarraFiltros } from "../_componentes/barra-filtros";
import { BuscaUrl, FiltroUrl } from "../_componentes/filtros-url";
import { LinhaPagina, type PaginaLinha } from "./linha";

export const metadata: Metadata = { title: `Páginas · ${NOME_SISTEMA}` };

const OPCOES_TIPO = [{ valor: "todos", rotulo: "Todos os tipos" }, ...TIPOS_PAGINA.map((t) => ({ valor: t, rotulo: ROTULO_TIPO_PAGINA[t] }))];

export default async function Paginas({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  await exigirAdmin();
  const sp = await searchParams;
  const busca = textoDe(sp, "busca");
  const tipo = opcaoDe<TipoPagina | "todos">(sp, "tipo", ["todos", ...TIPOS_PAGINA], "todos");
  const pagina = paginaDe(sp);

  const db = await dbUsuario();
  let consulta = db.from("paginas").select("id, nome, tipo, created_at", { count: "exact" }).order("created_at", { ascending: false }).order("id");
  if (tipo !== "todos") consulta = consulta.eq("tipo", tipo);
  if (busca) consulta = consulta.ilike("nome", `%${escaparIlike(busca)}%`);
  const { desde, ate } = intervaloDaPagina(pagina);
  const { data, count, error } = await consulta.range(desde, ate);
  const paginas = ((data ?? []) as { id: string; nome: string; tipo: TipoPagina; created_at: string }[]).map<PaginaLinha>((p) => ({
    id: p.id,
    nome: p.nome,
    tipo: ROTULO_TIPO_PAGINA[p.tipo] ?? p.tipo,
    criadoEm: formatarSessao(new Date(p.created_at), "America/Sao_Paulo"),
  }));
  const filtrando = !!(busca || tipo !== "todos");
  const atuais = { busca, tipo: tipo === "todos" ? "" : tipo };

  return (
    <Pagina titulo="Páginas">
      <Cartao titulo="Suas páginas" icone={FileText} ajuda="Páginas de registro e de espera feitas no editor, para usar nos webinars.">
        <div className="space-y-4">
          <BarraFiltros
            acao={
              <BotaoLink href="/paginas/nova" tamanho="pequeno" className="h-9" icone={<Plus aria-hidden />}>
                Criar nova página
              </BotaoLink>
            }
          >
            <BuscaUrl valor={busca} />
            <FiltroUrl parametro="tipo" rotulo="Tipo da página" valor={tipo} padrao="todos" opcoes={OPCOES_TIPO} />
          </BarraFiltros>

          {error && <p role="alert" className="rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro">Não deu para carregar as páginas. Tente de novo.</p>}

          <Tabela
            colunas={["Página", "Tipo da página", "Criado em", <span key="a" className="block text-right">Ação</span>]}
            vazio={paginas.length === 0 ? (filtrando ? "Sem resultados." : "Nenhuma página ainda.") : undefined}
            vazioDetalhe={paginas.length === 0 && !filtrando ? "Crie uma página para usar no registro ou na espera de um webinar." : undefined}
            rodape={<Paginacao total={count ?? 0} pagina={pagina} porPagina={POR_PAGINA_LISTA} href={(p) => hrefCom("/paginas", atuais, { pagina: String(p) })} />}
          >
            {paginas.map((p) => (
              <LinhaPagina key={p.id} pagina={p} />
            ))}
          </Tabela>
        </div>
      </Cartao>
    </Pagina>
  );
}
