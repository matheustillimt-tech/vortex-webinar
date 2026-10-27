import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleStop, Play } from "lucide-react";
import { camposLinkMagico, decidirEntrada, decidirEntradaJit, slugValido, utmsDaUrl } from "@/src/lib/regras/sala";
import { estadoSala } from "@/src/lib/regras/agenda";
import { verificarTokenAcesso, verificarTokenTeste } from "@/src/lib/regras/sessao-token";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import { env } from "@/src/lib/env";
import { carregarSalaCached as carregarSala, salaCheia, type Sala } from "@/src/lib/sala/dados";
import { metadadosCompartilhamento } from "@/src/lib/sala/metadados";
import { caminhoSala } from "@/src/lib/sala/caminho";
import { lerSessaoDoCookie } from "@/src/lib/sala/sessao";
import Indisponivel from "./indisponivel";
import Login from "./login";
import { BOTAO_MARCA_SALA, LINK_SALA, TelaAviso } from "./_ui/sala-ui";

type Busca = Record<string, string | string[] | undefined>;

function Encerrada({ idioma, caminhoReplay, caminhoLp }: { idioma: Idioma; caminhoReplay: string | null; caminhoLp: string | null }) {
  return (
    <TelaAviso icone={<CircleStop aria-hidden size={28} />} tom="neutro" titulo={t(idioma, "encerrada")}>
      {caminhoReplay && (
        <a href={caminhoReplay} className={BOTAO_MARCA_SALA}>
          <Play aria-hidden size={20} />
          {t(idioma, "replay")}
        </a>
      )}
      {caminhoLp && (
        <a href={caminhoLp} className={LINK_SALA}>
          {t(idioma, "outroHorario")}
        </a>
      )}
    </TelaAviso>
  );
}

/** Entrada do webinar just in time: sem inscrição → `/lp`; com inscrição, a janela do horário escolhido decide
 *  (espera com contagem, sala, encerrada com replay). O token de teste do Pronto abre a sala de teste direto. */
async function entradaJit(slug: string, sala: Sala, sp: Record<string, string>, agora: Date) {
  const idioma = sala.webinar.idioma;
  const sessao = await lerSessaoDoCookie(sala.webinar.id);
  const tokenTeste = sp.teste ? verificarTokenTeste(sp.teste, env("SALA_TOKEN_SECRET"), Math.floor(agora.getTime() / 1000)) : null;
  const replay = sp.replay === "1";

  const decisao = decidirEntradaJit({
    webinarAtivo: sala.webinar.status === "ativo",
    temVideo: !!sala.video,
    teste: !!tokenTeste && tokenTeste.w === sala.webinar.id,
    replay,
    sessao: sessao ? { modo: sessao.modo, jitHorario: sessao.jitHorario } : null,
    duracaoSeg: sala.video?.duracaoSeg || null,
    agora,
  });

  if (decisao === "indisponivel") return <Indisponivel idioma={idioma} />;
  if (decisao === "criar_sessao_teste") {
    redirect(`${await caminhoSala(slug, "entrar")}?${new URLSearchParams(sp).toString()}`);
  }
  if (decisao === "lp") {
    const qs = new URLSearchParams(utmsDaUrl(sp)).toString();
    redirect(`${await caminhoSala(slug, "lp")}${qs ? `?${qs}` : ""}`);
  }
  if (decisao === "espera") redirect(await caminhoSala(slug, "espera"));
  if (decisao === "sala") redirect(`${await caminhoSala(slug, "sala")}${replay ? "?replay=1" : ""}`);
  return (
    <Encerrada idioma={idioma} caminhoReplay={`${await caminhoSala(slug, "sala")}?replay=1`} caminhoLp={await caminhoSala(slug, "lp")} />
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!slugValido(slug)) return {};
  const sala = await carregarSala(slug);
  return sala ? metadadosCompartilhamento(sala) : {};
}

function normalizarBusca(sp: Busca): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    r[k] = Array.isArray(v) ? v[0] ?? "" : v;
  }
  return r;
}

