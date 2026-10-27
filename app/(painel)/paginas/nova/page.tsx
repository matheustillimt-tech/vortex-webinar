import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import type { SearchParamsEntrada } from "@/src/lib/regras/lista-webinars";
import { TIPOS_PAGINA, type TipoPagina } from "@/src/lib/regras/paginas";
import { ROTULO_TIPO_PAGINA } from "@/src/lib/regras/paginas-editor";
import { MODELOS_PAGINA } from "@/src/lib/regras/paginas-modelos";
import { exigirAdmin } from "@/src/lib/supabase/usuario";
import { Cartao, Pagina } from "../../_componentes/ui";
import { FormularioNovaPagina } from "./formulario";

export const metadata: Metadata = { title: `Nova página · ${NOME_SISTEMA}` };

export default async function NovaPagina({ searchParams }: { searchParams: Promise<SearchParamsEntrada> }) {
  await exigirAdmin();
  const sp = await searchParams;
  const tipoBruto = Array.isArray(sp.tipo) ? sp.tipo[0] : sp.tipo;
  const tipo = (TIPOS_PAGINA as readonly string[]).includes(tipoBruto ?? "") ? (tipoBruto as TipoPagina) : "registro_jit";

  return (
    <Pagina titulo="Criar nova Página" trilha={[{ rotulo: "Páginas", href: "/paginas" }]}>
      <Cartao className="p-8 max-tela-sm:p-4">
        <FormularioNovaPagina
          tipoInicial={tipo}
          tipos={TIPOS_PAGINA.map((t) => ({ valor: t, rotulo: ROTULO_TIPO_PAGINA[t] }))}
          modelos={MODELOS_PAGINA.map((m) => ({ id: m.id, tipo: m.tipo, nome: m.nome, descricao: m.descricao }))}
        />
      </Cartao>
    </Pagina>
  );
}
