import { BotaoLink, estiloCartao, Pagina, Vazio } from "./_componentes/ui";

/** `notFound()` de uma tela do painel (webinar, página ou teste que não existe mais): aparece dentro do menu. */
export default function NaoEncontradoPainel() {
  return (
    <Pagina titulo="Não encontrado">
      <div className={estiloCartao}>
        <Vazio
          texto="Não encontramos o que você procura."
          detalhe="O link pode estar errado, ou o item foi apagado ou arquivado."
          acao={<BotaoLink href="/">Voltar ao Dashboard</BotaoLink>}
        />
      </div>
    </Pagina>
  );
}
