import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { idValido } from "@/src/lib/regras/midia";
import { CORES_VARIACAO } from "@/src/lib/regras/teste-ab";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { ExternalLink, PartyPopper } from "lucide-react";
import { BotaoLink, Cartao, estiloBotao, Pagina, Selo } from "../../_componentes/ui";
import { BotaoCopiar } from "../../_componentes/copiar";
import { carregarTeste, dataHora, linkDoTeste, rotuloFuso, situacaoTeste } from "../dados";

export const metadata: Metadata = { title: `Teste A/B · ${NOME_SISTEMA}` };

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-1 border-b border-linha py-3 last:border-b-0 max-tela-sm:grid-cols-1">
      <dt className="text-sm font-medium text-texto-3">{rotulo}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** Resumo do teste. Logo depois de criar (`?criado=1`), abre com "Seu teste está pronto!". */
export default async function ResumoTesteAb({
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
  const criado = (await searchParams).criado === "1";
  const link = linkDoTeste(teste.slug);
  const situacao = situacaoTeste(teste, new Date());

  return (
    <Pagina
      titulo={criado ? "Parabéns, seu teste está pronto!" : teste.nome}
      infoTitulo={criado ? <PartyPopper aria-hidden className="size-7 text-marca" /> : undefined}
      trilha={[{ rotulo: "Teste A/B", href: "/testes-ab" }]}
      acoes={
        <>
          <BotaoLink href={`/testes-ab/${id}/editar`} variante="secundario">
            Editar
          </BotaoLink>
          <BotaoLink href={`/testes-ab/${id}/metricas`} variante="contorno">
            Métricas
          </BotaoLink>
        </>
      }
    >
      <Cartao className="p-8 max-tela-sm:p-4">
        {criado && <p className="mb-4 text-sm text-texto-3">Divulgue o link abaixo: cada pessoa cai sempre na mesma variação.</p>}
        <dl>
          <Linha rotulo="Nome">
            <span className="mr-2">{teste.nome}</span>
            <Selo cor={situacao.cor}>{situacao.rotulo}</Selo>
          </Linha>
          <Linha rotulo="Link">
            <span className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 break-all rounded-md bg-suave px-3 py-2 text-sm">{link}</span>
              <BotaoCopiar texto={link} formato="botao" />
            </span>
          </Linha>
          <Linha rotulo="Início">{dataHora(teste.inicio, teste.fuso)}</Linha>
          <Linha rotulo="Fim">{dataHora(teste.fim, teste.fuso)}</Linha>
          <Linha rotulo="Fuso">{rotuloFuso(teste.fuso)}</Linha>
          <Linha rotulo="Tráfego">
            <ul className="space-y-1.5">
              {teste.variacoes.map((v, i) => (
                <li key={v.webinarId} className="flex items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded text-[11px] font-bold text-black" style={{ background: CORES_VARIACAO[i] }}>
                    {v.letra}
                  </span>
                  <Link href={`/webinars/${v.webinarId}/inicio`} className="min-w-0 truncate hover:underline">
                    {v.nome}
                  </Link>
                  {!v.ativo && <span className="text-vg-muted">(arquivado)</span>}
                  <span className="ml-auto tabular-nums text-texto-3">{v.percentual}%</span>
                </li>
              ))}
            </ul>
          </Linha>
        </dl>
        <div className="mt-6 flex flex-wrap gap-2 max-tela-sm:[&>*]:w-full">
          <a href={link} target="_blank" rel="noreferrer" className={estiloBotao("principal")}>
            <ExternalLink aria-hidden />
            Visualizar teste
          </a>
          <BotaoLink href="/testes-ab" variante="secundario">
            Voltar para a lista
          </BotaoLink>
        </div>
      </Cartao>
    </Pagina>
  );
}
