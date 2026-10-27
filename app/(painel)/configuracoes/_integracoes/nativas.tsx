import Link from "next/link";
import { ChevronRight, Wallet } from "lucide-react";
import type { Plataforma } from "@/src/lib/regras/checkout";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Cartao, Selo } from "../../_componentes/ui";
import { PLATAFORMAS } from "../dados";

/** Aba "Nativas": os checkouts em grade de cartões; cada um abre a página da plataforma (segredo, webhooks por
 *  sala e logs). */
export async function IntegracoesNativas() {
  const db = await dbUsuario();
  const [{ data: checkoutsData }, { data: webhooksData }] = await Promise.all([
    db.from("checkouts").select("plataforma, ligado, segredo_enc"),
    db.from("checkout_webhooks").select("id, checkouts(plataforma)").limit(1000),
  ]);
  const checkouts = new Map(((checkoutsData ?? []) as { plataforma: Plataforma; ligado: boolean; segredo_enc: string | null }[]).map((c) => [c.plataforma, c]));
  const webhooksPorPlataforma = new Map<string, number>();
  for (const w of (webhooksData ?? []) as unknown as { checkouts: { plataforma: Plataforma } | null }[]) {
    if (w.checkouts) webhooksPorPlataforma.set(w.checkouts.plataforma, (webhooksPorPlataforma.get(w.checkouts.plataforma) ?? 0) + 1);
  }

  return (
    <Cartao titulo="Checkouts" icone={Wallet} ajuda="Conecte o checkout para as vendas reais entrarem no Dashboard e nas Métricas. Cada sala (webinar) recebe a sua URL de webhook.">
      <ul className="grid grid-cols-3 gap-4 max-tela-lg:grid-cols-2 max-tela-sm:grid-cols-1">
        {PLATAFORMAS.map((p) => {
          const c = checkouts.get(p.valor);
          const n = webhooksPorPlataforma.get(p.valor) ?? 0;
          return (
            <li key={p.valor}>
              <Link
                href={`/configuracoes/checkouts/${p.valor}`}
                className="group flex h-full items-center gap-4 rounded-lg border border-borda bg-superficie p-4 transition-colors hover:border-marca hover:bg-marca-linha focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-marca-clara text-sm font-bold text-marca-forte">{p.sigla}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-texto">{p.rotulo}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <Selo cor={c?.ligado ? "ok" : "neutro"}>{c?.ligado ? "Conectado" : "Desconectado"}</Selo>
                    <span className="text-xs text-texto-3">
                      {n} webhook{n === 1 ? "" : "s"}
                    </span>
                  </span>
                </span>
                <ChevronRight size={18} aria-hidden className="shrink-0 text-apagado transition-colors group-hover:text-marca" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Cartao>
  );
}
