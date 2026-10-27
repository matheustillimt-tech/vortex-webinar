import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizarVenda, passaFiltroSrc, semSegredos } from "@/src/lib/regras/checkout";

const SEGREDO = "segredo-do-webhook-123";

describe("normalizarVenda: vortexpay", () => {
  // Header `x-vortexwebinar-secret` = segredo configurado na plataforma.
  const corpo = JSON.stringify({
    evento: "venda_aprovada",
    id_transacao: "vp_1",
    valor_centavos: 19700,
    comprador: { email: "Ana@X.com", telefone: "+5511987654321" },
    src: "ig-story",
    utms: { utm_source: "ig" },
  });

  it("aceita com o segredo certo", () => {
    const r = normalizarVenda("vortexpay", corpo, { "x-vortexwebinar-secret": SEGREDO }, SEGREDO);
    expect(r).toEqual({
      resultado: "aceita",
      venda: {
        idTransacao: "vp_1",
        valorCentavos: 19700,
        email: "ana@x.com",
        telefone: "+5511987654321",
        telefoneDigitos: "5511987654321",
        src: "ig-story",
        utms: { utm_source: "ig" },
        evento: "vortexpay",
      },
    });
  });

  it("segredo vazio (não configurado): aceita sem conferir — o token da URL já autentica", () => {
    const r = normalizarVenda("vortexpay", corpo, {}, "");
    expect(r.resultado).toBe("aceita");
  });

  it("segredo errado: não autorizada", () => {
    const r = normalizarVenda("vortexpay", corpo, { "x-vortexwebinar-secret": "errado" }, SEGREDO);
    expect(r).toEqual({ resultado: "nao_autorizada" });
  });

  it("evento que não é venda aprovada: ignorada", () => {
    const outro = JSON.stringify({ evento: "venda_reembolsada", id_transacao: "vp_2", valor_centavos: 100, comprador: {} });
    const r = normalizarVenda("vortexpay", outro, { "x-vortexwebinar-secret": SEGREDO }, SEGREDO);
    expect(r).toEqual({ resultado: "ignorada", motivo: "Evento não é venda aprovada." });
  });
});

describe("normalizarVenda: vortexpay no formato da Pay (padrão Kiwify)", () => {
  // Exemplo do webhook do Vórtex Pay (formato da Kiwify), resumido.
  const pedido = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      webhook_event_type: "compra_aprovada",
      order_id: "pedido-teste-0001",
      order_status: "paid",
      Customer: { full_name: "João da Silva", email: "Joao@Exemplo.com", mobile: "+5511900007777" },
      Commissions: { charge_amount: 9700, currency: "BRL" },
      TrackingParameters: { src: "webinar", utm_source: "whatsapp", utm_campaign: null },
      access_token: "tok-123",
      ...extra,
    });

  it("compra aprovada sem segredo: aceita, valor em centavos, comprador e UTMs do TrackingParameters", () => {
    expect(normalizarVenda("vortexpay", pedido(), {}, "")).toEqual({
      resultado: "aceita",
      venda: {
        idTransacao: "pedido-teste-0001",
        valorCentavos: 9700,
        email: "joao@exemplo.com",
        telefone: "+5511900007777",
        telefoneDigitos: "5511900007777",
        src: "webinar",
        utms: { utm_source: "whatsapp" },
        evento: "vortexpay",
      },
    });
  });

  it("com segredo: aceita pelo HMAC-SHA256 no X-Webhook-Signature ou pelo access_token; recusa errado", () => {
    const corpo = pedido();
    const hmac = createHmac("sha256", SEGREDO).update(corpo).digest("hex");
    expect(normalizarVenda("vortexpay", corpo, { "x-webhook-signature": hmac }, SEGREDO).resultado).toBe("aceita");
    expect(normalizarVenda("vortexpay", pedido({ access_token: SEGREDO }), {}, SEGREDO).resultado).toBe("aceita");
    expect(normalizarVenda("vortexpay", corpo, { "x-webhook-signature": "errado" }, SEGREDO)).toEqual({ resultado: "nao_autorizada" });
  });

  it("outros eventos (Pix gerado, reembolso, recusada): ignorada", () => {
    for (const ev of ["pix_gerado", "compra_reembolsada", "compra_recusada"]) {
      expect(normalizarVenda("vortexpay", pedido({ webhook_event_type: ev, order_status: "waiting_payment" }), {}, "")).toEqual({
        resultado: "ignorada",
        motivo: "Evento não é venda aprovada.",
      });
    }
  });

  it("telefone sem código do país (comprador de fora): guarda os dígitos sem zero à esquerda pra casar a sessão", () => {
    const r = normalizarVenda("vortexpay", pedido({ Customer: { email: "a@b.com", mobile: "0430780810" } }), {}, "");
    expect(r.resultado === "aceita" && r.venda.telefoneDigitos).toBe("430780810");
  });

  it("access_token não vai pro log", () => {
    expect(semSegredos({ access_token: "x", order_id: "1" })).toEqual({ order_id: "1" });
  });
});

