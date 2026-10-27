"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../_componentes/toast";
import { Botao, CampoTexto } from "../_componentes/ui";
import { adicionarExterno, type ResultadoExterno } from "./actions";

/** Aba "Usar um link" do modal "Enviar novo vídeo": nome, URL (.m3u8 ou .mp4) e duração. */
export function VideoExterno({ aoAdicionar }: { aoAdicionar?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [estado, enviar, enviando] = useActionState<ResultadoExterno, FormData>(adicionarExterno, {});

  useEffect(() => {
    if (!estado.ok) return;
    toast.sucesso("Vídeo adicionado.");
    aoAdicionar?.();
    router.refresh();
    // Só reage a um novo resultado da action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={enviar} className="space-y-4">
      <CampoTexto key={`nome-${estado.valores?.nome ?? ""}`} rotulo="Nome" name="nome" defaultValue={estado.valores?.nome ?? ""} required />
      <CampoTexto key={`url-${estado.valores?.url ?? ""}`} rotulo="Link" name="url" type="url" placeholder="https://…/video.m3u8 ou .mp4" defaultValue={estado.valores?.url ?? ""} required />
      <CampoTexto
        key={`duracao-${estado.valores?.duracao ?? ""}`}
        rotulo="Duração (hh:mm:ss)"
        name="duracao"
        placeholder="00:45:00"
        defaultValue={estado.valores?.duracao ?? ""}
        dica="Obrigatória para MP4; para HLS, só se não der para ler do link."
      />
      {estado.erro && <p role="alert" className="text-sm text-erro">{estado.erro}</p>}
      <div className="flex justify-end">
        <Botao carregando={enviando}>Adicionar</Botao>
      </div>
    </form>
  );
}
