import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { hrefCom, intervaloDaPagina, opcaoDe, paginaDe, POR_PAGINA_LISTA, textoDe, type ParametrosUrl } from "@/src/lib/regras/filtros-lista";
import { escaparIlike } from "@/src/lib/regras/lista-webinars";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Paginacao } from "../_componentes/paginacao";
import { estiloCelula, Pagina, Selo, Tabela } from "../_componentes/ui";
import { BarraFiltros } from "../_componentes/barra-filtros";
import { BuscaUrl, FiltroUrl } from "../_componentes/filtros-url";
import { AcoesPessoa, type Pessoa } from "./acoes";
import { CriarUsuario } from "./formulario";

export const metadata: Metadata = { title: `Usuários · ${NOME_SISTEMA}` };

const ORDENS = [
  { valor: "az", rotulo: "Nome (A–Z)" },
  { valor: "za", rotulo: "Nome (Z–A)" },
] as const;
const TIPOS = [
  { valor: "todos", rotulo: "Todos os tipos" },
  { valor: "admin", rotulo: "Administrador" },
  { valor: "atendente", rotulo: "Atendente" },
] as const;

export default async function Usuarios({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  const eu = await exigirAdmin();
  const sp = await searchParams;
  const busca = textoDe(sp, "busca");
  const ordem = opcaoDe(sp, "ordem", ORDENS.map((o) => o.valor), "az");
  const tipo = opcaoDe(sp, "tipo", TIPOS.map((t) => t.valor), "todos");
  const pagina = paginaDe(sp);

  const db = await dbUsuario();
  let consulta = db.from("usuarios").select("id, nome, email, papel, ativo", { count: "exact" }).order("nome", { ascending: ordem === "az" }).order("id");
  if (tipo !== "todos") consulta = consulta.eq("papel", tipo);
  // Busca por nome ou e-mail. Vírgula e parênteses quebram o filtro `or` do PostgREST: saem do termo.
  const termo = escaparIlike(busca.replace(/[,()]/g, " ").trim());
  if (termo) consulta = consulta.or(`nome.ilike.%${termo}%,email.ilike.%${termo}%`);
  const { desde, ate } = intervaloDaPagina(pagina);
  const { data, count, error } = await consulta.range(desde, ate);
  const pessoas = (data ?? []) as Pessoa[];
  const atuais = { busca, ordem: ordem === "az" ? "" : ordem, tipo: tipo === "todos" ? "" : tipo };
  const filtrando = !!(busca || tipo !== "todos");

  return (
    <Pagina titulo="Usuários">
      <BarraFiltros acao={<CriarUsuario />}>
        <BuscaUrl valor={busca} placeholder="Pesquise por nome ou e-mail" />
        <FiltroUrl parametro="ordem" rotulo="Ordenar por" valor={ordem} padrao="az" opcoes={[...ORDENS]} />
        <FiltroUrl parametro="tipo" rotulo="Tipo de usuário" valor={tipo} padrao="todos" opcoes={[...TIPOS]} />
      </BarraFiltros>

      {error && <p role="alert" className="rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro">Não deu para carregar os usuários. Tente de novo.</p>}

      <Tabela
        colunas={["Nome do usuário", "E-mail", "Tipo de usuário", <span key="a" className="block text-right">Ação</span>]}
        vazio={pessoas.length === 0 ? (filtrando ? "Sem resultados." : "Nenhum usuário ainda.") : undefined}
        rodape={<Paginacao total={count ?? 0} pagina={pagina} porPagina={POR_PAGINA_LISTA} href={(p) => hrefCom("/equipe", atuais, { pagina: String(p) })} />}
      >
        {pessoas.map((p) => (
          <tr key={p.id} className={p.ativo ? "" : "text-texto-3"}>
            <td className={`${estiloCelula} min-w-[180px] py-3`}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.nome}</span>
                {!p.ativo && <Selo cor="neutro">Desativado</Selo>}
              </span>
            </td>
            <td className={`${estiloCelula} break-all`}>{p.email}</td>
            <td className={`${estiloCelula} whitespace-nowrap`}>{p.papel === "admin" ? "Administrador" : "Atendente"}</td>
            <td className={estiloCelula}>
              <AcoesPessoa pessoa={p} souEu={p.id === eu.id} />
            </td>
          </tr>
        ))}
      </Tabela>
    </Pagina>
  );
}
