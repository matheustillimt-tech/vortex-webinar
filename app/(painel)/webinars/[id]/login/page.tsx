import { NOME_SISTEMA } from "@/src/lib/marca";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { dbUsuario, exigirAdmin } from "@/src/lib/supabase/usuario";
import { FORM_PASSO, TelaPasso } from "../_passos";
import { FormularioTelaLogin } from "./formulario";

export const metadata: Metadata = { title: `Tela de login · ${NOME_SISTEMA}` };

type LinhaTelaLogin = {
  logo_url: string | null;
  logo_alinhamento: "esquerda" | "centro" | "direita";
  logo_largura_total: boolean;
  barra_ligada: boolean;
  barra_valor: number;
  barra_cor: string;
  barra_cor_texto: string;
  titulo_html: string | null;
  botao_texto: string;
  botao_cor: string;
  botao_cor_texto: string;
  pede_email: boolean;
  email_obrigatorio: boolean;
  pede_telefone: boolean;
  telefone_obrigatorio: boolean;
  pais_padrao: string;
  placeholder_nome: string;
  placeholder_email: string;
  placeholder_telefone: string;
};

// Os defaults da tabela `telas_login`, usados quando a linha ainda não existe.
const PADROES: LinhaTelaLogin = {
  logo_url: null,
  logo_alinhamento: "centro",
  logo_largura_total: true,
  barra_ligada: true,
  barra_valor: 92,
  barra_cor: "#0a8452",
  barra_cor_texto: "#ffffff",
  titulo_html: null,
  botao_texto: "Assistir transmissão",
  botao_cor: "#007509",
  botao_cor_texto: "#ffffff",
  pede_email: true,
  email_obrigatorio: true,
  pede_telefone: false,
  telefone_obrigatorio: false,
  pais_padrao: "BR",
  placeholder_nome: "Como podemos te chamar",
  placeholder_email: "Seu melhor e-mail",
  placeholder_telefone: "Seu WhatsApp",
};

export default async function TelaLoginWebinar({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  const db = await dbUsuario();

  const { data: webinar } = await db.from("webinars").select("id, nome, slug").eq("id", id).maybeSingle();
  if (!webinar) notFound();

  const { data: linha } = await db
    .from("telas_login")
    .select(
      "logo_url, logo_alinhamento, logo_largura_total, barra_ligada, barra_valor, barra_cor, barra_cor_texto, titulo_html, botao_texto, botao_cor, botao_cor_texto, pede_email, email_obrigatorio, pede_telefone, telefone_obrigatorio, pais_padrao, placeholder_nome, placeholder_email, placeholder_telefone",
    )
    .eq("webinar_id", id)
    .maybeSingle();
  const tela = (linha as LinhaTelaLogin | null) ?? PADROES;

  return (
    <TelaPasso webinarId={id} nome={webinar.nome} atual="login" formulario={FORM_PASSO}>
      <FormularioTelaLogin
        idFormulario={FORM_PASSO}
        webinarId={id}
        valores={{
          logoUrl: tela.logo_url,
          logoAlinhamento: tela.logo_alinhamento,
          logoLarguraTotal: tela.logo_largura_total,
          barraLigada: tela.barra_ligada,
          barraValor: tela.barra_valor,
          barraCor: tela.barra_cor,
          barraCorTexto: tela.barra_cor_texto,
          botaoCor: tela.botao_cor,
          botaoCorTexto: tela.botao_cor_texto,
          tituloHtml: tela.titulo_html ?? "",
          botaoTexto: tela.botao_texto,
          pedeEmail: tela.pede_email,
          emailObrigatorio: tela.email_obrigatorio,
          pedeTelefone: tela.pede_telefone,
          telefoneObrigatorio: tela.telefone_obrigatorio,
          paisPadrao: tela.pais_padrao,
          placeholderNome: tela.placeholder_nome,
          placeholderEmail: tela.placeholder_email,
          placeholderTelefone: tela.placeholder_telefone,
        }}
      />
    </TelaPasso>
  );
}
