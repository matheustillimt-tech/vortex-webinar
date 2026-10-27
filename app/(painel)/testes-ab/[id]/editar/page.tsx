import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FUSOS, utcParaLocal } from "@/src/lib/regras/fuso";
import { idValido } from "@/src/lib/regras/midia";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Cartao, Pagina } from "../../../_componentes/ui";
import { carregarTeste, linkDoTeste, temParticipantesTeste, webinarsParaVariacao } from "../../dados";
import { FormularioTesteAb, type WebinarOpcao } from "../../formulario";

export const metadata: Metadata = { title: `Editar teste A/B · ${NOME_SISTEMA}` };

export default async function EditarTesteAb({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  if (!idValido(id)) notFound();
  const db = await dbUsuario();
  const teste = await carregarTeste(db, id);
  if (!teste) notFound();
  const travado = await temParticipantesTeste(db, id);

  // Ativos + os que já estão no teste (mesmo arquivados, para aparecerem com o nome).
  const ativos: WebinarOpcao[] = (await webinarsParaVariacao(db)).map((w) => ({ ...w, ativo: true }));
  const extras: WebinarOpcao[] = teste.variacoes
    .filter((v) => !ativos.some((w) => w.id === v.webinarId))
    .map((v) => ({ id: v.webinarId, nome: v.nome, slug: v.slug, ativo: v.ativo }));
  const fusos = FUSOS.some((f) => f.valor === teste.fuso) ? FUSOS : [{ valor: teste.fuso, rotulo: teste.fuso }, ...FUSOS];

  return (
    <Pagina
      titulo="Editar teste"
      trilha={[{ rotulo: "Teste A/B", href: "/testes-ab" }, { rotulo: teste.nome, href: `/testes-ab/${id}` }]}
    >
      <Cartao className="p-8 max-tela-sm:p-4">
        <FormularioTesteAb
          id={id}
          inicial={{
            nome: teste.nome,
            slug: teste.slug,
            inicio: utcParaLocal(teste.inicio, teste.fuso),
            fim: utcParaLocal(teste.fim, teste.fuso),
            fuso: teste.fuso,
            variacoes: teste.variacoes.map((v) => ({ webinarId: v.webinarId, percentual: String(v.percentual) })),
          }}
          webinars={[...ativos, ...extras]}
          fusos={fusos}
          prefixoLink={linkDoTeste("")}
          travado={travado}
        />
      </Cartao>
    </Pagina>
  );
}
