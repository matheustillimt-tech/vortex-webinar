"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { vinculosDaPagina, type Vinculo } from "@/src/lib/paginas";
import { caminhoImagemPagina, idValido, validarImagemPagina } from "@/src/lib/regras/midia";
import {
  limparCssPagina,
  limparHtmlPagina,
  MAX_NOME_PAGINA,
  validarConteudoPagina,
  validarNomePagina,
  validarPagina,
} from "@/src/lib/regras/paginas";
import {
  configPadrao,
  cssParaSalvar,
  documentoDePrevia,
  MAX_PROJETO_PAGINA,
  ROTULO_LUGAR,
  validarConfigPagina,
} from "@/src/lib/regras/paginas-editor";
import { modeloPagina } from "@/src/lib/regras/paginas-modelos";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";

export type Resultado = { erro?: string; ok?: boolean; valores?: Record<string, string> };

const NAO_ENCONTRADA = "Página não encontrada.";

function revalidarLista() {
  revalidatePath("/paginas");
}

/** Nova página: nome, tipo e modelo. Grava o HTML/CSS do modelo (já limpos) e o projeto do GrapesJS, e abre o
 *  editor. */
export async function criarPagina(_: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const valores = { nome: String(form.get("nome") ?? ""), tipo: String(form.get("tipo") ?? ""), modelo: String(form.get("modelo") ?? "") };
  const r = validarPagina(valores);
  if ("erro" in r) return { erro: r.erro, valores };
  const modelo = modeloPagina(r.dados.modelo);
  if (!modelo) return { erro: "Escolha um modelo deste tipo de página.", valores };

  const db = await dbUsuario();
  const linha = {
    nome: r.dados.nome,
    tipo: r.dados.tipo,
    modelo: r.dados.modelo,
    html: limparHtmlPagina(modelo.html),
    css: limparCssPagina(modelo.css),
    componentes: modelo.projeto,
    config: configPadrao(r.dados.nome),
    atualizado_por: eu.id,
  };
  const { data, error } = await db.from("paginas").insert(linha).select("id").single();
  if (error || !data) return { erro: "Não deu para criar a página.", valores };

  revalidarLista();
  await registrarAuditoria({
    usuarioId: eu.id,
    acao: "criou",
    descricao: `Criou a página "${r.dados.nome}"`,
    depois: { id: data.id, nome: r.dados.nome, tipo: r.dados.tipo, modelo: r.dados.modelo },
  });
  redirect(`/paginas/${data.id as string}/editor`);
}

/** Cópia com "(cópia)" no nome; não leva os vínculos (cada webinar escolhe a sua). */
export async function duplicarPagina(id: string): Promise<{ erro?: string; id?: string }> {
  const eu = await exigirAdmin();
  if (!idValido(id)) return { erro: NAO_ENCONTRADA };
  const db = await dbUsuario();
  const { data: original } = await db.from("paginas").select("nome, tipo, modelo, config, componentes, html, css").eq("id", id).maybeSingle();
  if (!original) return { erro: NAO_ENCONTRADA };
  const o = original as { nome: string; tipo: string; modelo: string; config: unknown; componentes: unknown; html: string; css: string };

  const sufixo = " (cópia)";
  const nome = `${o.nome.slice(0, MAX_NOME_PAGINA - sufixo.length)}${sufixo}`;
  const { data, error } = await db
    .from("paginas")
    .insert({ nome, tipo: o.tipo, modelo: o.modelo, config: o.config, componentes: o.componentes, html: o.html, css: o.css, atualizado_por: eu.id })
    .select("id")
    .single();
  if (error || !data) return { erro: "Não deu para duplicar a página." };

  revalidarLista();
  await registrarAuditoria({ usuarioId: eu.id, acao: "criou", descricao: `Duplicou a página "${o.nome}"`, depois: { id: data.id, nome } });
  return { id: data.id as string };
}

