"use server";
import { revalidatePath } from "next/cache";
import { registrarAuditoria } from "@/src/lib/auditoria";
import { enviarImagem } from "@/src/lib/midias";
import { validarTelaLogin } from "@/src/lib/regras/passos";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { seguirParaProximo } from "../_proximo";

export type Resultado = { erro?: string; ok?: boolean; valores?: Record<string, string> };

// Defaults da tabela `telas_login`: as colunas são NOT NULL, mas `validarTelaLogin` devolve `null` quando a
// pessoa limpa o campo. Sem isso, o upsert falharia com um erro genérico de banco.
const PADRAO_PLACEHOLDER_NOME = "Como podemos te chamar";
const PADRAO_PLACEHOLDER_EMAIL = "Seu melhor e-mail";
const PADRAO_PLACEHOLDER_TELEFONE = "Seu WhatsApp";

export async function salvarTelaLogin(webinarId: string, _prev: Resultado, form: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const campos = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]),
  );

  const r = validarTelaLogin(campos);
  if ("erro" in r) return { erro: r.erro, valores: campos };
  const d = r.dados;

  const db = await dbUsuario();
  const { data: atualData } = await db
    .from("telas_login")
    .select(
      "logo_url, logo_alinhamento, logo_largura_total, barra_ligada, barra_valor, barra_cor, barra_cor_texto, titulo_html, botao_texto, botao_cor, botao_cor_texto, pede_email, email_obrigatorio, pede_telefone, telefone_obrigatorio, pais_padrao, placeholder_nome, placeholder_email, placeholder_telefone",
    )
    .eq("webinar_id", webinarId)
    .maybeSingle();
  const atual = atualData as { logo_url: string | null } | null;

  let logoUrl = atual?.logo_url ?? null;
  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const envio = await enviarImagem(webinarId, logo);
    if ("erro" in envio) return { erro: envio.erro, valores: campos };
    logoUrl = envio.url;
  }

  const depois = {
    webinar_id: webinarId,
    logo_url: logoUrl,
    logo_alinhamento: d.logoAlinhamento,
    logo_largura_total: d.logoLarguraTotal,
    barra_ligada: d.barraLigada,
    barra_valor: d.barraValor,
    barra_cor: d.barraCor,
    barra_cor_texto: d.barraCorTexto,
    titulo_html: d.tituloHtml,
    botao_texto: d.botaoTexto,
    botao_cor: d.botaoCor,
    botao_cor_texto: d.botaoCorTexto,
    pede_email: d.pedeEmail,
    email_obrigatorio: d.emailObrigatorio,
    pede_telefone: d.pedeTelefone,
    telefone_obrigatorio: d.telefoneObrigatorio,
    pais_padrao: d.paisPadrao,
    placeholder_nome: d.placeholderNome ?? PADRAO_PLACEHOLDER_NOME,
    placeholder_email: d.placeholderEmail ?? PADRAO_PLACEHOLDER_EMAIL,
    placeholder_telefone: d.placeholderTelefone ?? PADRAO_PLACEHOLDER_TELEFONE,
  };

  const { error } = await db.from("telas_login").upsert(depois, { onConflict: "webinar_id" });
  if (error) return { erro: "Não deu para salvar a tela de login.", valores: campos };

  revalidatePath(`/webinars/${webinarId}/login`);
  await registrarAuditoria({ usuarioId: eu.id, webinarId, acao: "editou", descricao: "Editou a tela de login", antes: atual, depois });
  seguirParaProximo(form, webinarId);
  return { ok: true, valores: campos };
}
