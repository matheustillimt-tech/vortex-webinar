"use client";
import { useActionState, useEffect, useState } from "react";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { Botao, Campo, erroArquivosDoFormulario, estiloCabecalhoTabela, estiloInput, estiloTextarea, Segmentos } from "../../../_componentes/ui";
import { AvisoFormulario, Interruptor } from "../../_componentes/campos";
import { useEnvioPasso } from "../../_componentes/assistente";
import { salvarTelaLogin, type Resultado } from "./actions";

type Alinhamento = "esquerda" | "centro" | "direita";

type Valores = {
  logoUrl: string | null;
  logoAlinhamento: Alinhamento;
  logoLarguraTotal: boolean;
  barraLigada: boolean;
  barraValor: number;
  barraCor: string;
  barraCorTexto: string;
  botaoCor: string;
  botaoCorTexto: string;
  tituloHtml: string;
  botaoTexto: string;
  pedeEmail: boolean;
  emailObrigatorio: boolean;
  pedeTelefone: boolean;
  telefoneObrigatorio: boolean;
  paisPadrao: string;
  placeholderNome: string;
  placeholderEmail: string;
  placeholderTelefone: string;
};

const JUSTIFICA: Record<Alinhamento, string> = { esquerda: "justify-start", centro: "justify-center", direita: "justify-end" };

