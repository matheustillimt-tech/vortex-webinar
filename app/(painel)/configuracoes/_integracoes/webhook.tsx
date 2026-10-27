import { MonitorPlay, Webhook } from "lucide-react";
import { rotuloGatilho, type Gatilho } from "@/src/lib/regras/regras-webhook";
import { formatarDuracao } from "@/src/lib/regras/video";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { BotaoLink, Cartao, estiloCelula, Selo, Tabela } from "../../_componentes/ui";
import { SeletorWebinar } from "./seletor-webinar";

type LinhaRegra = { id: string; webinar_id: string; gatilho: Gatilho; valor_seg: number | null; url: string; metodo: string; ativa: boolean; webinars: { nome: string } | null };

/** Host da URL de destino (a URL inteira pode ter token na query: não aparece aqui). */
function destino(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Aba "Integrações do webinar": escolhe o webinar (abre `/configuracoes/integracoes/{id}`, onde ficam os webhooks
 *  com os eventos, o WhatsApp, o GTM, o script e os pixels dele) e, embaixo, todas as regras de webhook de todos
 *  os webinars num lugar só. */
export async function IntegracoesWebhook() {
  const db = await dbUsuario();
  const [{ data: regrasData, error }, { data: webinarsData }] = await Promise.all([
    db.from("regras").select("id, webinar_id, gatilho, valor_seg, url, metodo, ativa, webinars(nome)").order("webinar_id").order("created_at").limit(1000),
    db.from("webinars").select("id, nome").eq("status", "ativo").order("nome").limit(1000),
  ]);
  const regras = (regrasData ?? []) as unknown as LinhaRegra[];
  const webinars = (webinarsData ?? []) as { id: string; nome: string }[];

  return (
    <div className="space-y-6">
      <Cartao titulo="Escolha o webinar" icone={MonitorPlay} ajuda="As integrações são por webinar: escolha qual e configure os webhooks (com os eventos que disparam), o WhatsApp, o Google Tag Manager, o script e os pixels.">
        {webinars.length > 0 ? <SeletorWebinar webinars={webinars} /> : <p className="text-sm text-texto-3">Nenhum webinar ativo.</p>}
      </Cartao>

      <Cartao
        titulo="Webhooks de todos os webinars"
        icone={Webhook}
        ajuda="Cada webinar dispara webhooks quando a pessoa acessa, se cadastra, fica até um momento, abandona, chega no pitch, vê ou clica na oferta. Os webhooks de venda dos checkouts ficam na aba Nativas."
      >
        {error && <p role="alert" className="mb-4 rounded-md border border-erro/30 bg-erro-fundo px-4 py-3 text-sm text-erro">Não deu para carregar os webhooks. Tente de novo.</p>}
        <Tabela
          colunas={["Webinar", "Quando dispara", "Destino", "Status", <span key="a" className="block text-right">Ação</span>]}
          vazio={regras.length === 0 ? "Nenhum webhook ainda." : undefined}
          vazioDetalhe={regras.length === 0 ? "Escolha um webinar acima para criar." : undefined}
        >
          {regras.map((r) => (
            <tr key={r.id} className={r.ativa ? "" : "text-texto-3"}>
              <td className={`${estiloCelula} py-3 font-medium`}>{r.webinars?.nome ?? "—"}</td>
              <td className={estiloCelula}>
                {rotuloGatilho(r.gatilho)}
                {r.valor_seg !== null && <span className="text-texto-3"> · {formatarDuracao(r.valor_seg)}</span>}
              </td>
              <td className={`${estiloCelula} break-all`}>
                <span className="mr-2 font-mono text-xs text-texto-3">{r.metodo}</span>
                {destino(r.url)}
              </td>
              <td className={estiloCelula}>
                <Selo cor={r.ativa ? "ok" : "neutro"}>{r.ativa ? "Ativa" : "Desligada"}</Selo>
              </td>
              <td className={`${estiloCelula} text-right`}>
                <BotaoLink href={`/configuracoes/integracoes/${r.webinar_id}`} variante="secundario" tamanho="pequeno">
                  Abrir
                </BotaoLink>
              </td>
            </tr>
          ))}
        </Tabela>
      </Cartao>
    </div>
  );
}