describe("normalizarVenda: kiwify", () => {
  // Assinatura na query `signature` = HMAC-SHA1(segredo, corpo bruto) em hex.
  const corpo = JSON.stringify({
    order_id: "kw_1",
    order_status: "paid",
    Commissions: { charge_amount: 29700 },
    Customer: { email: "Bia@Y.com", mobile: "+5511900007777" },
    TrackingParameters: { src: "yt-ads" },
    utm_source: "youtube",
    utm_medium: "ads",
  });
  const assinatura = createHmac("sha1", SEGREDO).update(corpo).digest("hex");

  it("aceita com a assinatura certa", () => {
    const r = normalizarVenda("kiwify", corpo, { signature: assinatura }, SEGREDO);
    expect(r).toEqual({
      resultado: "aceita",
      venda: {
        idTransacao: "kw_1",
        valorCentavos: 29700,
        email: "bia@y.com",
        telefone: "+5511900007777",
        telefoneDigitos: "5511900007777",
        src: "yt-ads",
        utms: { utm_source: "youtube", utm_medium: "ads" },
        evento: "kiwify",
      },
    });
  });

  it("assinatura errada: não autorizada", () => {
    const r = normalizarVenda("kiwify", corpo, { signature: "deadbeef" }, SEGREDO);
    expect(r).toEqual({ resultado: "nao_autorizada" });
  });

  it("assinatura na query string (?signature=), que é como a Kiwify manda", () => {
    expect(normalizarVenda("kiwify", corpo, {}, SEGREDO, { signature: assinatura }).resultado).toBe("aceita");
    expect(normalizarVenda("kiwify", corpo, {}, SEGREDO, { signature: "deadbeef" })).toEqual({ resultado: "nao_autorizada" });
    expect(normalizarVenda("kiwify", corpo, {}, SEGREDO, { signature: null })).toEqual({ resultado: "nao_autorizada" });
  });

  it("order_status diferente de paid: ignorada", () => {
    const pendente = JSON.stringify({ order_id: "kw_2", order_status: "pending", Commissions: {}, Customer: {} });
    const assinaturaPendente = createHmac("sha1", SEGREDO).update(pendente).digest("hex");
    const r = normalizarVenda("kiwify", pendente, { signature: assinaturaPendente }, SEGREDO);
    expect(r).toEqual({ resultado: "ignorada", motivo: "Evento não é venda aprovada." });
  });
});

describe("normalizarVenda: hotmart", () => {
  // Header `x-hotmart-hottok` = segredo.
  const corpo = JSON.stringify({
    event: "PURCHASE_APPROVED",
    data: {
      purchase: { transaction: "ht_1", price: { value: 197.9 }, origin: { src: "fb-ads", sck: "camp1" } },
      buyer: { email: "Caio@Z.com", checkout_phone: "+5511900006666" },
    },
  });

  it("aceita, converte reais em centavos e lê src/sck", () => {
    const r = normalizarVenda("hotmart", corpo, { "x-hotmart-hottok": SEGREDO }, SEGREDO);
    expect(r).toEqual({
      resultado: "aceita",
      venda: {
        idTransacao: "ht_1",
        valorCentavos: 19790,
        email: "caio@z.com",
        telefone: "+5511900006666",
        telefoneDigitos: "5511900006666",
        src: "fb-ads",
        utms: { sck: "camp1" },
        evento: "hotmart",
      },
    });
  });

  it("hottok errado: não autorizada", () => {
    const r = normalizarVenda("hotmart", corpo, { "x-hotmart-hottok": "errado" }, SEGREDO);
    expect(r).toEqual({ resultado: "nao_autorizada" });
  });
});

