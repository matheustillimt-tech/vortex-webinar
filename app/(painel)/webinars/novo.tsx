"use client";
import { useActionState, useEffect } from "react";
import { Plus } from "lucide-react";
import { criarWebinar, type Resultado } from "./actions";
import { Botao } from "../_componentes/ui";
import { useToast } from "../_componentes/toast";

/** "Criar novo": cria na hora um webinar chamado "Novo webinar" e abre o assistente no Início, onde
 *  a pessoa troca o nome. Usa a mesma action de antes (`criarWebinar`) com o nome fixo. */
export function NovoWebinar() {
  const toast = useToast();
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(criarWebinar, {});

  useEffect(() => {
    if (estado.erro) toast.erro(estado.erro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={enviar}>
      <input type="hidden" name="nome" value="Novo webinar" />
      <Botao tamanho="pequeno" className="h-9" carregando={enviando} icone={<Plus aria-hidden />}>
        {enviando ? "Criando…" : "Criar novo"}
      </Botao>
    </form>
  );
}
