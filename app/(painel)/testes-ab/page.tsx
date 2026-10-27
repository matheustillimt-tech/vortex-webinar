import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { hrefCom, OPCOES_ORDEM, opcaoDe, ordemDe, paginaDe, POR_PAGINA_LISTA, textoDe, type ParametrosUrl } from "@/src/lib/regras/filtros-lista";
import { periodoOpcionalDe } from "@/src/lib/regras/metricas";
import { CORES_VARIACAO } from "@/src/lib/regras/teste-ab";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Paginacao } from "../_componentes/paginacao";
import { BotaoLink, estiloCelula, Pagina, Selo, Tabela } from "../_componentes/ui";
import { BarraFiltros } from "../_componentes/barra-filtros";
import { BuscaUrl, FiltroUrl, PeriodoUrl } from "../_componentes/filtros-url";
import { AcoesTeste } from "./acoes";
import { linkDoTeste, listarTestesPagina, periodoTexto, situacaoTeste, STATUS_TESTE, type StatusTesteFiltro } from "./dados";

export const metadata: Metadata = { title: `Teste A/B · ${NOME_SISTEMA}` };

export default async function TestesAb({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  await exigirAdmin();
  const sp = await searchParams;
  const busca = textoDe(sp, "busca");
  const ordem = ordemDe(sp);
  const status = opcaoDe<StatusTesteFiltro>(sp, "status", STATUS_TESTE.map((s) => s.valor), "todos");
  const de = textoDe(sp, "de");
  const ate = textoDe(sp, "ate");
  const pagina = paginaDe(sp);
  const periodo = periodoOpcionalDe(de, ate);

  const db = await dbUsuario();
  const { testes, total, erro } =
    "erro" in periodo
      ? { testes: [], total: 0, erro: periodo.erro }
      : await listarTestesPagina(db, { busca, ordem, status, de: periodo.de, ate: periodo.ate, pagina });
  const agora = new Date();
  const atuais = { busca, ordem: ordem === "recentes" ? "" : ordem, status: status === "todos" ? "" : status, de, ate };
  const filtrando = !!(busca || status !== "todos" || de || ate);

  return (
    <Pagina titulo="Teste A/B">
      <BarraFiltros
        acao={
          <BotaoLink href="/testes-ab/novo" tamanho="pequeno" className="h-9" icone={<Plus aria-hidden />}>
            Criar novo
          </BotaoLink>
        }
      >
        <BuscaUrl valor={busca} />
        <FiltroUrl parametro="ordem" rotulo="Ordenar" valor={ordem} padrao="recentes" opcoes={OPCOES_ORDEM} />
        <FiltroUrl parametro="status" rotulo="Status" valor={status} padrao="todos" opcoes={STATUS_TESTE} />
        <PeriodoUrl de={de} ate={ate} />
      </BarraFiltros>

      {erro && <p role="alert" className="rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro">{erro}</p>}

      <Tabela
        colunas={["Teste", "Status", "Variações", <span key="d" className="block text-right">Detalhes</span>]}
        vazio={testes.length === 0 ? (filtrando ? "Sem resultados." : "Nenhum teste A/B ainda.") : undefined}
        vazioDetalhe={testes.length === 0 && !filtrando ? "Crie um teste para dividir o tráfego de um link entre 2 a 4 webinars." : undefined}
        rodape={<Paginacao total={total} pagina={pagina} porPagina={POR_PAGINA_LISTA} href={(p) => hrefCom("/testes-ab", atuais, { pagina: String(p) })} />}
      >
        {testes.map((t) => {
          const situacao = situacaoTeste(t, agora);
          const link = linkDoTeste(t.slug);
          return (
            <tr key={t.id} className={t.arquivado ? "text-texto-3" : ""}>
              <td className={`${estiloCelula} min-w-[220px] py-3`}>
                <Link href={`/testes-ab/${t.id}`} className="font-medium text-texto hover:text-marca hover:underline">
                  {t.nome}
                </Link>
                <p className="text-xs text-texto-3">{periodoTexto(t)}</p>
              </td>
              <td className={estiloCelula}>
                <Selo cor={situacao.cor}>{situacao.rotulo}</Selo>
              </td>
              <td className={`${estiloCelula} min-w-[200px]`}>
                <ul className="space-y-1">
                  {t.variacoes.map((v, i) => (
                    <li key={v.webinarId} className="flex items-center gap-2 text-xs">
                      <span className="grid size-5 shrink-0 place-items-center rounded text-[11px] font-bold text-black" style={{ background: CORES_VARIACAO[i] }}>
                        {v.letra}
                      </span>
                      <span className="min-w-0 max-w-[220px] truncate">
                        {v.nome}
                        {!v.ativo && <span className="text-texto-3"> (arquivado)</span>}
                      </span>
                      <span className="ml-auto tabular-nums text-texto-3">{v.percentual}%</span>
                    </li>
                  ))}
                </ul>
              </td>
              <td className={estiloCelula}>
                <AcoesTeste id={t.id} nome={t.nome} link={link} arquivado={t.arquivado} />
              </td>
            </tr>
          );
        })}
      </Tabela>
    </Pagina>
  );
}
