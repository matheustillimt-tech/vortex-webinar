import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { redirect } from "next/navigation";
import { estadoSala } from "@/src/lib/regras/agenda";
import { formatarSessao } from "@/src/lib/regras/fuso";
import { estadoSalaJit, slugValido } from "@/src/lib/regras/sala";
import { t } from "@/src/lib/regras/textos-sala";
import { carregarSalaCached as carregarSala } from "@/src/lib/sala/dados";
import { caminhoSala } from "@/src/lib/sala/caminho";
import { lerSessaoDoCookie } from "@/src/lib/sala/sessao";
import { metadadosCompartilhamento } from "@/src/lib/sala/metadados";
import { carregarPaginaDaSalaCached as carregarPaginaDaSala } from "@/src/lib/sala/paginas";
import { configDaPaginaUsada, metadadosDaPagina, montarPagina } from "@/src/lib/sala/pagina-montagem";
import PaginaDoEditor from "../../_paginas/pagina-do-editor";
import HorarioPorExtenso from "../_jit/horario";
import Indisponivel from "../indisponivel";
import Contagem from "./contagem";
import { IconeStatus, TelaCartao } from "../_ui/sala-ui";

/** Sem página do editor vinculada, a espera fica com os metadados de sempre (os do layout raiz); com ela, os da sala
 *  com o título/descrição dos Ajustes da página por cima. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!slugValido(slug)) return {};
  const sala = await carregarSala(slug);
  if (!sala) return {};
  const pagina = await carregarPaginaDaSala(sala.webinar.id, sala.webinar.tipoAgenda, "espera");
  const config = configDaPaginaUsada(pagina, "espera");
  return config ? metadadosDaPagina(metadadosCompartilhamento(sala), config) : {};
}

/** Espera até o início da sessão: a página de espera do editor vinculada (JIT: `jit_config.pagina_espera_id`;
 *  única/recorrente: `agendas.pagina_espera_id`) ou, sem ela, a tela padrão. As duas têm a mesma contagem, que
 *  atualiza a página ao zerar (a raiz manda para a sala quando ela abre). */
export default async function Espera({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugValido(slug)) return <Indisponivel idioma="pt-BR" />;

  const sala = await carregarSala(slug);
  if (!sala) redirect(await caminhoSala(slug));

  let inicio: Date;
  let quando: React.ReactNode;
  // Página do editor: data já pronta (sessão única) ou calculada no navegador (JIT, por causa do fuso).
  let dataSessaoTexto: string | null = null;
  let dataSessaoJit: { iso: string; fuso: string } | null = null;
  if (sala.webinar.tipoAgenda === "jit" && sala.jit) {
    // Just in time: a espera é do horário escolhido na inscrição (sem inscrição, a raiz manda para a `/lp`).
    const sessao = await lerSessaoDoCookie(sala.webinar.id);
    if (!sessao || !sessao.jitHorario) redirect(await caminhoSala(slug));
    const { estado, janela } = estadoSalaJit(sessao.jitHorario, sala.video?.duracaoSeg || null, new Date());
    if (estado !== "espera") redirect(await caminhoSala(slug));
    inicio = janela.inicio;
    quando = <HorarioPorExtenso iso={inicio.toISOString()} fuso={sala.jit.config.fuso} idioma={sala.webinar.idioma} />;
    dataSessaoJit = { iso: inicio.toISOString(), fuso: sala.jit.config.fuso };
  } else {
    if (!sala.agenda) redirect(await caminhoSala(slug));
    const { estado, janela } = estadoSala(sala.agenda, new Date());
    // A agenda pode ter virado "aberta"/"encerrada" entre a página de entrada e esta: a raiz da sala decide de novo.
    if (estado !== "espera" || !janela) redirect(await caminhoSala(slug));
    inicio = janela.inicio;
    dataSessaoTexto = formatarSessao(janela.inicio, sala.agenda.fuso);
    quando = dataSessaoTexto;
  }

  const idioma = sala.webinar.idioma;
  const agoraServidor = Date.now();

  const pagina = await carregarPaginaDaSala(sala.webinar.id, sala.webinar.tipoAgenda, "espera");
  const montada = montarPagina(pagina, {
    lugar: "espera",
    idioma,
    titulo: sala.webinar.titulo || sala.webinar.nome,
    apresentador: sala.webinar.apresentadorNome,
    fotoUrl: sala.webinar.apresentadorAvatarUrl,
    dataSessao: dataSessaoTexto,
  });
  if (montada) {
    return (
      <PaginaDoEditor
        montada={montada}
        blocos={{ lugar: "espera", idioma, inicioMs: inicio.getTime(), agoraServidor, dataSessao: dataSessaoJit }}
      />
    );
  }

  // Espera padrão: cartão "Sala de Espera / Estamos prestes a começar / Por favor aguarde um momento,
  // começaremos em" + a contagem por extenso. Abaixo, o título do webinar, o apresentador e a data da sessão.
  return (
    <TelaCartao largura="max-w-[590px]" alinhamento="items-center">
      <IconeStatus>
        <Clock aria-hidden size={28} />
      </IconeStatus>

      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-xs font-semibold tracking-wide text-marca uppercase">{t(idioma, "salaDeEspera")}</p>
        <h1 className="text-2xl leading-snug font-bold text-titulo">{t(idioma, "esperaTitulo")}</h1>
        <p className="text-base text-texto-3">{t(idioma, "aguardeMomento")}</p>
      </div>

      <Contagem inicioMs={inicio.getTime()} idioma={idioma} agoraServidor={agoraServidor} formato="texto" />

      <div className="flex w-full flex-col items-center gap-3 border-t border-linha pt-6 text-center">
        {sala.webinar.titulo && <p className="text-base font-semibold text-texto">{sala.webinar.titulo}</p>}
        {sala.webinar.apresentadorNome && (
          <div className="flex items-center gap-3">
            {sala.webinar.apresentadorAvatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sala.webinar.apresentadorAvatarUrl} alt={sala.webinar.apresentadorNome} className="h-10 w-10 rounded-full object-cover" />
            )}
            <p className="text-sm font-medium text-texto-2">{sala.webinar.apresentadorNome}</p>
          </div>
        )}
        <p className="text-sm text-texto-3 first-letter:uppercase">
          {t(idioma, "esperaComeca")} {quando}
        </p>
      </div>
    </TelaCartao>
  );
}
