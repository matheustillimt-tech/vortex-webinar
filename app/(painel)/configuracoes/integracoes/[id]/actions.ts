"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { camposAlterados } from "@/src/lib/regras/auditoria";
import { cifrar, decifrar } from "@/src/lib/crypto";
import { enviarImagem } from "@/src/lib/midias";
import { enviarTeste } from "@/src/lib/disparos";
import { gtmValido, pixelMetaValido, pixelTiktokValido } from "@/src/lib/regras/pixels";
import { lerDuracao } from "@/src/lib/regras/video";
import { validarRegra, type CandidataRegra } from "@/src/lib/regras/regras-webhook";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";

import { SENTINELA_HEADER } from "./sentinela";

export type Resultado = { erro?: string; ok?: boolean; valores?: Record<string, string> };
export type ResultadoTeste = { status: number; corpo: string } | { erro: string };

function caminho(webinarId: string): string {
  return `/configuracoes/integracoes/${webinarId}`;
}

function campos(form: FormData): Record<string, string> {
  return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]));
}

/** Lê pares chave/valor de um formulário com `name="<prefixo>_chave"` e `name="<prefixo>_valor"` repetidos (uma
 *  linha por par, na mesma ordem). Linhas totalmente vazias (sem chave e sem valor) são descartadas. */
function paresDoForm(form: FormData, prefixo: string): [string, string][] {
  return linhasDoForm(form, prefixo).map((l) => [l.chave, l.valor]);
}

type LinhaHeader = { chave: string; valor: string; original: string };

/** Como `paresDoForm`, mas guardando também o `<prefixo>_original` de cada linha (a chave com que o header foi
 *  salvo; vazio nas linhas novas). */
function linhasDoForm(form: FormData, prefixo: string): LinhaHeader[] {
  const chaves = form.getAll(`${prefixo}_chave`).map(String);
  const valores = form.getAll(`${prefixo}_valor`).map(String);
  const originais = form.getAll(`${prefixo}_original`).map(String);
  const linhas: LinhaHeader[] = [];
  for (let i = 0; i < chaves.length; i++) {
    const chave = chaves[i].trim();
    const valor = valores[i] ?? "";
    if (!chave && !valor) continue;
    linhas.push({ chave, valor, original: (originais[i] ?? "").trim() });
  }
  return linhas;
}

function headersAntigos(headersEnc: string | null): [string, string][] {
  if (!headersEnc) return [];
  try {
    const d = JSON.parse(decifrar(headersEnc));
    return Array.isArray(d) ? (d as [string, string][]) : [];
  } catch {
    return [];
  }
}

/** Troca a sentinela pelo valor salvo da chave ORIGINAL daquela linha (campo escondido `header_original`) — não
 *  pela posição: remover ou reordenar linhas nunca leva um segredo pra outra chave; renomear a chave de uma
 *  linha salva mantém o valor dela. Chaves repetidas são consumidas na ordem em que foram salvas. Sentinela sem
 *  chave original salva: erro (pede pra digitar de novo). */
function resolverHeaders(linhas: LinhaHeader[], headersEncAntigos: string | null): { headers: [string, string][] } | { erro: string } {
  if (!linhas.some((l) => l.valor === SENTINELA_HEADER)) return { headers: linhas.map((l) => [l.chave, l.valor]) };

  const salvos = new Map<string, string[]>();
  for (const [chave, valor] of headersAntigos(headersEncAntigos)) salvos.set(chave, [...(salvos.get(chave) ?? []), valor]);

  const headers: [string, string][] = [];
  for (const l of linhas) {
    if (l.valor !== SENTINELA_HEADER) {
      headers.push([l.chave, l.valor]);
      continue;
    }
    const valor = l.original ? salvos.get(l.original)?.shift() : undefined;
    if (valor === undefined) return { erro: `Digite de novo o valor do header ${l.chave}.` };
    headers.push([l.chave, valor]);
  }
  return { headers };
}

function paramsObjeto(pares: [string, string][]): Record<string, string> {
  return Object.fromEntries(pares);
}

function candidata(c: Record<string, string>, form: FormData): CandidataRegra {
  const valorSegTexto = (c.valor_seg ?? "").trim();
  return {
    gatilho: c.gatilho ?? "",
    valorSeg: valorSegTexto ? lerDuracao(valorSegTexto) : null,
    url: c.url ?? "",
    metodo: c.metodo ?? "",
    headers: paresDoForm(form, "header"),
    params: paresDoForm(form, "param"),
    corpo: c.corpo && c.corpo.trim() ? c.corpo : null,
  };
}