export async function renomearPagina(id: string, nome: string): Promise<{ erro?: string }> {
  const eu = await exigirAdmin();
  const erro = validarNomePagina(nome);
  if (erro) return { erro };
  if (!idValido(id)) return { erro: NAO_ENCONTRADA };
  const novo = nome.trim();
  const db = await dbUsuario();
  const { data: antes } = await db.from("paginas").select("nome").eq("id", id).maybeSingle();
  if (!antes) return { erro: NAO_ENCONTRADA };
  const { error } = await db.from("paginas").update({ nome: novo, atualizado_por: eu.id }).eq("id", id);
  if (error) return { erro: "Não deu para renomear a página." };

  revalidarLista();
  revalidatePath(`/paginas/${id}/editor`);
  await registrarAuditoria({
    usuarioId: eu.id,
    acao: "editou",
    descricao: `Renomeou a página "${(antes as { nome: string }).nome}" para "${novo}"`,
    antes,
    depois: { nome: novo },
  });
  return {};
}

export type VinculoComRotulo = Vinculo & { rotulo: string };

/** "Webinars vinculados" (e o aviso antes de excluir). */
export async function webinarsVinculados(id: string): Promise<{ erro?: string; vinculos?: VinculoComRotulo[] }> {
  await exigirAdmin();
  const db = await dbUsuario();
  const lista = await vinculosDaPagina(db, id);
  if (!lista) return { erro: "Não deu para ler os webinars vinculados." };
  return { vinculos: lista.map((v) => ({ ...v, rotulo: ROTULO_LUGAR[v.lugar] })) };
}

/** Exclui a página. Os vínculos viram "Padrão" sozinhos (FK `on delete set null`); cada webinar afetado ganha uma
 *  linha no histórico dele. */
export async function excluirPagina(id: string): Promise<{ erro?: string }> {
  const eu = await exigirAdmin();
  if (!idValido(id)) return { erro: NAO_ENCONTRADA };
  const db = await dbUsuario();
  const { data: antes } = await db.from("paginas").select("nome, tipo, modelo").eq("id", id).maybeSingle();
  if (!antes) return { erro: NAO_ENCONTRADA };
  const vinculos = (await vinculosDaPagina(db, id)) ?? [];
  const { error } = await db.from("paginas").delete().eq("id", id);
  if (error) return { erro: "Não deu para excluir a página." };

  const nome = (antes as { nome: string }).nome;
  revalidarLista();
  await registrarAuditoria({
    usuarioId: eu.id,
    acao: "excluiu",
    descricao: `Excluiu a página "${nome}"`,
    antes: { ...(antes as Record<string, unknown>), webinars_vinculados: vinculos.map((v) => ({ webinar: v.nome, lugar: ROTULO_LUGAR[v.lugar] })) },
  });
  for (const webinarId of new Set(vinculos.map((v) => v.webinarId))) {
    const lugares = vinculos.filter((v) => v.webinarId === webinarId).map((v) => ROTULO_LUGAR[v.lugar].toLowerCase());
    await registrarAuditoria({
      usuarioId: eu.id,
      webinarId,
      acao: "editou",
      descricao: `A página "${nome}" foi excluída; ${lugares.join(" e ")} voltou ao padrão`,
    });
    revalidatePath(`/webinars/${webinarId}/agenda`);
    revalidatePath(`/webinars/${webinarId}/agenda/jit`);
  }
  return {};
}

// Editor --------------------------------------------------------------------------------------------------------------

export type ConteudoEditor = { html: string; css: string; projeto: unknown; config: unknown };

function bytesJson(v: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(v) ?? "").length;
  } catch {
    return Infinity;
  }
}

/** Confere e limpa o que veio do editor: Ajustes válidos, HTML/CSS (com Ajustes + CSS personalizado) dentro do
 *  limite antes e depois da limpeza. */
function prepararConteudo(c: ConteudoEditor): { erro: string } | { html: string; css: string; config: ReturnType<typeof configPadrao> } {
  const cfg = validarConfigPagina(c.config);
  if ("erro" in cfg) return { erro: cfg.erro };
  const htmlBruto = typeof c.html === "string" ? c.html : "";
  const cssBruto = cssParaSalvar(typeof c.css === "string" ? c.css : "", cfg.dados);
  const erroBruto = validarConteudoPagina({ html: htmlBruto, css: cssBruto });
  if (erroBruto) return { erro: erroBruto };
  const html = limparHtmlPagina(htmlBruto);
  const css = limparCssPagina(cssBruto);
  const erroLimpo = validarConteudoPagina({ html, css });
  if (erroLimpo) return { erro: erroLimpo };
  return { html, css, config: cfg.dados };
}

