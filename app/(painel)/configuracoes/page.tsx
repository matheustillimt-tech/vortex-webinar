import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { opcaoDe, type ParametrosUrl } from "@/src/lib/regras/filtros-lista";
import { exigirAdmin } from "@/src/lib/supabase/usuario";
import { Pagina } from "../_componentes/ui";
import { ABAS, AbasIntegracoes } from "./_integracoes/abas";
import { IntegracoesMcp } from "./_integracoes/mcp";
import { IntegracoesNativas } from "./_integracoes/nativas";
import { IntegracoesWebhook } from "./_integracoes/webhook";

export const metadata: Metadata = { title: `Configurações · ${NOME_SISTEMA}` };

/** Configurações: a seção Integrações, em três abas (`?aba=`):
 *  nativas (checkouts), webinar (escolhe o webinar e configura webhooks, WhatsApp, GTM, script e pixels dele) e
 *  MCP (chaves pra conectar um Claude). As integrações não ficam mais dentro do webinar. Subdomínio e CRMs ficam
 *  de fora. `?aba=webhook` (endereço antigo) abre a aba do webinar. */
export default async function Configuracoes({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  await exigirAdmin();
  const sp = await searchParams;
  const aba = sp.aba === "webhook" ? "webinar" : opcaoDe(sp, "aba", ABAS.map((a) => a.valor), "nativas");

  return (
    <Pagina titulo="Configurações">
      <section className="space-y-4">
        <AbasIntegracoes aba={aba} />
        {aba === "nativas" && <IntegracoesNativas />}
        {aba === "webinar" && <IntegracoesWebhook />}
        {aba === "mcp" && <IntegracoesMcp />}
      </section>
    </Pagina>
  );
}