export default async function Entrada({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Busca>;
}) {
  const { slug } = await params;
  // Slug fora do formato (ex.: "/evil.com", decodificado pelo Next a partir de "/s/%2Fevil.com") nunca chega a
  // compor um caminho ou redirect — renderiza a página de indisponível direto, sem tocar em `caminhoSala`.
  if (!slugValido(slug)) return <Indisponivel idioma="pt-BR" />;

  const sp = normalizarBusca(await searchParams);

  const sala = await carregarSala(slug);
  if (!sala) return <Indisponivel idioma="pt-BR" />;

  const idioma = sala.webinar.idioma;
  const agora = new Date();
  const webinarAtivo = sala.webinar.status === "ativo";
  const temVideo = !!sala.video;
  const agoraSeg = Math.floor(agora.getTime() / 1000);

  // Link de acesso do e-mail (`?acesso=<token>`): token válido deste webinar vai para o `/entrar`, que devolve a
  // página mínima com POST automático (um bot de pré-visualização nunca grava o cookie). Inválido ou expirado:
  // segue a entrada normal, sem erro técnico.
  if (sp.acesso) {
    const acesso = verificarTokenAcesso(sp.acesso, env("SALA_TOKEN_SECRET"), agoraSeg);
    if (acesso && acesso.w === sala.webinar.id) {
      redirect(`${await caminhoSala(slug, "entrar")}?${new URLSearchParams({ acesso: sp.acesso }).toString()}`);
    }
  }

  if (sala.webinar.tipoAgenda === "jit") return entradaJit(slug, sala, sp, agora);

  const estadoAgenda = sala.agenda ? estadoSala(sala.agenda, agora) : { estado: "encerrada" as const, janela: null };
  const { estado } = estadoAgenda;
  const replay = sp.replay === "1";
  const tokenTeste = sp.teste ? verificarTokenTeste(sp.teste, env("SALA_TOKEN_SECRET"), agoraSeg) : null;
  const teste = !!tokenTeste && tokenTeste.w === sala.webinar.id;

  // Sessão de teste só vale pelo link de teste: no link normal, quem abriu o teste antes entra como participante.
  const sessaoCookie = await lerSessaoDoCookie(sala.webinar.id);
  const sessao = sessaoCookie?.modo === "teste" && !teste ? null : sessaoCookie;
  const cheia = await salaCheia(sala.webinar.id, sala.webinar.limiteSimultaneo, agora);

  const campos = camposLinkMagico(sp);
  const linkMagicoValido = !!(campos.nome || campos.email || campos.telefone);

  const decisao = decidirEntrada({
    webinarAtivo,
    temVideo,
    estado,
    replay,
    teste,
    temSessao: !!sessao,
    cheia,
    acessoFacilitado: sala.webinar.acessoFacilitado,
    linkMagicoValido,
  });

  if (decisao === "indisponivel") return <Indisponivel idioma={idioma} />;
  if (decisao === "espera") redirect(await caminhoSala(slug, "espera"));
  if (decisao === "cheia") redirect(await caminhoSala(slug, "cheia"));
  // Replay (link do Pronto) com sessão: leva o `replay=1` pra sala, que troca a sessão pra replay no servidor.
  if (decisao === "sala") redirect(`${await caminhoSala(slug, "sala")}${replay ? "?replay=1" : ""}`);

  if (decisao === "encerrada") {
    return <Encerrada idioma={idioma} caminhoReplay={sessao ? `${await caminhoSala(slug, "sala")}?replay=1` : null} caminhoLp={null} />;
  }

  // Link de teste sem dados no link: mostra a tela de login (em modo teste) pra preencher nome/telefone e testar os
  // webhooks com dados de verdade. O formulário manda pro `/entrar` com o token; "entrar sem preencher" pula.
  if (decisao === "criar_sessao_teste" && !linkMagicoValido && sp.pular !== "1") {
    const entrar = await caminhoSala(slug, "entrar");
    const utms = utmsDaUrl(sp);
    return (
      <Login
        slug={slug}
        webinarId={sala.webinar.id}
        idioma={idioma}
        tela={sala.telaLogin}
        utms={utms}
        replay={false}
        teste={{ acao: entrar, token: sp.teste, pular: `${entrar}?${new URLSearchParams({ ...utms, teste: sp.teste }).toString()}` }}
      />
    );
  }

  if (decisao === "criar_sessao_magica" || decisao === "criar_sessao_provisoria" || decisao === "criar_sessao_teste") {
    const qs = new URLSearchParams(sp).toString();
    redirect(`${await caminhoSala(slug, "entrar")}${qs ? `?${qs}` : ""}`);
  }

  // decisao === "login"
  return (
    <Login
      slug={slug}
      webinarId={sala.webinar.id}
      idioma={idioma}
      tela={sala.telaLogin}
      utms={utmsDaUrl(sp)}
      replay={replay}
    />
  );
}