describe("normalizarVenda: eduzz", () => {
  // Header `x-signature` = HMAC-SHA256(segredo, corpo bruto) em hex.
  const corpo = JSON.stringify({
    event: "myeduzz.invoice_paid",
    data: { id: "ez_1", paid: { value: 97.5 }, buyer: { email: "Duda@W.com", cellphone: "+5511900005555" }, utm: { utm_campaign: "lanc1" } },
  });
  const assinatura = createHmac("sha256", SEGREDO).update(corpo).digest("hex");

  it("aceita com a assinatura certa", () => {
    const r = normalizarVenda("eduzz", corpo, { "x-signature": assinatura }, SEGREDO);
    expect(r).toEqual({
      resultado: "aceita",
      venda: {
        idTransacao: "ez_1",
        valorCentavos: 9750,
        email: "duda@w.com",
        telefone: "+5511900005555",
        telefoneDigitos: "5511900005555",
        src: null,
        utms: { utm_campaign: "lanc1" },
        evento: "eduzz",
      },
    });
  });

  it("assinatura errada: não autorizada", () => {
    const r = normalizarVenda("eduzz", corpo, { "x-signature": "deadbeef" }, SEGREDO);
    expect(r).toEqual({ resultado: "nao_autorizada" });
  });
});

describe("normalizarVenda: hubla", () => {
  // Header `x-hubla-token` = segredo.
  const corpo = JSON.stringify({
    type: "invoice.payment_succeeded",
    event: {
      invoice: { id: "hb_1", amount: { totalCents: 14900 }, paymentSession: { utm: { utm_source: "tiktok" } } },
      user: { email: "Edu@V.com", phone: "+5511900004444" },
    },
  });

  it("aceita", () => {
    const r = normalizarVenda("hubla", corpo, { "x-hubla-token": SEGREDO }, SEGREDO);
    expect(r).toEqual({
      resultado: "aceita",
      venda: {
        idTransacao: "hb_1",
        valorCentavos: 14900,
        email: "edu@v.com",
        telefone: "+5511900004444",
        telefoneDigitos: "5511900004444",
        src: null,
        utms: { utm_source: "tiktok" },
        evento: "hubla",
      },
    });
  });

  it("token errado: não autorizada", () => {
    const r = normalizarVenda("hubla", corpo, { "x-hubla-token": "errado" }, SEGREDO);
    expect(r).toEqual({ resultado: "nao_autorizada" });
  });
});

describe("normalizarVenda: themembers", () => {
  // Header `x-themembers-token` = segredo.
  const corpo = JSON.stringify({
    event: "transaction.approved",
    data: { transaction_id: "tm_1", value: 497, customer: { email: "Fê@U.com", phone: "+5511900003333" }, src: "email-lista" },
  });

  it("aceita", () => {
    const r = normalizarVenda("themembers", corpo, { "x-themembers-token": SEGREDO }, SEGREDO);
    expect(r).toEqual({
      resultado: "aceita",
      venda: {
        idTransacao: "tm_1",
        valorCentavos: 49700,
        email: "fê@u.com",
        telefone: "+5511900003333",
        telefoneDigitos: "5511900003333",
        src: "email-lista",
        utms: {},
        evento: "themembers",
      },
    });
  });

  it("token errado: não autorizada", () => {
    const r = normalizarVenda("themembers", corpo, { "x-themembers-token": "errado" }, SEGREDO);
    expect(r).toEqual({ resultado: "nao_autorizada" });
  });

  it("corpo malformado: ignorada", () => {
    const r = normalizarVenda("themembers", "{ não é json", { "x-themembers-token": SEGREDO }, SEGREDO);
    expect(r).toEqual({ resultado: "ignorada", motivo: "Corpo inválido." });
  });
});

