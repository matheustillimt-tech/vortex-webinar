"use client";
import { useActionState, useEffect, useState } from "react";
import { ImageIcon, Users } from "lucide-react";
import { Botao, Campo, erroArquivosDoFormulario, estiloInput, estiloTextarea } from "../../../_componentes/ui";
import { AvisoFormulario } from "../../../webinars/_componentes/campos";
import { salvarCompartilhamento, salvarRastreamento, type Resultado } from "./actions";

export type ValoresRastreamento = { pixelMeta: string; pixelTiktok: string; gtm: string; scriptPersonalizado: string };
export type CampoRastreamento = "pixel_meta" | "pixel_tiktok" | "gtm" | "script_personalizado";

const CHAVE: Record<CampoRastreamento, keyof ValoresRastreamento> = {
  pixel_meta: "pixelMeta",
  pixel_tiktok: "pixelTiktok",
  gtm: "gtm",
  script_personalizado: "scriptPersonalizado",
};

/** Um cartão de rastreamento (Facebook Pixel, TikTok Pixel, GTM ou script). A action salva os quatro juntos, então
 *  os outros três vão escondidos com o valor salvo: editar um não apaga os outros. */
export function FormularioRastreamento({ webinarId, valores, campo, aoSalvar, aoCancelar }: {
  webinarId: string;
  valores: ValoresRastreamento;
  campo: CampoRastreamento;
  aoSalvar?: () => void;
  aoCancelar?: () => void;
}) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(salvarRastreamento.bind(null, webinarId), {});
  const [valor, setValor] = useState((estado.valores?.[campo] as string | undefined) ?? valores[CHAVE[campo]]);

  useEffect(() => {
    if (estado.ok) aoSalvar?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const outros = (Object.keys(CHAVE) as CampoRastreamento[]).filter((c) => c !== campo);

  return (
    <form action={enviar} className="space-y-4">
      {outros.map((c) => (
        <input key={c} type="hidden" name={c} value={valores[CHAVE[c]]} />
      ))}
      {campo === "pixel_meta" && (
        <Campo rotulo="Código do Pixel" dica="Só os dígitos do ID do pixel da Meta. Vazio = sem pixel.">
          <input name="pixel_meta" inputMode="numeric" className={estiloInput} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="123456789012345" />
        </Campo>
      )}
      {campo === "pixel_tiktok" && (
        <Campo rotulo="Código do Pixel" dica="ID do pixel do TikTok. Vazio = sem pixel.">
          <input name="pixel_tiktok" className={estiloInput} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="ABC123XYZ" />
        </Campo>
      )}
      {campo === "gtm" && (
        <Campo rotulo="ID do contêiner" dica="Vazio = sem Google Tag Manager.">
          <input name="gtm" className={estiloInput} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="GTM-ABC123" />
        </Campo>
      )}
      {campo === "script_personalizado" && (
        <Campo rotulo="Script personalizado" dica="Roda na sala. Só cole código de quem você confia." contador={`${valor.length} de 10000`}>
          <textarea name="script_personalizado" className={`${estiloTextarea} font-mono text-xs`} rows={8} maxLength={10000} value={valor} onChange={(e) => setValor(e.target.value)} />
        </Campo>
      )}
      <AvisoFormulario erro={estado.erro} />
      <div className="flex flex-col-reverse gap-2 tela-sm:flex-row tela-sm:justify-end">
        {aoCancelar && (
          <Botao type="button" variante="secundario" onClick={aoCancelar}>
            Cancelar
          </Botao>
        )}
        <Botao carregando={enviando}>{enviando ? "Salvando…" : "Salvar"}</Botao>
      </div>
    </form>
  );
}

type ValoresCompartilhamento = { compartilharTitulo: string; compartilharDescricao: string; compartilharImagemUrl: string | null };

/** Prévia do link quando compartilhado (WhatsApp e redes): título, descrição e imagem, com o desenho da mensagem. */
export function FormularioCompartilhamento({ webinarId, valores, aoSalvar, aoCancelar }: {
  webinarId: string;
  valores: ValoresCompartilhamento;
  aoSalvar?: () => void;
  aoCancelar?: () => void;
}) {
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(salvarCompartilhamento.bind(null, webinarId), {});
  const v = estado.valores;
  const [titulo, setTitulo] = useState(v?.compartilhar_titulo ?? valores.compartilharTitulo);
  const [descricao, setDescricao] = useState(v?.compartilhar_descricao ?? valores.compartilharDescricao);
  const [imagem, setImagem] = useState<string | null>(valores.compartilharImagemUrl);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  useEffect(() => {
    if (estado.ok) aoSalvar?.();
    if (estado.erro) setImagem(valores.compartilharImagemUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    const erro = erroArquivosDoFormulario(e.currentTarget);
    setErroArquivo(erro);
    if (erro) e.preventDefault();
  }

  return (
    <form action={enviar} onSubmit={aoEnviar} className="grid gap-6 tela-md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-4">
        <Campo rotulo="Título" contador={`${titulo.length} de 80`}>
          <input name="compartilhar_titulo" className={estiloInput} value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={80} />
        </Campo>
        <Campo rotulo="Descrição" contador={`${descricao.length} de 160`}>
          <textarea name="compartilhar_descricao" className={estiloTextarea} rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={160} />
        </Campo>
        <Campo rotulo="Imagem" dica="1200×630 recomendado, até 3 MB.">
          <input
            type="file"
            name="compartilhar_imagem"
            accept="image/jpeg,image/png,image/webp"
            className={estiloInput}
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) setImagem(URL.createObjectURL(arquivo));
            }}
          />
        </Campo>
        <AvisoFormulario erro={erroArquivo ?? estado.erro} />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-texto-2">Prévia</p>
        <div className="rounded-lg bg-[#e5ddd5] p-3">
          <div className="flex items-center gap-2 pb-2 text-xs font-medium text-[#075e54]">
            <span className="grid size-6 place-items-center rounded-full bg-white text-[#075e54]">
              <Users size={14} aria-hidden />
            </span>
            Seu Grupo
          </div>
          <div className="overflow-hidden rounded-lg bg-white shadow-sm">
            <div className="m-1 overflow-hidden rounded-md bg-[#f0f0f0]">
              {imagem ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imagem} alt="" className="aspect-[1.91/1] w-full object-cover" />
              ) : (
                <span className="grid aspect-[1.91/1] w-full place-items-center text-apagado">
                  <ImageIcon size={24} aria-hidden />
                </span>
              )}
              <div className="space-y-0.5 p-2">
                <p className="line-clamp-2 text-xs font-semibold text-texto">{titulo || "Título do webinar"}</p>
                <p className="line-clamp-2 text-[11px] text-texto-3">{descricao || "Descrição que aparece no link."}</p>
              </div>
            </div>
            <p className="px-2 pb-1.5 text-[11px] text-[#027eb5]">Link da sala</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 tela-sm:flex-row tela-sm:justify-end tela-md:col-span-2">
        {aoCancelar && (
          <Botao type="button" variante="secundario" onClick={aoCancelar}>
            Cancelar
          </Botao>
        )}
        <Botao carregando={enviando}>{enviando ? "Salvando…" : "Salvar"}</Botao>
      </div>
    </form>
  );
}
