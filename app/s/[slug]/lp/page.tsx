import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { slugValido, utmsDaUrl } from "@/src/lib/regras/sala";
import { proximosHorariosJit } from "@/src/lib/regras/jit";
import { verificarTokenTeste } from "@/src/lib/regras/sessao-token";
import { env } from "@/src/lib/env";
import { carregarSalaCached as carregarSala } from "@/src/lib/sala/dados";
import { metadadosCompartilhamento } from "@/src/lib/sala/metadados";
import { caminhoSala } from "@/src/lib/sala/caminho";
import { carregarPaginaDaSalaCached as carregarPaginaDaSala } from "@/src/lib/sala/paginas";
import { configDaPaginaUsada, formularioMostraHorarios, metadadosDaPagina, montarPagina } from "@/src/lib/sala/pagina-montagem";
import PaginaDoEditor from "../../_paginas/pagina-do-editor";
import Indisponivel from "../indisponivel";
import { serializarConfig, serializarHorarios } from "../_jit/serial";
import Formulario from "./formulario";
import type { PropsInscricao } from "./inscricao";

type Busca = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!slugValido(slug)) return {};
  const sala = await carregarSala(slug);
  if (!sala) return {};
  const base = metadadosCompartilhamento(sala);
  if (sala.webinar.tipoAgenda !== "jit") return base;
  const pagina = await carregarPaginaDaSala(sala.webinar.id, "jit", "registro");
  return metadadosDaPagina(base, configDaPaginaUsada(pagina, "registro"));
}

function normalizarBusca(sp: Busca): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    r[k] = Array.isArray(v) ? v[0] ?? "" : v;
  }
  return r;
}

/** Página de inscrição do just in time: a página de registro do editor vinculada (`jit_config.pagina_registro_id`),
 *  ou, sem ela, a tela padrão — título, apresentador, os próximos horários (no fuso da configuração ou no do
 *  navegador) e o formulário da tela de login. Webinar que não é JIT volta para a entrada normal; arquivado ou
 *  sem vídeo fica indisponível. */
export default async function Inscricao({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Busca> }) {
  const { slug } = await params;
  if (!slugValido(slug)) return <Indisponivel idioma="pt-BR" />;
  const sp = normalizarBusca(await searchParams);

  const sala = await carregarSala(slug);
  if (!sala) return <Indisponivel idioma="pt-BR" />;
  if (sala.webinar.tipoAgenda !== "jit" || !sala.jit) redirect(await caminhoSala(slug));
  const idioma = sala.webinar.idioma;
  if (sala.webinar.status !== "ativo" || !sala.video) return <Indisponivel idioma={idioma} />;

  const agora = new Date();
  // "participante": o servidor não sabe o fuso do navegador, então a primeira lista sai em Brasília e o cliente
  // recalcula com o fuso dele assim que monta (a action confere de novo com o fuso que vier no formulário).
  const iniciais = proximosHorariosJit(sala.jit.horarios, sala.jit.config, agora).map((d) => d.toISOString());

  const tokenTeste = sp.teste ? verificarTokenTeste(sp.teste, env("SALA_TOKEN_SECRET"), Math.floor(agora.getTime() / 1000)) : null;
  const teste = !!tokenTeste && tokenTeste.w === sala.webinar.id ? sp.teste : null;

  const inscricao: PropsInscricao = {
    slug,
    idioma,
    tela: sala.telaLogin,
    horarios: serializarHorarios(sala.jit.horarios),
    config: serializarConfig(sala.jit.config),
    iniciais,
    agoraServidor: agora.getTime(),
    utms: utmsDaUrl(sp),
    teste,
  };

  const pagina = await carregarPaginaDaSala(sala.webinar.id, "jit", "registro");
  const montada = montarPagina(pagina, {
    lugar: "registro",
    idioma,
    titulo: sala.webinar.titulo || sala.webinar.nome,
    apresentador: sala.webinar.apresentadorNome,
    fotoUrl: sala.webinar.apresentadorAvatarUrl,
    dataSessao: null, // primeiro horário oferecido, calculado no navegador (fuso)
  });
  if (montada) {
    return (
      <PaginaDoEditor
        montada={montada}
        blocos={{ lugar: "registro", inscricao, mostrarHorarios: formularioMostraHorarios(montada.montar) }}
      />
    );
  }

  return (
    <Formulario
      {...inscricao}
      titulo={sala.webinar.titulo}
      apresentadorNome={sala.webinar.apresentadorNome}
      apresentadorAvatarUrl={sala.webinar.apresentadorAvatarUrl}
    />
  );
}
