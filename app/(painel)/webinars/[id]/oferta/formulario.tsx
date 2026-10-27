"use client";
import { useActionState, useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { Campo, erroArquivosDoFormulario, estiloInput } from "../../../_componentes/ui";
import { AvisoFormulario, Interruptor, OpcoesCartao } from "../../_componentes/campos";
import { useEnvioPasso } from "../../_componentes/assistente";
import { salvarOferta, type Resultado } from "./actions";

type LayoutContagem = "classico" | "rotulos" | "urgente";

type Valores = {
  ligada: boolean;
  nome: string;
  titulo: string;
  precoOriginal: string;
  precoOferta: string;
  botaoTexto: string;
  botaoCor: string;
  bannerUrl: string | null;
  bannerMobileUrl: string | null;
  link: string;
  repassarUtms: boolean;
  aparece: string;
  some: string;
  pitch: string;
  contagem: string;
  contagemLayout: LayoutContagem;
  sorteioLigado: boolean;
  sorteioMomento: string;
  sorteioNumero: string;
};

const LAYOUTS: { valor: LayoutContagem; rotulo: string }[] = [
  { valor: "classico", rotulo: "Clássico" },
  { valor: "rotulos", rotulo: "Rótulos" },
  { valor: "urgente", rotulo: "Urgente" },
];

/** Contagem regressiva como aparece no cartão da oferta da sala, em cada layout. */
function Contagem({ layout, tempo }: { layout: LayoutContagem; tempo: string }) {
  const texto = tempo || "00:05:00";
  if (layout === "urgente") return <p className="animate-pulse text-center text-sm font-bold text-erro">{texto}</p>;
  if (layout === "rotulos") return <p className="text-center text-xs font-medium text-texto-3">Só hoje · {texto}</p>;
  return <p className="text-center text-sm font-semibold tabular-nums text-texto-2">{texto}</p>;
}

export function FormularioOferta({ idFormulario, webinarId, valores, duracaoVideo }: { idFormulario: string; webinarId: string; valores: Valores; duracaoVideo: string | null }) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(salvarOferta.bind(null, webinarId), {});
  useEnvioPasso(enviando);
  const v = estado.valores;
  const efetivos: Valores = v
    ? {
        ligada: v.ligada === "on",
        nome: v.nome ?? valores.nome,
        titulo: v.titulo ?? valores.titulo,
        precoOriginal: v.preco_original ?? valores.precoOriginal,
        precoOferta: v.preco_oferta ?? valores.precoOferta,
        botaoTexto: v.botao_texto ?? valores.botaoTexto,
        botaoCor: v.botao_cor ?? valores.botaoCor,
        bannerUrl: valores.bannerUrl,
        bannerMobileUrl: valores.bannerMobileUrl,
        link: v.link ?? valores.link,
        repassarUtms: v.repassar_utms === "on",
        aparece: v.aparece ?? valores.aparece,
        some: v.some ?? valores.some,
        pitch: v.pitch ?? valores.pitch,
        contagem: v.contagem ?? valores.contagem,
        contagemLayout: (v.contagem_layout as LayoutContagem) ?? valores.contagemLayout,
        sorteioLigado: v.sorteio_ligado === "on",
        sorteioMomento: v.sorteio_momento ?? valores.sorteioMomento,
        sorteioNumero: v.sorteio_numero ?? valores.sorteioNumero,
      }
    : valores;

  const [ligada, setLigada] = useState(efetivos.ligada);
  const [nome, setNome] = useState(efetivos.nome);
  const [titulo, setTitulo] = useState(efetivos.titulo);
  const [precoOriginal, setPrecoOriginal] = useState(efetivos.precoOriginal);
  const [precoOferta, setPrecoOferta] = useState(efetivos.precoOferta);
  const [botaoTexto, setBotaoTexto] = useState(efetivos.botaoTexto);
  const [botaoCor, setBotaoCor] = useState(efetivos.botaoCor);
  const [bannerPrevia, setBannerPrevia] = useState<string | null>(efetivos.bannerUrl);
  const [bannerMobilePrevia, setBannerMobilePrevia] = useState<string | null>(efetivos.bannerMobileUrl);
  const [contagemLayout, setContagemLayout] = useState(efetivos.contagemLayout);
  const [contagem, setContagem] = useState(efetivos.contagem);
  const [sorteioLigado, setSorteioLigado] = useState(efetivos.sorteioLigado);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  // Remonta os campos (com os novos defaultValues) a cada tentativa, sem perder o que foi digitado.
  const chaveTentativa = estado.erro ?? "inicial";

  // A action falhou: os banners escolhidos não foram salvos, então a prévia não pode continuar mostrando eles.
  // Depende de `estado` (não de `estado.erro`) porque duas tentativas seguidas podem falhar com a mesma mensagem.
  useEffect(() => {
    if (estado.erro) {
      setBannerPrevia(valores.bannerUrl);
      setBannerMobilePrevia(valores.bannerMobileUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  function aoEscolherBanner(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setBannerPrevia(URL.createObjectURL(arquivo));
  }

  function aoEscolherBannerMobile(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setBannerMobilePrevia(URL.createObjectURL(arquivo));
  }

  function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    const erro = erroArquivosDoFormulario(e.currentTarget);
    setErroArquivo(erro);
    if (erro) e.preventDefault();
  }

  const secao = "space-y-4 border-t border-linha pt-8";
  const titulo2 = "text-base font-semibold text-titulo";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 tela-slg:grid-cols-[minmax(0,1fr)_420px]">
      <form id={idFormulario} action={enviar} onSubmit={aoEnviar} className="min-w-0 space-y-8" key={chaveTentativa}>
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className={titulo2}>Oferta</h2>
            <p className="text-xs text-texto-3">{duracaoVideo ? `Duração do vídeo: ${duracaoVideo}` : "Escolha o vídeo antes para conferir os tempos."}</p>
          </div>
          <Interruptor name="ligada" checked={ligada} onChange={(e) => setLigada(e.target.checked)} rotulo="Oferta ligada" descricao="Desligada, a oferta não aparece na sala (nome e título deixam de ser obrigatórios)." />
          <div className="grid gap-4 tela-md:grid-cols-2">
            <Campo rotulo="Nome da oferta" obrigatorio={ligada} contador={`${nome.length} de 150`}>
              <input name="nome" className={estiloInput} maxLength={150} value={nome} onChange={(e) => setNome(e.target.value)} />
            </Campo>
            <Campo rotulo="Título da oferta" obrigatorio={ligada} contador={`${titulo.length} de 150`}>
              <input name="titulo" className={estiloInput} maxLength={150} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </Campo>
            <Campo rotulo="Preço original" dica="Aparece riscado. Ex.: R$ 997,00">
              <input name="preco_original" className={estiloInput} value={precoOriginal} onChange={(e) => setPrecoOriginal(e.target.value)} />
            </Campo>
            <Campo rotulo="Preço da oferta" dica="Texto livre. Ex.: 12x R$ 30,82">
              <input name="preco_oferta" className={estiloInput} value={precoOferta} onChange={(e) => setPrecoOferta(e.target.value)} />
            </Campo>
          </div>
        </section>

        <section className={secao}>
          <h2 className={titulo2}>Botão e link</h2>
          <div className="grid gap-4 tela-md:grid-cols-[1fr_140px]">
            <Campo rotulo="Texto do botão">
              <input name="botao_texto" className={estiloInput} value={botaoTexto} onChange={(e) => setBotaoTexto(e.target.value)} />
            </Campo>
            <Campo rotulo="Cor do botão">
              <input type="color" name="botao_cor" className={`${estiloInput} h-9 p-1`} value={botaoCor} onChange={(e) => setBotaoCor(e.target.value)} />
            </Campo>
          </div>
          <Campo rotulo="Link da oferta" dica="Endereço do checkout, começando com https://. Use {{nome}}, {{email}}, {{telefone}} ou {{telefone_sem_ddi}} nos parâmetros pra mandar os dados de quem está na sala (ex.: ?name={{nome}}&phone={{telefone_sem_ddi}}).">
            <input name="link" inputMode="url" className={estiloInput} defaultValue={efetivos.link} placeholder="https://" />
          </Campo>
          <Interruptor name="repassar_utms" defaultChecked={efetivos.repassarUtms} rotulo="Repassar UTMs para o link da oferta" />
        </section>

        <section className={secao}>
          <h2 className={titulo2}>Imagens da oferta</h2>
          <div className="grid gap-4 tela-md:grid-cols-2">
            <Campo rotulo="Imagem desktop" dica="16:9, ex.: 563×328.">
              <input type="file" name="banner" accept="image/jpeg,image/png,image/webp" onChange={aoEscolherBanner} className={estiloInput} />
            </Campo>
            <Campo rotulo="Imagem mobile" dica="Ex.: 382×112.">
              <input type="file" name="banner_mobile" accept="image/jpeg,image/png,image/webp" onChange={aoEscolherBannerMobile} className={estiloInput} />
            </Campo>
          </div>
        </section>

        <section className={secao}>
          <h2 className={titulo2}>Tempos</h2>
          <div className="grid gap-4 tela-md:grid-cols-3">
            <Campo rotulo="Tempo de início da oferta" obrigatorio={ligada} dica="h:mm:ss do vídeo.">
              <input name="aparece" className={estiloInput} defaultValue={efetivos.aparece} placeholder="0:01:00" />
            </Campo>
            <Campo rotulo="Tempo do fim da oferta" dica="Vazio = não some.">
              <input name="some" className={estiloInput} defaultValue={efetivos.some} placeholder="0:00:00" />
            </Campo>
            <Campo rotulo="Início da pitch" dica="Gera a métrica “Estava no pitch”.">
              <input name="pitch" className={estiloInput} defaultValue={efetivos.pitch} placeholder="opcional" />
            </Campo>
          </div>
        </section>

        <section className={secao}>
          <h2 className={titulo2}>Temporizador</h2>
          <Campo rotulo="Tempo do temporizador" dica="h:mm:ss. 0:00:00 esconde a contagem." className="tela-md:max-w-[240px]">
            <input name="contagem" className={estiloInput} value={contagem} onChange={(e) => setContagem(e.target.value)} />
          </Campo>
          <div className="space-y-2">
            <p className="text-sm font-medium text-rotulo">Layout do temporizador</p>
            <OpcoesCartao
              nome="contagem_layout"
              valor={contagemLayout}
              aoMudar={setContagemLayout}
              opcoes={LAYOUTS.map((l) => ({
                valor: l.valor,
                rotulo: l.rotulo,
                ilustracao: (
                  <span className="flex h-12 items-center justify-center rounded-md bg-suave px-2">
                    <Contagem layout={l.valor} tempo={contagem} />
                  </span>
                ),
              }))}
            />
          </div>
        </section>

        <section className={secao}>
          <h2 className={titulo2}>Sorteio</h2>
          <Interruptor name="sorteio_ligado" checked={sorteioLigado} onChange={(e) => setSorteioLigado(e.target.checked)} rotulo="Habilitar sorteio" descricao="Mostra a aba Sorteio na sala, com o número sorteado no momento marcado." />
          {sorteioLigado && (
            <div className="grid gap-4 tela-md:grid-cols-2">
              <Campo rotulo="Hora de início do sorteio" dica="h:mm:ss do vídeo.">
                <input name="sorteio_momento" className={estiloInput} defaultValue={efetivos.sorteioMomento} />
              </Campo>
              <Campo rotulo="Número do sorteio" dica="Só dígitos, até 6.">
                <input name="sorteio_numero" inputMode="numeric" maxLength={6} className={estiloInput} defaultValue={efetivos.sorteioNumero} />
              </Campo>
            </div>
          )}
        </section>

        <AvisoFormulario erro={erroArquivo ?? estado.erro} ok={estado.ok ? "Oferta salva." : null} />
      </form>

      <aside className="min-w-0 rounded-lg border border-linha bg-fundo p-4 tela-slg:sticky tela-slg:top-4">
        <p className="mb-3 text-sm font-medium text-texto-2">Prévia</p>
        <div className="overflow-hidden rounded-lg bg-white shadow-cartao-sala">
          <div className="grid grid-cols-3 gap-1 bg-[#d9d9d9] p-1 text-sm font-medium">
            <span className="rounded-sm bg-white py-1 text-center text-texto shadow-controle">Oferta</span>
            <span className="py-1 text-center text-texto-3">Chat</span>
            <span className="py-1 text-center text-texto-3">Suporte</span>
          </div>
          <div className={`space-y-3 p-4 ${ligada ? "" : "opacity-50"}`}>
            {bannerPrevia ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={bannerPrevia} alt="" className="w-full rounded-md object-cover max-tela-sm:hidden" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={bannerMobilePrevia ?? bannerPrevia} alt="" className="hidden w-full rounded-md object-cover max-tela-sm:block" />
              </>
            ) : (
              <span className="flex aspect-video w-full items-center justify-center rounded-md bg-suave text-apagado">
                <ImageIcon size={28} aria-hidden />
              </span>
            )}
            <p className="text-base font-semibold text-texto">{titulo || "Título da oferta"}</p>
            <p className="text-sm">
              {precoOriginal && <span className="mr-2 text-texto-3 line-through">De {precoOriginal}</span>}
              {precoOferta && <span className="font-semibold text-texto">Por {precoOferta}</span>}
            </p>
            <div className="flex h-11 w-full items-center justify-center truncate rounded-md px-4 text-base font-semibold text-white" style={{ backgroundColor: botaoCor }}>
              {botaoTexto || "Quero aproveitar"}
            </div>
            {contagem.trim() && !/^0*:?0*:?0+$/.test(contagem.replace(/\s/g, "")) && <Contagem layout={contagemLayout} tempo={contagem} />}
            {!ligada && <p className="text-center text-xs text-texto-3">Oferta desligada: não aparece na sala.</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
