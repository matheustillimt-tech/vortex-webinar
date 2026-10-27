/** Normalização das vendas reais de cada plataforma de checkout. Função pura: recebe o corpo bruto (pra conferir
 *  a assinatura) e o segredo já decifrado; quem recebe o HTTP, grava o log e casa com a sessão é
 *  `src/lib/checkout.ts` (server-only). Documentação de formato e assinatura de cada plataforma fica junto da
 *  função que a lê, abaixo. */

import { createHmac } from "node:crypto";
import { segredosIguais } from "../crypto";
import { paraE164 } from "./telefone";

export type Plataforma = "vortexpay" | "kiwify" | "hotmart" | "eduzz" | "hubla" | "themembers";

export type Venda = {
  idTransacao: string;
  valorCentavos: number;
  email: string | null;
  telefone: string | null;
  /** Dígitos do telefone como a plataforma mandou (sem zeros à esquerda), pra casar comprador de fora do Brasil
   *  quando a plataforma manda sem o código do país (`paraE164` assume Brasil). */
  telefoneDigitos: string | null;
  src: string | null;
  utms: Record<string, string>;
  evento: Plataforma;
};

export type ResultadoVenda = { resultado: "aceita"; venda: Venda } | { resultado: "ignorada"; motivo: string } | { resultado: "nao_autorizada" };

const ignorada = (motivo: string): ResultadoVenda => ({ resultado: "ignorada", motivo });

/** Venda como veio da plataforma, antes de conferir id e valor: `valor` em centavos, ou em reais quando
 *  `emReais`. */
type VendaBruta = {
  id: unknown;
  valor: unknown;
  emReais: boolean;
  email: string | null;
  telefone: string | null;
  src: string | null;
  utms: Record<string, string>;
};

/** Id da transação: texto não vazio ou número; qualquer outra coisa (inclusive ausente) é `null` — nunca vira
 *  "undefined" por `String(undefined)`. */
