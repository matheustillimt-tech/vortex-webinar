import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { formatarReais, formatarTempoMedio, periodoDe, type Periodo } from "@/src/lib/regras/metricas";
import { idValido } from "@/src/lib/regras/midia";
import { montarComparacaoAb, type MetricaVariacaoAb } from "@/src/lib/regras/teste-ab";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { AjudaInfo, Pagina, Tabela } from "../../../_componentes/ui";
import { PeriodoUrl } from "../../../_componentes/filtros-url";
import { carregarTeste } from "../../dados";

export const metadata: Metadata = { title: `Métricas do teste A/B · ${NOME_SISTEMA}` };

const FUSO = "America/Sao_Paulo";
const ESTILO_ALERTA = "rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro";

const primeiro = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
const paraDataInput = (d: Date) => DateTime.fromJSDate(d, { zone: FUSO }).toFormat("yyyy-MM-dd");

/** Sem datas na URL, o período padrão é o do teste (do início até hoje ou até o fim, o que vier antes). */
function periodoPadrao(inicio: Date, fim: Date): URLSearchParams {
  const hoje = new Date();
  const ate = fim < hoje ? fim : hoje;
  const usp = new URLSearchParams();
  usp.set("de", paraDataInput(inicio < ate ? inicio : ate));
  usp.set("ate", paraDataInput(ate));
  return usp;
}

export default async function MetricasTesteAb({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirAdmin();
  const { id } = await params;
  if (!idValido(id)) notFound();
  const db = await dbUsuario();
  const teste = await carregarTeste(db, id);
  if (!teste) notFound();

  const sp = await searchParams;
  let usp = new URLSearchParams();
  if (primeiro(sp.de)) usp.set("de", primeiro(sp.de));
  if (primeiro(sp.ate)) usp.set("ate", primeiro(sp.ate));
  if (!usp.has("de") && !usp.has("ate")) usp = periodoPadrao(teste.inicio, teste.fim);

  const resultado = periodoDe(usp, "7d");
  const erroPeriodo = "erro" in resultado ? resultado.erro : null;
  // Período inválido ou longo demais: mostra os últimos 7 dias, com a mensagem de erro em cima.
  const { de, ate } = "erro" in resultado ? (periodoDe(new URLSearchParams(), "7d") as Periodo) : resultado;

  const { data, error } = await db.rpc("metricas_teste_ab", { p_teste: id, p_de: de.toISOString(), p_ate: ate.toISOString() });
  const c = montarComparacaoAb(((data ?? {}) as { variacoes?: MetricaVariacaoAb[] }).variacoes);
  const erroCarregar = error ? "Não deu para carregar as métricas. Tente de novo." : null;

  const deStr = paraDataInput(de);
  const ateStr = paraDataInput(DateTime.fromJSDate(ate, { zone: FUSO }).minus({ days: 1 }).toJSDate());
  const celula = "px-4 py-2.5 text-right tabular-nums";

  return (
    <Pagina
      titulo={teste.nome}
      infoTitulo={<AjudaInfo texto="Métricas do teste A/B no fuso de Brasília." />}
      trilha={[{ rotulo: "Teste A/B", href: "/testes-ab" }, { rotulo: teste.nome, href: `/testes-ab/${id}` }]}
      acoes={<PeriodoUrl de={deStr} ate={ateStr} alinhar="direita" />}
    >
      {erroPeriodo && <p role="alert" className={ESTILO_ALERTA}>{erroPeriodo}</p>}
      {!erroPeriodo && erroCarregar && <p role="alert" className={ESTILO_ALERTA}>{erroCarregar}</p>}

      {c.variacoes.length === 0 ? (
        <Tabela colunas={[]} semCabecalho vazio="Sem resultados." vazioDetalhe="Este teste não tem variações." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-borda bg-superficie">
          <table className="w-full text-sm">
            <thead className="border-b border-linha text-sm">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-texto-4">Métrica</th>
                {c.variacoes.map((v, i) => (
                  <th key={v.webinarId} className="px-3 py-3 text-right align-bottom font-medium" style={{ borderTop: `3px solid ${v.cor}` }}>
                    <span className="flex flex-col items-end gap-1">
                      {c.melhor === i && (
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-black" style={{ background: v.cor }}>
                          Melhor conversão
                        </span>
                      )}
                      <span className="flex items-center gap-1.5">
                        <span className="grid size-5 place-items-center rounded text-[11px] font-bold text-black" style={{ background: v.cor }}>
                          {v.letra}
                        </span>
                        <span className="max-w-[180px] truncate">{v.nome}</span>
                      </span>
                      <span className="text-xs font-normal text-vg-muted">{v.trafego}% do tráfego</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-linha">
              {c.funil.map((e) => (
                <tr key={e.etapa}>
                  <td className="px-4 py-2.5">{e.rotulo}</td>
                  {e.valores.map((x, i) => (
                    <td key={i} className={`${celula} ${c.melhor === i ? "bg-marca-linha" : ""}`}>
                      {x.numero}
                      {e.etapa !== "cadastros" && <span className="text-vg-muted"> · {x.percentual}%</span>}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="px-4 py-2.5">Vendas</td>
                {c.vendas.map((n, i) => (
                  <td key={i} className={`${celula} ${c.melhor === i ? "bg-marca-linha" : ""}`}>
                    {n}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5">Faturamento</td>
                {c.faturamentoCentavos.map((n, i) => (
                  <td key={i} className={`${celula} ${c.melhor === i ? "bg-marca-linha" : ""}`}>
                    {formatarReais(n)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5">
                  Receita por participante
                  <span className="block text-xs text-vg-muted">faturamento ÷ quem acessou a sala</span>
                </td>
                {c.receitaPorParticipanteCentavos.map((n, i) => (
                  <td key={i} className={`${celula} ${c.melhor === i ? "bg-marca-linha" : ""}`}>
                    {formatarReais(n)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5">Tempo médio assistido</td>
                {c.tempoMedioSeg.map((n, i) => (
                  <td key={i} className={`${celula} ${c.melhor === i ? "bg-marca-linha" : ""}`}>
                    {formatarTempoMedio(n)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-texto-4">
        Contam só as sessões que entraram pelo link do teste no período (o modo teste do Pronto fica de fora). O percentual de cada etapa é sobre os
        cadastros da variação; "Melhor conversão" é a maior taxa de compra sobre cadastros.
      </p>
    </Pagina>
  );
}