export function FormularioTelaLogin({ idFormulario, webinarId, valores }: { idFormulario: string; webinarId: string; valores: Valores }) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(salvarTelaLogin.bind(null, webinarId), {});
  useEnvioPasso(enviando);
  // Se a última tentativa deu erro, usa o que a pessoa digitou; senão, o que está salvo.
  const v = estado.valores;
  const efetivos: Valores = v
    ? {
        logoUrl: valores.logoUrl,
        logoAlinhamento: (v.logo_alinhamento as Alinhamento) ?? valores.logoAlinhamento,
        logoLarguraTotal: v.logo_largura_total === "on",
        barraLigada: v.barra_ligada === "on",
        barraValor: Number(v.barra_valor ?? valores.barraValor),
        barraCor: v.barra_cor ?? valores.barraCor,
        barraCorTexto: v.barra_cor_texto ?? valores.barraCorTexto,
        botaoCor: v.botao_cor ?? valores.botaoCor,
        botaoCorTexto: v.botao_cor_texto ?? valores.botaoCorTexto,
        tituloHtml: v.titulo_html ?? valores.tituloHtml,
        botaoTexto: v.botao_texto ?? valores.botaoTexto,
        pedeEmail: v.pede_email === "on",
        emailObrigatorio: v.email_obrigatorio === "on",
        pedeTelefone: v.pede_telefone === "on",
        telefoneObrigatorio: v.telefone_obrigatorio === "on",
        paisPadrao: v.pais_padrao ?? valores.paisPadrao,
        placeholderNome: v.placeholder_nome ?? valores.placeholderNome,
        placeholderEmail: v.placeholder_email ?? valores.placeholderEmail,
        placeholderTelefone: v.placeholder_telefone ?? valores.placeholderTelefone,
      }
    : valores;

  const [logoAlinhamento, setLogoAlinhamento] = useState(efetivos.logoAlinhamento);
  const [logoLarguraTotal, setLogoLarguraTotal] = useState(efetivos.logoLarguraTotal);
  const [logoPrevia, setLogoPrevia] = useState<string | null>(efetivos.logoUrl);
  const [barraLigada, setBarraLigada] = useState(efetivos.barraLigada);
  const [barraValor, setBarraValor] = useState(String(efetivos.barraValor));
  const [barraCor, setBarraCor] = useState(efetivos.barraCor);
  const [barraCorTexto, setBarraCorTexto] = useState(efetivos.barraCorTexto);
  const [botaoCor, setBotaoCor] = useState(efetivos.botaoCor);
  const [botaoCorTexto, setBotaoCorTexto] = useState(efetivos.botaoCorTexto);
  const [tituloHtml, setTituloHtml] = useState(efetivos.tituloHtml);
  const [botaoTexto, setBotaoTexto] = useState(efetivos.botaoTexto);
  const [pedeEmail, setPedeEmail] = useState(efetivos.pedeEmail);
  const [pedeTelefone, setPedeTelefone] = useState(efetivos.pedeTelefone);
  const [placeholderNome, setPlaceholderNome] = useState(efetivos.placeholderNome);
  const [placeholderEmail, setPlaceholderEmail] = useState(efetivos.placeholderEmail);
  const [placeholderTelefone, setPlaceholderTelefone] = useState(efetivos.placeholderTelefone);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  // Remonta os campos (com os novos defaultValues) a cada tentativa, sem perder o que foi digitado.
  const chaveTentativa = estado.erro ?? "inicial";

  // A action falhou: o logo escolhido não foi salvo, então a prévia não pode continuar mostrando ele. Depende de
  // `estado` (não de `estado.erro`) porque duas tentativas seguidas podem falhar com a mesma mensagem.
  useEffect(() => {
    if (estado.erro) setLogoPrevia(valores.logoUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  function aoEscolherLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setLogoPrevia(URL.createObjectURL(arquivo));
  }

  function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    const erro = erroArquivosDoFormulario(e.currentTarget);
    setErroArquivo(erro);
    if (erro) e.preventDefault();
  }

  function mudarBarra(delta: number) {
    const atual = Number(barraValor) || 0;
    setBarraValor(String(Math.min(99, Math.max(0, atual + delta))));
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 tela-slg:grid-cols-[minmax(0,1fr)_340px]">
      <form id={idFormulario} action={enviar} onSubmit={aoEnviar} className="min-w-0 space-y-8" key={chaveTentativa}>
        <input type="hidden" name="logo_alinhamento" value={logoAlinhamento} />

        <section className="space-y-4">
          <h2 className="text-base font-semibold text-titulo">Logo do webinar</h2>
          <Campo rotulo="Imagem do logo" dica="Tamanho recomendado 220×60. JPG, PNG ou WebP.">
            <input type="file" name="logo" accept="image/jpeg,image/png,image/webp" onChange={aoEscolherLogo} className={estiloInput} />
          </Campo>
          <Campo rotulo="Alinhamento do logo">
            <Segmentos
              opcoes={[
                { valor: "esquerda", rotulo: "Esquerda" },
                { valor: "centro", rotulo: "Centro" },
                { valor: "direita", rotulo: "Direita" },
              ]}
              valor={logoAlinhamento}
              aoMudar={setLogoAlinhamento}
            />
          </Campo>
          <Interruptor name="logo_largura_total" checked={logoLarguraTotal} onChange={(e) => setLogoLarguraTotal(e.target.checked)} rotulo="Logo ocupando a largura toda" />
        </section>

        <section className="space-y-4 border-t border-linha pt-8">
          <h2 className="text-base font-semibold text-titulo">Barra de progresso</h2>
          <Interruptor name="barra_ligada" checked={barraLigada} onChange={(e) => setBarraLigada(e.target.checked)} rotulo="Exibir barra de progresso" descricao="“92% das vagas preenchidas…” acima do formulário." />
          <div className="grid gap-4 tela-md:grid-cols-3">
            <Campo rotulo="Iniciar progresso em" dica="De 0 a 99%.">
              <span className="flex items-center gap-2">
                <Botao type="button" variante="secundario" className="w-9 px-0" aria-label="Diminuir" onClick={() => mudarBarra(-1)}>
                  <Minus aria-hidden />
                </Botao>
                <input name="barra_valor" inputMode="numeric" className={`${estiloInput} text-center`} value={barraValor} onChange={(e) => setBarraValor(e.target.value)} />
                <Botao type="button" variante="secundario" className="w-9 px-0" aria-label="Aumentar" onClick={() => mudarBarra(1)}>
                  <Plus aria-hidden />
                </Botao>
              </span>
            </Campo>
            <Campo rotulo="Cor da barra">
              <input type="color" name="barra_cor" className={`${estiloInput} h-9 p-1`} value={barraCor} onChange={(e) => setBarraCor(e.target.value)} />
            </Campo>
            <Campo rotulo="Cor do texto">
              <input type="color" name="barra_cor_texto" className={`${estiloInput} h-9 p-1`} value={barraCorTexto} onChange={(e) => setBarraCorTexto(e.target.value)} />
            </Campo>
          </div>
        </section>

        <section className="space-y-4 border-t border-linha pt-8">
          <h2 className="text-base font-semibold text-titulo">Título do webinar</h2>
          <Campo rotulo="Título" dica="Aceita HTML simples (negrito, itálico, quebra de linha)." contador={`${tituloHtml.length} de 2000`}>
            <textarea name="titulo_html" className={estiloTextarea} rows={3} maxLength={2000} value={tituloHtml} onChange={(e) => setTituloHtml(e.target.value)} />
          </Campo>
        </section>

        <section className="space-y-4 border-t border-linha pt-8">
          <h2 className="text-base font-semibold text-titulo">Editar botão</h2>
          <Campo rotulo="Título do botão" obrigatorio contador={`${botaoTexto.length} de 40`}>
            <input name="botao_texto" className={estiloInput} maxLength={40} value={botaoTexto} onChange={(e) => setBotaoTexto(e.target.value)} required />
          </Campo>
          <div className="grid gap-4 tela-md:grid-cols-2">
            <Campo rotulo="Cor do botão">
              <input type="color" name="botao_cor" className={`${estiloInput} h-9 p-1`} value={botaoCor} onChange={(e) => setBotaoCor(e.target.value)} />
            </Campo>
            <Campo rotulo="Cor do texto do botão">
              <input type="color" name="botao_cor_texto" className={`${estiloInput} h-9 p-1`} value={botaoCorTexto} onChange={(e) => setBotaoCorTexto(e.target.value)} />
            </Campo>
          </div>
        </section>

        <section className="space-y-4 border-t border-linha pt-8">
          <div>
            <h2 className="text-base font-semibold text-titulo">Formulário de acesso à sala</h2>
            <p className="mt-1 text-sm text-texto-3">O nome é sempre pedido. Deixe o e-mail ou o WhatsApp como obrigatório.</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-linha">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="border-b border-linha">
                <tr>
                  <th className={estiloCabecalhoTabela + " pl-4"}>Campo</th>
                  <th className={estiloCabecalhoTabela}>Pedir</th>
                  <th className={estiloCabecalhoTabela}>Obrigatório</th>
                  <th className={estiloCabecalhoTabela + " pr-4"}>Texto de exemplo</th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-b [&>tr]:border-linha [&>tr:last-child]:border-0">
                <tr>
                  <td className="py-2 pl-4 pr-2 font-medium">Nome</td>
                  <td className="p-2"><input type="checkbox" checked disabled aria-label="Pedir nome" /></td>
                  <td className="p-2"><input type="checkbox" checked disabled aria-label="Nome obrigatório" /></td>
                  <td className="py-2 pl-2 pr-4">
                    <input name="placeholder_nome" aria-label="Texto de exemplo do nome" className={estiloInput} value={placeholderNome} onChange={(e) => setPlaceholderNome(e.target.value)} />
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pl-4 pr-2 font-medium">E-mail</td>
                  <td className="p-2"><input type="checkbox" name="pede_email" aria-label="Pedir e-mail" checked={pedeEmail} onChange={(e) => setPedeEmail(e.target.checked)} /></td>
                  <td className="p-2"><input type="checkbox" name="email_obrigatorio" aria-label="E-mail obrigatório" defaultChecked={efetivos.emailObrigatorio} /></td>
                  <td className="py-2 pl-2 pr-4">
                    <input name="placeholder_email" aria-label="Texto de exemplo do e-mail" className={estiloInput} value={placeholderEmail} onChange={(e) => setPlaceholderEmail(e.target.value)} />
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pl-4 pr-2 font-medium">WhatsApp</td>
                  <td className="p-2"><input type="checkbox" name="pede_telefone" aria-label="Pedir WhatsApp" checked={pedeTelefone} onChange={(e) => setPedeTelefone(e.target.checked)} /></td>
                  <td className="p-2"><input type="checkbox" name="telefone_obrigatorio" aria-label="WhatsApp obrigatório" defaultChecked={efetivos.telefoneObrigatorio} /></td>
                  <td className="py-2 pl-2 pr-4">
                    <input name="placeholder_telefone" aria-label="Texto de exemplo do WhatsApp" className={estiloInput} value={placeholderTelefone} onChange={(e) => setPlaceholderTelefone(e.target.value)} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <Campo rotulo="País padrão do WhatsApp" dica="Código de 2 letras (BR, PT, US…)." className="tela-md:max-w-[240px]">
            <input name="pais_padrao" className={`${estiloInput} uppercase`} defaultValue={efetivos.paisPadrao} maxLength={2} />
          </Campo>
        </section>

        <AvisoFormulario erro={erroArquivo ?? estado.erro} ok={estado.ok ? "Tela de login salva." : null} />
      </form>

      <aside className="rounded-lg border border-linha bg-fundo p-4 tela-slg:sticky tela-slg:top-4">
        <p className="mb-3 text-sm font-medium text-texto-2">Prévia</p>
        <div className="space-y-4 rounded-xl bg-superficie p-5 shadow-cartao-sala">
          {logoPrevia && (
            <div className={`flex ${JUSTIFICA[logoAlinhamento]}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoPrevia} alt="" className={logoLarguraTotal ? "block h-auto w-full rounded-lg" : "max-h-[100px] max-w-[220px] object-contain"} />
            </div>
          )}
          {barraLigada && (
            /* Pílula alta com o texto dentro, como no login da sala (a cor do texto é pra ler sobre a barra). */
            <div className="relative h-7 w-full overflow-hidden rounded-full bg-suave">
              <div className="h-full" style={{ width: `${Math.min(99, Number(barraValor) || 0)}%`, backgroundColor: barraCor }} />
              <p className="absolute inset-0 flex items-center truncate whitespace-nowrap px-3 text-xs font-semibold" style={{ color: barraCorTexto }}>
                {barraValor}% das vagas preenchidas...
              </p>
            </div>
          )}
          <p className="break-words text-center text-base font-semibold text-texto">{textoDoTitulo(tituloHtml) || "Título do webinar"}</p>
          <div className="space-y-3">
            {[
              { rotulo: "Nome", placeholder: placeholderNome, mostra: true },
              { rotulo: "E-mail", placeholder: placeholderEmail, mostra: pedeEmail },
              { rotulo: "WhatsApp", placeholder: placeholderTelefone, mostra: pedeTelefone },
            ]
              .filter((c) => c.mostra)
              .map((c) => (
                <div key={c.rotulo} className="space-y-1.5">
                  <p className="text-sm font-medium text-rotulo">{c.rotulo}</p>
                  <div className="h-10 truncate rounded-md border border-borda px-3 text-sm leading-10 text-apagado">{c.placeholder}</div>
                </div>
              ))}
          </div>
          <div className="flex h-12 w-full items-center justify-center gap-2 truncate rounded-md px-4 text-lg font-medium" style={{ backgroundColor: botaoCor, color: botaoCorTexto }}>
            {botaoTexto || "Assistir transmissão"} <ArrowRight size={18} aria-hidden />
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Texto puro do título em HTML, pra prévia (sem interpretar o HTML no painel). */
function textoDoTitulo(html: string): string {
  return html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