describe("passaFiltroSrc", () => {
  const venda = {
    idTransacao: "x",
    valorCentavos: 100,
    email: "a@b.com",
    telefone: null,
    telefoneDigitos: null,
    src: "ig-story",
    utms: { utm_campaign: "lanc-outubro" },
    evento: "vortexpay" as const,
  };

  it("sem filtro, sempre passa", () => {
    expect(passaFiltroSrc(venda, null)).toBe(true);
    expect(passaFiltroSrc(venda, "")).toBe(true);
  });

  it("filtro que bate com src passa", () => {
    expect(passaFiltroSrc(venda, "ig")).toBe(true);
  });

  it("filtro que bate com alguma UTM passa", () => {
    expect(passaFiltroSrc(venda, "outubro")).toBe(true);
  });

  it("filtro que não bate em nada não passa", () => {
    expect(passaFiltroSrc(venda, "facebook")).toBe(false);
  });
});

describe("normalizarVenda: id e valor", () => {
  function vortex(extra: Record<string, unknown>) {
    return JSON.stringify({ evento: "venda_aprovada", id_transacao: "tx-1", valor_centavos: 100, comprador: {}, ...extra });
  }

  it("sem id da transação: ignorada com motivo (nunca 'undefined')", () => {
    expect(normalizarVenda("vortexpay", vortex({ id_transacao: undefined }), {}, "")).toEqual({ resultado: "ignorada", motivo: "Venda sem id da transação." });
    expect(normalizarVenda("vortexpay", vortex({ id_transacao: "  " }), {}, "")).toEqual({ resultado: "ignorada", motivo: "Venda sem id da transação." });
    expect(normalizarVenda("vortexpay", vortex({ id_transacao: { a: 1 } }), {}, "")).toEqual({ resultado: "ignorada", motivo: "Venda sem id da transação." });
  });

  it("id numérico vira texto", () => {
    const r = normalizarVenda("vortexpay", vortex({ id_transacao: 123 }), {}, "");
    expect(r.resultado === "aceita" && r.venda.idTransacao).toBe("123");
  });

  it("valor ausente, não numérico ou negativo: ignorada com motivo", () => {
    expect(normalizarVenda("vortexpay", vortex({ valor_centavos: undefined }), {}, "")).toEqual({ resultado: "ignorada", motivo: "Valor inválido." });
    expect(normalizarVenda("vortexpay", vortex({ valor_centavos: "abc" }), {}, "")).toEqual({ resultado: "ignorada", motivo: "Valor inválido." });
    expect(normalizarVenda("vortexpay", vortex({ valor_centavos: -1 }), {}, "")).toEqual({ resultado: "ignorada", motivo: "Valor inválido." });
  });

  it("valor numérico em texto é lido; zero vale", () => {
    const r1 = normalizarVenda("vortexpay", vortex({ valor_centavos: "19700" }), {}, "");
    expect(r1.resultado === "aceita" && r1.venda.valorCentavos).toBe(19700);
    const r2 = normalizarVenda("vortexpay", vortex({ valor_centavos: 0 }), {}, "");
    expect(r2.resultado === "aceita" && r2.venda.valorCentavos).toBe(0);
  });

  it("telefone da plataforma vira E.164 (Brasil por padrão); inválido vira null", () => {
    const r1 = normalizarVenda("vortexpay", vortex({ comprador: { telefone: "(11) 90000-7777" } }), {}, "");
    expect(r1.resultado === "aceita" && r1.venda.telefone).toBe("+5511900007777");
    const r2 = normalizarVenda("vortexpay", vortex({ comprador: { telefone: "123" } }), {}, "");
    expect(r2.resultado === "aceita" && r2.venda.telefone).toBeNull();
  });
});

describe("semSegredos", () => {
  it("tira hottok, token, signature e secret em qualquer nível (sem diferenciar caixa)", () => {
    const bruto = { hottok: "h", data: { Token: "t", buyer: { email: "a@b.com" }, itens: [{ secret: "s", nome: "x" }] }, Signature: "sig", ok: 1 };
    expect(semSegredos(bruto)).toEqual({ data: { buyer: { email: "a@b.com" }, itens: [{ nome: "x" }] }, ok: 1 });
  });
});
