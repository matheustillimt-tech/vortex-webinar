import type { Plataforma } from "@/src/lib/regras/checkout";

export type ItemCheckout = { plataforma: Plataforma; ligado: boolean; temSegredo: boolean };
export type ItemWebhook = { id: string; plataforma: Plataforma; webinarId: string; webinarNome: string; token: string; filtroSrc: string | null };
export type ResultadoLog = "aceita" | "ignorada" | "nao_autorizada" | "erro";
export type ItemLog = {
  id: string;
  resultado: ResultadoLog;
  evento: string | null;
  createdAt: string;
  webinarNome: string | null;
  compradorMascarado: string | null;
  valorCentavos: number | null;
};

export type DadosPlataforma = {
  valor: Plataforma;
  rotulo: string;
  evento: string;
  ondeFicaSegredo: string;
  /** Sigla do quadradinho do cartão (no lugar do logo). */
  sigla: string;
};

/** Checkouts que mandam venda real por webhook (cada um abre `configuracoes/checkouts/[plataforma]`). */
export const PLATAFORMAS: DadosPlataforma[] = [
  { valor: "vortexpay", rotulo: "Vórtex Pay", evento: "venda_aprovada", ondeFicaSegredo: "Configurações do produto → Webhooks", sigla: "VP" },
  { valor: "kiwify", rotulo: "Kiwify", evento: "order_status = paid", ondeFicaSegredo: "Minha conta → Webhooks → Token", sigla: "KW" },
  { valor: "hotmart", rotulo: "Hotmart", evento: "PURCHASE_APPROVED", ondeFicaSegredo: "Ferramentas → Webhook → Hottok", sigla: "HM" },
  { valor: "eduzz", rotulo: "Eduzz", evento: "myeduzz.invoice_paid", ondeFicaSegredo: "Integrações → Webhook → Chave de assinatura", sigla: "EZ" },
  { valor: "hubla", rotulo: "Hubla", evento: "invoice.payment_succeeded", ondeFicaSegredo: "Integrações → Webhook → Token", sigla: "HB" },
  { valor: "themembers", rotulo: "TheMembers", evento: "transaction.approved", ondeFicaSegredo: "Integrações → Webhook → Token", sigla: "TM" },
];

export function plataformaDe(valor: string): DadosPlataforma | undefined {
  return PLATAFORMAS.find((p) => p.valor === valor);
}

export const ROTULO_RESULTADO: Record<ResultadoLog, string> = { aceita: "Venda", ignorada: "Ignorado", nao_autorizada: "Não autorizado", erro: "Erro" };