/** Adiciona uma regra de webhook (headers cifrados antes de gravar). */
export async function adicionarRegra(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const c = campos(form);
  const cand = candidata(c, form);

  if ((cand.gatilho === "permaneceu" || cand.gatilho === "abandonou") && (c.valor_seg ?? "").trim() && cand.valorSeg === null) {
    return { erro: "Tempo inválido (h:mm:ss).", valores: c };
  }

  const r = validarRegra(cand);
  if ("erro" in r) return { erro: r.erro, valores: c };
  const d = r.dados;

  const db = await dbUsuario();
  const { error } = await db.from("regras").insert({
    webinar_id: webinarId,
    gatilho: d.gatilho,
    valor_seg: d.valorSeg,
    url: d.url,
    metodo: d.metodo,
    headers_enc: d.headers.length ? cifrar(JSON.stringify(d.headers)) : null,
    params: paramsObjeto(d.params),
    corpo: d.corpo,
  });
  if (error) return { erro: "Não deu para adicionar a regra.", valores: c };

  revalidatePath(caminho(webinarId));
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "criou", descricao: `Adicionou a regra de webhook "${d.gatilho}"` });
  return { ok: true };
}

/** Edita uma regra existente; headers com a sentinela mantêm o segredo já salvo (não decifrado pra tela). */
export async function editarRegra(webinarId: string, regraId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const c = campos(form);
  const cand = candidata(c, form);

  if ((cand.gatilho === "permaneceu" || cand.gatilho === "abandonou") && (c.valor_seg ?? "").trim() && cand.valorSeg === null) {
    return { erro: "Tempo inválido (h:mm:ss).", valores: c };
  }

  const db = await dbUsuario();
  const { data: atualData } = await db
    .from("regras")
    .select("gatilho, valor_seg, url, metodo, headers_enc, params, corpo")
    .eq("id", regraId)
    .eq("webinar_id", webinarId)
    .maybeSingle();
  if (!atualData) return { erro: "Regra não encontrada.", valores: c };
  const atual = atualData as {
    gatilho: string;
    valor_seg: number | null;
    url: string;
    metodo: string;
    headers_enc: string | null;
    params: Record<string, string>;
    corpo: string | null;
  };

  const resolvidos = resolverHeaders(linhasDoForm(form, "header"), atual.headers_enc);
  if ("erro" in resolvidos) return { erro: resolvidos.erro, valores: c };
  const r = validarRegra({ ...cand, headers: resolvidos.headers });
  if ("erro" in r) return { erro: r.erro, valores: c };
  const d = r.dados;

  const depois = {
    gatilho: d.gatilho,
    valor_seg: d.valorSeg,
    url: d.url,
    metodo: d.metodo,
    headers_enc: d.headers.length ? cifrar(JSON.stringify(d.headers)) : null,
    params: paramsObjeto(d.params),
    corpo: d.corpo,
  };

  const { error } = await db.from("regras").update(depois).eq("id", regraId).eq("webinar_id", webinarId);
  if (error) return { erro: "Não deu para salvar a regra.", valores: c };

  revalidatePath(caminho(webinarId));
  await registrarAuditoria({
    usuarioId: eu.id,
    webinarId,
    acao: "editou",
    descricao: `Editou a regra de webhook "${d.gatilho}"`,
    antes: atual,
    depois,
  });
  return { ok: true };
}

export async function alternarRegra(webinarId: string, form: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const id = String(form.get("id") ?? "");
  const ativa = form.get("ativa") === "1";
  if (!id) return;

  const db = await dbUsuario();
  const { data: regra } = await db.from("regras").select("gatilho").eq("id", id).eq("webinar_id", webinarId).maybeSingle();
  await db.from("regras").update({ ativa: !ativa }).eq("id", id).eq("webinar_id", webinarId);
  revalidatePath(caminho(webinarId));
  const gatilho = (regra as { gatilho: string } | null)?.gatilho ?? id;
  await registrarAuditoria({
    usuarioId: eu.id,
    webinarId,
    acao: "editou",
    descricao: `${ativa ? "Desativou" : "Ativou"} a regra de webhook "${gatilho}"`,
    antes: { ativa },
    depois: { ativa: !ativa },
  });
}

export async function excluirRegra(webinarId: string, form: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const id = String(form.get("id") ?? "");
  if (!id) return;

  const db = await dbUsuario();
  await db.from("regras").delete().eq("id", id).eq("webinar_id", webinarId);
  revalidatePath(caminho(webinarId));
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "excluiu", descricao: "Excluiu uma regra de webhook" });
}

