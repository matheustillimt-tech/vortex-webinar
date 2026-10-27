import { urlFontes } from "@/src/lib/regras/paginas-editor";
import { precisaAtualizadorEspera, type PaginaMontada } from "@/src/lib/sala/pagina-montagem";
import { AtualizadorEspera } from "../[slug]/espera/contagem";
import MontadorPagina, { type BlocosCliente } from "./montador";

/** Estilo de base dos blocos da sala, antes do CSS do usuário. `:where()` zera a especificidade do contêiner: qualquer
 *  regra do editor (`.vw-pagina .vw-vagas-barra{...}`) passa por cima. */
export const CSS_BASE = [
  // Blocos e pontos de montagem saem como `<span>` (válido dentro de `<h1>`/`<p>`); aqui viram bloco.
  ":where(.vw-pagina) .vw-bloco,:where(.vw-pagina) .vw-vagas-trilho,:where(.vw-pagina) .vw-vagas-barra,:where(.vw-pagina) .vw-vagas-texto{display:block}",
  // Título solto: grande como um `<h1>`. Dentro de um título/parágrafo, herda o tamanho de quem o envolve.
  ":where(.vw-pagina) .vw-bloco:where(.vw-titulo){font-size:2em;font-weight:700;line-height:1.2}",
  ":where(.vw-pagina) :where(h1,h2,h3,h4,h5,h6,p)>.vw-bloco{font-size:inherit;font-weight:inherit;line-height:inherit}",
  ":where(.vw-pagina) .vw-foto-apresentador{display:block;width:96px;height:96px;margin:0 auto;border-radius:9999px;object-fit:cover}",
  ":where(.vw-pagina) .vw-vagas{width:100%;max-width:24rem;margin:0 auto}",
  ":where(.vw-pagina) .vw-vagas-trilho{height:10px;border-radius:9999px;background:rgba(127,127,127,.25);overflow:hidden}",
  ":where(.vw-pagina) .vw-vagas-barra{height:100%;border-radius:9999px;background:#0a8452}",
  ":where(.vw-pagina) .vw-vagas-texto{margin-top:6px;font-size:13px;text-align:center}",
].join("");

/** Página do editor na sala (servidor): fonte dos Ajustes, CSS limpo e escopado em `.vw-pagina` e o HTML com os
 *  pontos de montagem, que o `MontadorPagina` (cliente) preenche com os componentes da sala. Espera sem o bloco
 *  `contagem` ganha o `AtualizadorEspera` (invisível), para abrir a sala na hora como a tela padrão. O CSS já vem com `<`
 *  escapado (`limparCssPagina`), então não fecha o `<style>`. */
export default function PaginaDoEditor({ montada, blocos }: { montada: PaginaMontada; blocos: BlocosCliente }) {
  return (
    <>
      <link rel="stylesheet" href={urlFontes([montada.fonte])} precedence="default" />
      <style dangerouslySetInnerHTML={{ __html: CSS_BASE + montada.css }} />
      <MontadorPagina html={montada.html} blocos={blocos} />
      {blocos.lugar === "espera" && precisaAtualizadorEspera(blocos.lugar, montada.montar) && (
        <AtualizadorEspera inicioMs={blocos.inicioMs} agoraServidor={blocos.agoraServidor} />
      )}
    </>
  );
}