function idDaTransacao(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Valor numérico (número ou texto só com dígitos e ponto decimal); `null` se não der pra ler. */
function valorNumerico(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** Confere id e valor (sem id ou com valor não numérico/negativo: ignorada, com o motivo), normaliza e-mail
 *  (minúsculo) e telefone (E.164, Brasil por padrão) e monta a venda. */
function aceita(b: VendaBruta, plataforma: Plataforma): ResultadoVenda {
  const idTransacao = idDaTransacao(b.id);
  if (!idTransacao) return ignorada("Venda sem id da transação.");
  const valor = valorNumerico(b.valor);
  if (valor === null || valor < 0) return ignorada("Valor inválido.");
  const email = b.email ? b.email.trim().toLowerCase() || null : null;
  return {
    resultado: "aceita",
    venda: {
      idTransacao,
      valorCentavos: Math.round(b.emReais ? valor * 100 : valor),
      email,
      telefone: b.telefone ? paraE164(b.telefone) : null,
      telefoneDigitos: b.telefone ? b.telefone.replace(/\D/g, "").replace(/^0+/, "") || null : null,
      src: b.src,
      utms: b.utms,
      evento: plataforma,
    },
  };
}
const NAO_AUTORIZADA: ResultadoVenda = { resultado: "nao_autorizada" };

/** Compara em tempo constante; strings de tamanhos diferentes (ex.: assinatura truncada) ainda não vazam tempo
 *  relevante — `segredosIguais` já corta rápido nesse caso, como o resto do código faz. */
function assinaturaBate(a: string, b: string): boolean {
  return segredosIguais(a, b);
}

function comHeader(headers: Record<string, string>, nome: string): string {
  return headers[nome] ?? headers[nome.toLowerCase()] ?? "";
}

function corpoJsonOuNulo(corpo: string): Record<string, unknown> | null {
  try {
    const d = JSON.parse(corpo);
    return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function utmsDoObjeto(o: unknown): Record<string, string> {
  if (!o || typeof o !== "object") return {};
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (typeof v === "string") r[k] = v;
  return r;
}

function utmsDeCamposUtm(obj: Record<string, unknown>): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) if (k.startsWith("utm_") && typeof v === "string") r[k] = v;
  return r;
}

/** Vórtex Pay (checkout aberto: https://github.com/matheustillimt-tech/vortex-pay). Manda no formato da Kiwify
 *  (`webhook_event_type`, `order_id`, `order_status`, `Commissions.charge_amount` em centavos, `Customer.email`/`mobile`, `TrackingParameters`).
 *  Venda: `webhook_event_type === "compra_aprovada"` com `order_status === "paid"`. Com segredo configurado,
 *  vale o header `X-Webhook-Signature` = HMAC-SHA256(segredo, corpo bruto) em hex ou o `access_token` do corpo
 *  idêntico ao segredo (o "Token" do webhook na Pay). Sem `webhook_event_type`: formato antigo, abaixo. */
function normalizarVortexpayFormatoPay(corpo: string, d: Record<string, unknown>, headers: Record<string, string>, segredo: string): ResultadoVenda {
  if (segredo) {
    const hmac = createHmac("sha256", segredo).update(corpo).digest("hex");
    const assinaturaOk = assinaturaBate(comHeader(headers, "x-webhook-signature"), hmac);
    const tokenOk = typeof d.access_token === "string" && assinaturaBate(d.access_token, segredo);
    if (!assinaturaOk && !tokenOk) return NAO_AUTORIZADA;
  }
  if (d.webhook_event_type !== "compra_aprovada" || d.order_status !== "paid") return ignorada("Evento não é venda aprovada.");
  const commissions = (d.Commissions as Record<string, unknown>) ?? {};
  const customer = (d.Customer as Record<string, unknown>) ?? {};
  const tracking = (d.TrackingParameters as Record<string, unknown>) ?? {};
  return aceita(
    {
      id: d.order_id,
      valor: commissions.charge_amount,
      emReais: false,
      email: texto(customer.email),
      telefone: texto(customer.mobile),
      src: texto(tracking.src),
      utms: { ...utmsDeCamposUtm(d), ...utmsDeCamposUtm(tracking) },
    },
    "vortexpay",
  );
}

/** Vórtex Pay, formato antigo (de antes da Pay mandar no padrão Kiwify). Header `x-vortexwebinar-secret` =
 *  segredo. Corpo:
 *  `{ evento: "venda_aprovada", id_transacao, valor_centavos, comprador: { email, telefone }, src, utms }`. */
function normalizarVortexpay(corpo: string, headers: Record<string, string>, segredo: string): ResultadoVenda {
  const bruto = corpoJsonOuNulo(corpo);
  if (bruto && "webhook_event_type" in bruto) return normalizarVortexpayFormatoPay(corpo, bruto, headers, segredo);
  if (segredo && !assinaturaBate(comHeader(headers, "x-vortexwebinar-secret"), segredo)) return NAO_AUTORIZADA;
  const d = corpoJsonOuNulo(corpo);
  if (!d) return ignorada("Corpo inválido.");
  if (d.evento !== "venda_aprovada") return ignorada("Evento não é venda aprovada.");
  const comprador = (d.comprador as Record<string, unknown>) ?? {};
  return aceita(
    {
      id: d.id_transacao,
      valor: d.valor_centavos,
      emReais: false,
      email: texto(comprador.email),
      telefone: texto(comprador.telefone),
      src: texto(d.src),
      utms: utmsDoObjeto(d.utms),
    },
    "vortexpay",
  );
}

/** Kiwify. Assinatura na query string (`?signature=`) = HMAC-SHA1(segredo, corpo bruto) em hex; o header
 *  `signature` fica de reserva. Venda aprovada:
 *  `order_status === "paid"`. Corpo: `order_id`, `Commissions.charge_amount` (centavos), `Customer.email`,
 *  `Customer.mobile`, `TrackingParameters.src`, `utm_*` nas raiz. */
function normalizarKiwify(corpo: string, headers: Record<string, string>, segredo: string, consulta: Consulta): ResultadoVenda {
  if (segredo) {
    const esperada = createHmac("sha1", segredo).update(corpo).digest("hex");
    const recebida = consulta.signature || comHeader(headers, "signature");
    if (!assinaturaBate(recebida, esperada)) return NAO_AUTORIZADA;
  }
  const d = corpoJsonOuNulo(corpo);
  if (!d) return ignorada("Corpo inválido.");
  if (d.order_status !== "paid") return ignorada("Evento não é venda aprovada.");
  const commissions = (d.Commissions as Record<string, unknown>) ?? {};
  const customer = (d.Customer as Record<string, unknown>) ?? {};
  const tracking = (d.TrackingParameters as Record<string, unknown>) ?? {};
  return aceita(
    {
      id: d.order_id,
      valor: commissions.charge_amount,
      emReais: false,
      email: texto(customer.email),
      telefone: texto(customer.mobile),
      src: texto(tracking.src),
      utms: utmsDeCamposUtm(d),
    },
    "kiwify",
  );
}

/** Hotmart. Header `x-hotmart-hottok` = segredo. Venda aprovada: `event === "PURCHASE_APPROVED"`. Corpo:
 *  `data.purchase.transaction`, `data.purchase.price.value` (reais → centavos), `data.buyer.email`,
 *  `data.buyer.checkout_phone`, `data.purchase.origin.src`/`sck`. */
function normalizarHotmart(corpo: string, headers: Record<string, string>, segredo: string): ResultadoVenda {
  if (segredo && !assinaturaBate(comHeader(headers, "x-hotmart-hottok"), segredo)) return NAO_AUTORIZADA;
  const d = corpoJsonOuNulo(corpo);
  if (!d) return ignorada("Corpo inválido.");
  if (d.event !== "PURCHASE_APPROVED") return ignorada("Evento não é venda aprovada.");
  const data = (d.data as Record<string, unknown>) ?? {};
  const purchase = (data.purchase as Record<string, unknown>) ?? {};
  const price = (purchase.price as Record<string, unknown>) ?? {};
  const buyer = (data.buyer as Record<string, unknown>) ?? {};
  const origin = (purchase.origin as Record<string, unknown>) ?? {};
  const utms: Record<string, string> = {};
  const sck = texto(origin.sck);
  if (sck) utms.sck = sck;
  return aceita(
    {
      id: purchase.transaction,
      valor: price.value,
      emReais: true,
      email: texto(buyer.email),
      telefone: texto(buyer.checkout_phone),
      src: texto(origin.src),
      utms,
    },
    "hotmart",
  );
}

/** Eduzz. Header `x-signature` = HMAC-SHA256(segredo, corpo bruto) em hex. Venda aprovada:
 *  `event === "myeduzz.invoice_paid"`. Corpo: `data.id`, `data.paid.value` (reais), `data.buyer.email`,
 *  `data.buyer.cellphone`, `data.utm` (objeto). */
function normalizarEduzz(corpo: string, headers: Record<string, string>, segredo: string): ResultadoVenda {
  if (segredo) {
    const esperada = createHmac("sha256", segredo).update(corpo).digest("hex");
    if (!assinaturaBate(comHeader(headers, "x-signature"), esperada)) return NAO_AUTORIZADA;
  }
  const d = corpoJsonOuNulo(corpo);
  if (!d) return ignorada("Corpo inválido.");
  if (d.event !== "myeduzz.invoice_paid") return ignorada("Evento não é venda aprovada.");
  const data = (d.data as Record<string, unknown>) ?? {};
  const paid = (data.paid as Record<string, unknown>) ?? {};
  const buyer = (data.buyer as Record<string, unknown>) ?? {};
  return aceita(
    {
      id: data.id,
      valor: paid.value,
      emReais: true,
      email: texto(buyer.email),
      telefone: texto(buyer.cellphone),
      src: null,
      utms: utmsDoObjeto(data.utm),
    },
    "eduzz",
  );
}

/** Hubla. Header `x-hubla-token` = segredo. Venda aprovada: `type === "invoice.payment_succeeded"`. Corpo:
 *  `event.invoice.id`, `event.invoice.amount.totalCents`, `event.user.email`, `event.user.phone`,
 *  `event.invoice.paymentSession.utm`. */
function normalizarHubla(corpo: string, headers: Record<string, string>, segredo: string): ResultadoVenda {
  if (segredo && !assinaturaBate(comHeader(headers, "x-hubla-token"), segredo)) return NAO_AUTORIZADA;
  const d = corpoJsonOuNulo(corpo);
  if (!d) return ignorada("Corpo inválido.");
  if (d.type !== "invoice.payment_succeeded") return ignorada("Evento não é venda aprovada.");
  const event = (d.event as Record<string, unknown>) ?? {};
  const invoice = (event.invoice as Record<string, unknown>) ?? {};
  const amount = (invoice.amount as Record<string, unknown>) ?? {};
  const user = (event.user as Record<string, unknown>) ?? {};
  const paymentSession = (invoice.paymentSession as Record<string, unknown>) ?? {};
  return aceita(
    {
      id: invoice.id,
      valor: amount.totalCents,
      emReais: false,
      email: texto(user.email),
      telefone: texto(user.phone),
      src: null,
      utms: utmsDoObjeto(paymentSession.utm),
    },
    "hubla",
  );
}

/** TheMembers. Header `x-themembers-token` = segredo. Venda aprovada: `event === "transaction.approved"`.
 *  Corpo: `data.transaction_id`, `data.value` (reais), `data.customer.email`, `data.customer.phone`, `data.src`. */
function normalizarThemembers(corpo: string, headers: Record<string, string>, segredo: string): ResultadoVenda {
  if (segredo && !assinaturaBate(comHeader(headers, "x-themembers-token"), segredo)) return NAO_AUTORIZADA;
  const d = corpoJsonOuNulo(corpo);
  if (!d) return ignorada("Corpo inválido.");
  if (d.event !== "transaction.approved") return ignorada("Evento não é venda aprovada.");
  const data = (d.data as Record<string, unknown>) ?? {};
  const customer = (data.customer as Record<string, unknown>) ?? {};
  return aceita(
    {
      id: data.transaction_id,
      valor: data.value,
      emReais: true,
      email: texto(customer.email),
      telefone: texto(customer.phone),
      src: texto(data.src),
      utms: {},
    },
    "themembers",
  );
}

/** Parâmetros da query string do webhook (hoje só a Kiwify assina por aí). */
export type Consulta = { signature?: string | null };

const NORMALIZADORES: Record<Plataforma, (corpo: string, headers: Record<string, string>, segredo: string, consulta: Consulta) => ResultadoVenda> = {
  vortexpay: normalizarVortexpay,
  kiwify: normalizarKiwify,
  hotmart: normalizarHotmart,
  eduzz: normalizarEduzz,
  hubla: normalizarHubla,
  themembers: normalizarThemembers,
};

/** Normaliza o corpo bruto de uma plataforma de checkout numa venda, conferindo a assinatura/segredo (segredo
 *  vazio = não configurado ainda: aceita sem conferir, porque o token da URL já autenticou o webhook). */
export function normalizarVenda(
  plataforma: Plataforma,
  corpoBruto: string,
  headers: Record<string, string>,
  segredo: string,
  consulta: Consulta = {},
): ResultadoVenda {
  return NORMALIZADORES[plataforma](corpoBruto, headers, segredo, consulta);
}

/** `checkout_webhooks.filtro_src`: sem filtro sempre passa; com filtro, só conta se `src` ou alguma UTM contiver
 *  o texto (sem diferenciar maiúsculas/minúsculas). */
export function passaFiltroSrc(venda: Venda, filtro: string | null): boolean {
  if (!filtro) return true;
  const alvo = filtro.toLowerCase();
  if (venda.src && venda.src.toLowerCase().includes(alvo)) return true;
  return Object.values(venda.utms).some((v) => v.toLowerCase().includes(alvo));
}

const CAMPOS_SECRETOS = new Set(["hottok", "token", "access_token", "signature", "secret"]);

/** Cópia do corpo sem os campos de segredo conhecidos (`hottok`, `token`, `access_token`, `signature`, `secret`, em qualquer
 *  nível e sem diferenciar caixa) — é o que vai pro log e pra `vendas.bruto`. */
export function semSegredos(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(semSegredos);
  if (v && typeof v === "object") {
    const r: Record<string, unknown> = {};
    for (const [k, valor] of Object.entries(v as Record<string, unknown>)) {
      if (CAMPOS_SECRETOS.has(k.toLowerCase())) continue;
      r[k] = semSegredos(valor);
    }
    return r;
  }
  return v;
}
