import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { decifrar } from "@/src/lib/crypto";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { Pagina } from "../../../_componentes/ui";
import { AbasIntegracoes } from "../../_integracoes/abas";
import { SeletorWebinar } from "../../_integracoes/seletor-webinar";
import { ListaRegras } from "./formulario";
import { GradeIntegracoes } from "./grade";
import type { Gatilho } from "@/src/lib/regras/regras-webhook";

export const metadata: Metadata = { title: `Integrações · ${NOME_SISTEMA}` };

export type ItemRegra = {
  id: string;
  gatilho: Gatilho;
  valor_seg: number | null;
  url: string;
  metodo: string;
  ativa: boolean;
  params: Record<string, string>;
  corpo: string | null;
  /** Só as chaves dos headers salvos (nunca os valores) — permite reeditar a chave sem decifrar o segredo. */
  headers_chaves: string[];
  ultimo_resultado: "ok" | "erro" | "fila" | null;
};

/** Chaves dos headers já salvos (nunca os valores) — decifra só pra saber o que já existe, e devolve o array
 *  vazio se não tiver nada salvo ou se o blob estiver corrompido (defesa, não deveria acontecer). */
function chavesDosHeaders(headersEnc: string | null): string[] {
  if (!headersEnc) return [];
  try {
    const d = JSON.parse(decifrar(headersEnc));
    return Array.isArray(d) ? (d as [string, string][]).map(([chave]) => chave) : [];
  } catch {
    return [];
  }
}

/** Integrações de um webinar, dentro de Configurações (aba "Integrações do webinar"): o seletor troca de webinar
 *  e a grade configura webhooks (com os eventos), WhatsApp, GTM, script e pixels. */
export default async function IntegracoesWebinar({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();

  const { data: webinar } = await db
    .from("webinars")
    .select(
      "id, nome, slug, pixel_meta, pixel_tiktok, gtm, script_personalizado, compartilhar_titulo, compartilhar_descricao, compartilhar_imagem_url",
    )
    .eq("id", id)
    .maybeSingle();
  if (!webinar) notFound();

  const { data: webinarsData } = await db.from("webinars").select("id, nome, status").order("nome").limit(1000);
  const webinars = ((webinarsData ?? []) as { id: string; nome: string; status: string }[])
    .filter((w) => w.status === "ativo" || w.id === id)
    .map((w) => ({ id: w.id, nome: w.nome, arquivado: w.status !== "ativo" }));

  const { data: regrasData } = await db
    .from("regras")
    .select("id, gatilho, valor_seg, url, metodo, ativa, params, corpo, headers_enc")
    .eq("webinar_id", id)
    .order("created_at", { ascending: true });

  type LinhaRegra = { id: string; gatilho: Gatilho; valor_seg: number | null; url: string; metodo: string; ativa: boolean; params: unknown; corpo: string | null; headers_enc: string | null };
  const regras = (regrasData ?? []) as LinhaRegra[];
  const { data: ultimosDisparos } = regras.length
    ? await db
        .from("disparos")
        .select("regra_id, status, created_at")
        .in("regra_id", regras.map((r) => r.id))
        .order("created_at", { ascending: false })
        .limit(200) // só os 200 disparos mais recentes do webinar: regra sem disparo entre eles mostra "—"
    : { data: [] };

  const ultimoPorRegra = new Map<string, "ok" | "erro" | "fila">();
  for (const d of (ultimosDisparos ?? []) as { regra_id: string; status: "fila" | "ok" | "erro" }[]) {
    if (!ultimoPorRegra.has(d.regra_id)) ultimoPorRegra.set(d.regra_id, d.status);
  }
  const itens: ItemRegra[] = regras.map((r) => ({
    id: r.id,
    gatilho: r.gatilho,
    valor_seg: r.valor_seg,
    url: r.url,
    metodo: r.metodo,
    ativa: r.ativa,
    params: (r.params ?? {}) as Record<string, string>,
    corpo: r.corpo,
    headers_chaves: chavesDosHeaders(r.headers_enc),
    ultimo_resultado: ultimoPorRegra.get(r.id) ?? null,
  }));

  return (
    <Pagina titulo="Configurações">
      <section className="space-y-4">
        <AbasIntegracoes aba="webinar" />
        <SeletorWebinar webinars={webinars} atual={id} />
        <GradeIntegracoes
          webinarId={id}
          totalRegras={itens.length}
          regras={<ListaRegras webinarId={id} itens={itens} />}
          rastreamento={{
            pixelMeta: webinar.pixel_meta ?? "",
            pixelTiktok: webinar.pixel_tiktok ?? "",
            gtm: webinar.gtm ?? "",
            scriptPersonalizado: webinar.script_personalizado ?? "",
          }}
          compartilhamento={{
            compartilharTitulo: webinar.compartilhar_titulo ?? "",
            compartilharDescricao: webinar.compartilhar_descricao ?? "",
            compartilharImagemUrl: webinar.compartilhar_imagem_url,
          }}
        />
      </section>
    </Pagina>
  );
}