/** "Enviar teste": confere que a regra é do webinar antes de disparar, com dados fictícios, sem gravar nada em
 *  `disparos`. */
export async function enviarTesteRegra(webinarId: string, regraId: string): Promise<ResultadoTeste> {
  await exigirAdmin();
  const db = await dbUsuario();
  const { data } = await db.from("regras").select("id").eq("id", regraId).eq("webinar_id", webinarId).maybeSingle();
  if (!data) return { erro: "Regra não encontrada." };
  return enviarTeste(regraId);
}

// --- Rastreamento (pixels, GTM, script personalizado) -------------------------------------------------------

const MAX_SCRIPT = 10000;

export async function salvarRastreamento(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const c = campos(form);

  const pixelMetaTexto = (c.pixel_meta ?? "").trim();
  if (pixelMetaTexto && !pixelMetaValido(pixelMetaTexto)) return { erro: "Pixel da Meta inválido (só dígitos).", valores: c };

  const pixelTiktokTexto = (c.pixel_tiktok ?? "").trim();
  if (pixelTiktokTexto && !pixelTiktokValido(pixelTiktokTexto)) return { erro: "Pixel do TikTok inválido.", valores: c };

  const gtmTexto = (c.gtm ?? "").trim();
  if (gtmTexto && !gtmValido(gtmTexto)) return { erro: "GTM inválido (ex.: GTM-ABC123).", valores: c };

  const scriptTexto = c.script_personalizado ?? "";
  if (scriptTexto.length > MAX_SCRIPT) return { erro: "Script muito longo.", valores: c };

  const db = await dbUsuario();
  const { data: atualData } = await db
    .from("webinars")
    .select("pixel_meta, pixel_tiktok, gtm, script_personalizado")
    .eq("id", webinarId)
    .maybeSingle();

  const depois = {
    pixel_meta: pixelMetaTexto || null,
    pixel_tiktok: pixelTiktokTexto || null,
    gtm: gtmTexto || null,
    script_personalizado: scriptTexto.trim() ? scriptTexto : null,
  };

  const { error } = await db.from("webinars").update(depois).eq("id", webinarId);
  if (error) return { erro: "Não deu para salvar o rastreamento.", valores: c };

  revalidatePath(caminho(webinarId));
  // Nunca grava o valor dos pixels/script (podem conter dados sensíveis do cliente) — só quais campos mudaram.
  const alterados = camposAlterados(atualData ?? null, depois).map((a) => a.campo);
  await registrarAuditoria({
    usuarioId: eu.id,
    webinarId,
    acao: "editou",
    descricao: alterados.length ? `Editou o rastreamento (campos: ${alterados.join(", ")})` : "Editou o rastreamento",
  });
  return { ok: true };
}

// --- Compartilhamento (prévia do link) -----------------------------------------------------------------------

export async function salvarCompartilhamento(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const c = campos(form);

  const titulo = (c.compartilhar_titulo ?? "").trim();
  if (titulo.length > 80) return { erro: "O título pode ter até 80 caracteres.", valores: c };

  const descricao = (c.compartilhar_descricao ?? "").trim();
  if (descricao.length > 160) return { erro: "A descrição pode ter até 160 caracteres.", valores: c };

  const db = await dbUsuario();
  const { data: atualData } = await db
    .from("webinars")
    .select("compartilhar_titulo, compartilhar_descricao, compartilhar_imagem_url")
    .eq("id", webinarId)
    .maybeSingle();

  let imagemUrl: string | null | undefined;
  const imagem = form.get("compartilhar_imagem");
  if (imagem instanceof File && imagem.size > 0) {
    const envio = await enviarImagem(webinarId, imagem, "compartilhamento");
    if ("erro" in envio) return { erro: envio.erro, valores: c };
    imagemUrl = envio.url;
  }

  const atualizacao: Record<string, unknown> = {
    compartilhar_titulo: titulo || null,
    compartilhar_descricao: descricao || null,
  };
  if (imagemUrl !== undefined) atualizacao.compartilhar_imagem_url = imagemUrl;

  const { error } = await db.from("webinars").update(atualizacao).eq("id", webinarId);
  if (error) return { erro: "Não deu para salvar o compartilhamento.", valores: c };

  revalidatePath(caminho(webinarId));
  await registrarAuditoria({
    usuarioId: eu.id,
    webinarId,
    acao: "editou",
    descricao: "Editou o compartilhamento (prévia do link)",
    antes: atualData,
    depois: atualizacao,
  });
  return { ok: true };
}
