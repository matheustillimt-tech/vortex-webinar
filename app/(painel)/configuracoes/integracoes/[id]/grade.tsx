"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Braces, MessageCircle, Music2, Tag, Webhook } from "lucide-react";
import { Selo, estiloAcao, estiloBotao } from "../../../_componentes/ui";
import { Modal } from "../../../_componentes/modal";
import { useToast } from "../../../_componentes/toast";
import { FormularioCompartilhamento, FormularioRastreamento, type CampoRastreamento, type ValoresRastreamento } from "./pixels";

type ValoresCompartilhamento = { compartilharTitulo: string; compartilharDescricao: string; compartilharImagemUrl: string | null };
type Chave = "webhook" | "whatsapp" | "gtm" | "script" | "pixel_meta" | "pixel_tiktok";

/** Marca do cartão: quadrado colorido com o ícone (sem logos de terceiros). */
function Marca({ cor, children }: { cor: string; children: React.ReactNode }) {
  return (
    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundColor: cor }}>
      {children}
    </span>
  );
}

/**
 * Grade de integrações de um webinar (em Configurações): um cartão por integração com o estado ("Configurado") e um modal
 * para editar. Só o que o Vórtex Webinar tem de verdade: WebHook (regras), WhatsApp (prévia do link compartilhado),
 * Google Tag Manager, Script personalizado, Facebook Pixel e TikTok Pixel. CRMs (ActiveCampaign, Keap, Kommo…) não
 * entram: não existem aqui.
 */
export function GradeIntegracoes({ webinarId, rastreamento, compartilhamento, totalRegras, regras }: {
  webinarId: string;
  rastreamento: ValoresRastreamento;
  compartilhamento: ValoresCompartilhamento;
  totalRegras: number;
  /** A lista de regras de webhook (já montada no servidor), mostrada dentro do modal do WebHook. */
  regras: React.ReactNode;
}) {
  const toast = useToast();
  const router = useRouter();
  const [aberto, setAberto] = useState<Chave | null>(null);
  const fechar = () => setAberto(null);
  const salvou = (texto: string) => {
    toast.sucesso(texto);
    setAberto(null);
    router.refresh();
  };

  const cartoes: { chave: Chave; nome: string; descricao: string; marca: React.ReactNode; configurado: boolean; resumo?: string }[] = [
    {
      chave: "webhook",
      nome: "WebHook",
      descricao: "Envia os dados do participante pra outra ferramenta quando ele acessa, se inscreve, fica ou sai.",
      marca: <Marca cor="#4f46e5"><Webhook size={20} /></Marca>,
      configurado: totalRegras > 0,
      resumo: totalRegras > 0 ? `${totalRegras} ${totalRegras === 1 ? "regra" : "regras"}` : undefined,
    },
    {
      chave: "whatsapp",
      nome: "WhatsApp",
      descricao: "Título, descrição e imagem que aparecem quando o link da sala é compartilhado.",
      marca: <Marca cor="#25d366"><MessageCircle size={20} /></Marca>,
      configurado: !!(compartilhamento.compartilharTitulo || compartilhamento.compartilharDescricao || compartilhamento.compartilharImagemUrl),
    },
    {
      chave: "gtm",
      nome: "Google Tag Manager",
      descricao: "Carrega o contêiner do GTM nas páginas da sala.",
      marca: <Marca cor="#1a73e8"><Tag size={20} /></Marca>,
      configurado: !!rastreamento.gtm,
      resumo: rastreamento.gtm || undefined,
    },
    {
      chave: "script",
      nome: "Script personalizado",
      descricao: "Código seu (HTML/JS) que roda na sala.",
      marca: <Marca cor="#374151"><Braces size={20} /></Marca>,
      configurado: !!rastreamento.scriptPersonalizado.trim(),
    },
    {
      chave: "pixel_meta",
      nome: "Facebook Pixel",
      descricao: "Eventos da sala no pixel da Meta (anúncios do Facebook e Instagram).",
      marca: <Marca cor="#1877f2"><span className="text-xl font-bold leading-none">f</span></Marca>,
      configurado: !!rastreamento.pixelMeta,
      resumo: rastreamento.pixelMeta || undefined,
    },
    {
      chave: "pixel_tiktok",
      nome: "TikTok Pixel",
      descricao: "Eventos da sala no pixel do TikTok.",
      marca: <Marca cor="#111827"><Music2 size={20} /></Marca>,
      configurado: !!rastreamento.pixelTiktok,
      resumo: rastreamento.pixelTiktok || undefined,
    },
  ];

  const campoRastreamento: Partial<Record<Chave, CampoRastreamento>> = { gtm: "gtm", script: "script_personalizado", pixel_meta: "pixel_meta", pixel_tiktok: "pixel_tiktok" };
  const atual = cartoes.find((c) => c.chave === aberto) ?? null;

  return (
    <>
      <ul className="grid gap-4 tela-sm:grid-cols-2 tela-slg:grid-cols-3">
        {cartoes.map((c) => (
          <li key={c.chave}>
            <button
              type="button"
              onClick={() => setAberto(c.chave)}
              className="flex h-full w-full flex-col gap-3 rounded-lg border border-borda bg-superficie p-4 text-left transition-colors hover:border-marca hover:bg-marca-linha focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40"
            >
              <span className="flex items-center justify-between gap-3">
                {c.marca}
                {c.configurado ? <Selo cor="ok">Configurado</Selo> : <Selo cor="neutro">Não configurado</Selo>}
              </span>
              <span>
                <span className="block text-sm font-semibold text-texto">{c.nome}</span>
                <span className="mt-1 block text-xs text-texto-3">{c.descricao}</span>
              </span>
              {c.resumo && <span className="truncate font-mono text-xs text-texto-2">{c.resumo}</span>}
            </button>
          </li>
        ))}
      </ul>

      <Modal
        aberto={aberto !== null}
        aoFechar={fechar}
        titulo={atual?.nome ?? ""}
        descricao={atual?.descricao}
        largura={aberto === "webhook" ? "xl" : aberto === "whatsapp" ? "lg" : "md"}
      >
        {aberto === "webhook" && (
          <div className="space-y-4">
            {regras}
            <Link href={`/configuracoes/integracoes/${webinarId}/log`} className={estiloAcao.normal}>
              Ver os logs de integrações
            </Link>
          </div>
        )}
        {aberto === "whatsapp" && <FormularioCompartilhamento webinarId={webinarId} valores={compartilhamento} aoSalvar={() => salvou("Prévia do link salva.")} aoCancelar={fechar} />}
        {aberto && campoRastreamento[aberto] && (
          <FormularioRastreamento
            key={aberto}
            webinarId={webinarId}
            valores={rastreamento}
            campo={campoRastreamento[aberto]!}
            aoSalvar={() => salvou(`${atual?.nome ?? "Integração"} salvo.`)}
            aoCancelar={fechar}
          />
        )}
        {aberto === "webhook" && (
          <div className="flex justify-end">
            <button type="button" className={estiloBotao("secundario")} onClick={fechar}>
              Fechar
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}