/** Salvar do editor: grava o HTML/CSS já limpos (o que a sala mostra), o projeto do GrapesJS (`componentes`, para
 *  reabrir; até 1 MB) e os Ajustes (`config`). */
export async function salvarPagina(id: string, c: ConteudoEditor): Promise<{ erro?: string; ok?: boolean }> {
  const eu = await exigirAdmin();
  if (!idValido(id)) return { erro: NAO_ENCONTRADA };
  if (!c.projeto || typeof c.projeto !== "object") return { erro: "O projeto da página veio vazio. Recarregue o editor." };
  if (bytesJson(c.projeto) > MAX_PROJETO_PAGINA) return { erro: "A página ficou grande demais para salvar (máximo de 1 MB). Tire imagens coladas ou blocos repetidos." };
  const p = prepararConteudo(c);
  if ("erro" in p) return { erro: p.erro };

  const db = await dbUsuario();
  const { data: antes } = await db.from("paginas").select("nome, html, css, config").eq("id", id).maybeSingle();
  if (!antes) return { erro: NAO_ENCONTRADA };
  const { error } = await db
    .from("paginas")
    .update({ html: p.html, css: p.css, componentes: c.projeto, config: p.config, atualizado_por: eu.id })
    .eq("id", id);
  if (error) return { erro: "Não deu para salvar a página." };

  revalidarLista();
  const a = antes as { nome: string; html: string; css: string; config: unknown };
  await registrarAuditoria({
    usuarioId: eu.id,
    acao: "editou",
    descricao: `Editou a página "${a.nome}"`,
    antes: { tamanho_html: a.html.length, tamanho_css: a.css.length, config: a.config },
    depois: { tamanho_html: p.html.length, tamanho_css: p.css.length, config: { ...p.config, css_personalizado: `${p.config.css_personalizado.length} caracteres` } },
  });
  return { ok: true };
}

/** Pré-visualização do que está no editor (mesmo sem salvar): limpa como no salvar e devolve o documento com os
 *  blocos dinâmicos como caixas. */
export async function previaPagina(c: ConteudoEditor): Promise<{ erro?: string; documento?: string }> {
  await exigirAdmin();
  const p = prepararConteudo(c);
  if ("erro" in p) return { erro: p.erro };
  return { documento: documentoDePrevia(p.html, p.css, p.config) };
}

/** Imagem enviada pelo gerenciador de imagens do editor: `midias/paginas/<id>/<uuid>.<ext>` (JPG/PNG/WEBP/GIF, até
 *  3 MB). Devolve a URL pública. */
export async function enviarImagemPagina(id: string, form: FormData): Promise<{ erro?: string; url?: string }> {
  const eu = await exigirAdmin();
  if (!idValido(id)) return { erro: NAO_ENCONTRADA };
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File)) return { erro: "Escolha uma imagem." };
  const erro = validarImagemPagina(arquivo.type, arquivo.size);
  if (erro) return { erro };

  const db = await dbUsuario();
  const { data: pagina } = await db.from("paginas").select("nome").eq("id", id).maybeSingle();
  if (!pagina) return { erro: NAO_ENCONTRADA };

  const caminho = caminhoImagemPagina(id, arquivo.type, randomUUID());
  const storage = dbAdmin().storage.from("midias");
  const { error } = await storage.upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) return { erro: "Não deu para enviar a imagem." };
  const { data } = storage.getPublicUrl(caminho);

  await registrarAuditoria({
    usuarioId: eu.id,
    acao: "criou",
    descricao: `Enviou uma imagem para a página "${(pagina as { nome: string }).nome}"`,
    depois: { caminho },
  });
  return { url: data.publicUrl };
}
