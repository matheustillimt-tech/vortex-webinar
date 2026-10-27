import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { DateTime } from "luxon";
import { FUSOS } from "@/src/lib/regras/fuso";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Cartao, Pagina } from "../../_componentes/ui";
import { linkDoTeste, webinarsParaVariacao } from "../dados";
import { FormularioTesteAb } from "../formulario";

export const metadata: Metadata = { title: `Novo teste A/B · ${NOME_SISTEMA}` };

export default async function NovoTesteAb() {
  await exigirAdmin();
  const db = await dbUsuario();
  const webinars = (await webinarsParaVariacao(db)).map((w) => ({ ...w, ativo: true }));
  const fuso = FUSOS[0].valor;
  const agora = DateTime.now().setZone(fuso).startOf("minute");

  return (
    <Pagina titulo="Criar teste" trilha={[{ rotulo: "Teste A/B", href: "/testes-ab" }]}>
      <Cartao className="p-8 max-tela-sm:p-4">
        <p className="mb-6 max-w-3xl text-sm text-texto-3">
          Um link só para divulgar, dividido entre 2 e 4 webinars pelo percentual de cada um. Cada pessoa cai sempre na mesma variação.
        </p>
        <FormularioTesteAb
          inicial={{
            nome: "",
            slug: "",
            inicio: agora.toFormat("yyyy-MM-dd'T'HH:mm"),
            fim: agora.plus({ days: 30 }).toFormat("yyyy-MM-dd'T'HH:mm"),
            fuso,
            variacoes: [
              { webinarId: "", percentual: "50" },
              { webinarId: "", percentual: "50" },
            ],
          }}
          webinars={webinars}
          fusos={FUSOS}
          prefixoLink={linkDoTeste("")}
          travado={false}
        />
      </Cartao>
    </Pagina>
  );
}
