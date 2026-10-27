"use client";
import { useEffect } from "react";
import { Botao, BotaoLink, estiloCartao, Pagina, Vazio } from "./_componentes/ui";
import { Icone } from "./_componentes/icone";

/** Erro inesperado numa tela do painel: mensagem amigável (o erro técnico vai só pro console), com tentar de novo. */
export default function ErroPainel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Pagina titulo="Algo deu errado">
      <div className={estiloCartao}>
        <Vazio
          icone={<Icone nome="error_outline" tamanho={16} />}
          texto="Não deu para carregar esta tela."
          detalhe="Tente de novo. Se continuar, avise quem cuida do sistema."
          acao={
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Botao type="button" onClick={reset}>
                Tentar de novo
              </Botao>
              <BotaoLink href="/" variante="secundario">
                Voltar ao Dashboard
              </BotaoLink>
            </div>
          }
        />
        {error.digest && <p className="pb-4 text-center text-[11px] text-vg-text-3">Código: {error.digest}</p>}
      </div>
    </Pagina>
  );
}
