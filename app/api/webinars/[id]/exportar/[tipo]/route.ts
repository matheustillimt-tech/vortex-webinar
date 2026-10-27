import { NextResponse } from "next/server";
import { gerarXlsx } from "@/src/lib/planilha";
import {
  COLUNA_VALOR_VENDAS_EXPORT,
  conversasParaLinhas,
  eventosDoParametro,
  FORMATO_VALOR_VENDAS_EXPORT,
  momentoParaLinhas,
  nomeArquivoExportacao,
  participantesParaLinhas,
  vendasExportParaLinhas,
  type MensagemExport,
  type SessaoExport,
  type VendaExport,
} from "@/src/lib/regras/exportar";
import { periodoDe } from "@/src/lib/regras/metricas";
import { lerTudo } from "@/src/lib/supabase/paginar";
import { dbUsuario, membroApi } from "@/src/lib/supabase/usuario";

const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TIPOS = ["participantes", "momento", "conversas", "vendas"] as const;
type Tipo = (typeof TIPOS)[number];

function tipoValido(v: string): v is Tipo {
  return (TIPOS as readonly string[]).includes(v);
}

function erro(status: number, msg: string) {
  return NextResponse.json({ erro: msg }, { status });
}

type LinhaSessaoBanco = {
  entrou_em: string;
  modo: string;
  max_segundo: number | null;
  pais: string | null;
  cidade: string | null;
  dispositivo: string | null;
  utms: Record<string, string> | null;
  participantes: { nome: string; email: string | null; telefone_e164: string | null } | null;
  eventos: { tipo: string }[] | null;
};

type LinhaMensagemBanco = {
  created_at: string;
  autor: "participante" | "atendente" | "chatbot" | "ia";
  texto: string | null;
  imagem_url: string | null;
  apagada: boolean;
  usuarios: { nome: string } | null;
  sessoes: { participantes: { nome: string; email: string | null } | null } | null;
};

type LinhaVendaBanco = {
  created_at: string;
  plataforma: string;
  id_transacao: string;
  valor_centavos: number;
  comprador_email: string | null;
  sessao_id: string | null;
};

/** `GET /api/webinars/[id]/exportar/[tipo]?de&ate[&eventos=a,b]` (admin; 401 JSON sem admin). Lê sempre com
 *  `lerTudo` (sessões/eventos/mensagens/vendas podem passar do teto de 1000 linhas do PostgREST)
 *  e nunca gera arquivo parcial: um erro no meio da paginação devolve 500 em vez do .xlsx. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; tipo: string }> }) {
  const membro = await membroApi();
  if (!membro) return erro(401, "Faça login para fazer isso.");
  if (membro.papel !== "admin") return erro(403, "Só administradores podem fazer isso.");

  const { id, tipo } = await params;
  if (!tipoValido(tipo)) return erro(400, "Tipo de exportação inválido.");

  const sp = new URL(req.url).searchParams;
  const periodo = periodoDe(sp, "7d");
  if ("erro" in periodo) return erro(400, periodo.erro);
  const { de, ate } = periodo;

  let tiposEventos: string[] = [];
  if (tipo === "momento") {
    const r = eventosDoParametro(sp.get("eventos"));
    if (r === null || r.length === 0) return erro(400, "Informe de 1 a 2 eventos válidos.");
    tiposEventos = r;
  }

  const db = await dbUsuario();
  const { data: webinar } = await db.from("webinars").select("slug").eq("id", id).maybeSingle();
  if (!webinar) return erro(404, "Webinar não encontrado.");
  const slug = (webinar as { slug: string }).slug;

  let linhas: unknown[][];

  if (tipo === "participantes" || tipo === "momento") {
    const { data, error } = await lerTudo(() =>
      db
        .from("sessoes")
        .select(
          "id, entrou_em, modo, max_segundo, pais, cidade, dispositivo, utms, participantes(nome, email, telefone_e164), eventos(tipo)",
        )
        .eq("webinar_id", id)
        .neq("modo", "teste")
        .gte("entrou_em", de.toISOString())
        .lt("entrou_em", ate.toISOString())
        .order("id", { ascending: true }),
    );
    if (error) return erro(500, "Não deu para gerar a planilha. Tente de novo.");

    const sessoes: SessaoExport[] = (data as unknown as LinhaSessaoBanco[]).map((s) => ({
      nome: s.participantes?.nome ?? "",
      email: s.participantes?.email ?? null,
      telefoneE164: s.participantes?.telefone_e164 ?? null,
      entrouEm: s.entrou_em,
      modo: s.modo,
      maxSegundo: s.max_segundo,
      pais: s.pais,
      cidade: s.cidade,
      dispositivo: s.dispositivo,
      utms: s.utms ?? {},
      eventos: (s.eventos ?? []).map((e) => e.tipo),
    }));

    linhas = tipo === "momento" ? momentoParaLinhas(sessoes, tiposEventos) : participantesParaLinhas(sessoes);
  } else if (tipo === "conversas") {
    const { data, error } = await lerTudo(() =>
      db
        .from("mensagens_suporte")
        .select("id, created_at, autor, texto, imagem_url, apagada, usuarios(nome), sessoes!inner(modo, participantes(nome, email))")
        .eq("webinar_id", id)
        .neq("sessoes.modo", "teste")
        .gte("created_at", de.toISOString())
        .lt("created_at", ate.toISOString())
        .order("id", { ascending: true }),
    );
    if (error) return erro(500, "Não deu para gerar a planilha. Tente de novo.");

    const mensagens: MensagemExport[] = (data as unknown as LinhaMensagemBanco[]).map((m) => ({
      participanteNome: m.sessoes?.participantes?.nome ?? "",
      participanteEmail: m.sessoes?.participantes?.email ?? null,
      criadaEm: m.created_at,
      autor: m.autor,
      autorNome: m.usuarios?.nome ?? null,
      texto: m.texto,
      imagemUrl: m.imagem_url,
      apagada: m.apagada,
    }));
    linhas = conversasParaLinhas(mensagens);
  } else {
    const { data, error } = await lerTudo(() =>
      db
        .from("vendas")
        .select("id, created_at, plataforma, id_transacao, valor_centavos, comprador_email, sessao_id")
        .eq("webinar_id", id)
        .gte("created_at", de.toISOString())
        .lt("created_at", ate.toISOString())
        .order("id", { ascending: true }),
    );
    if (error) return erro(500, "Não deu para gerar a planilha. Tente de novo.");

    const vendas: VendaExport[] = (data as unknown as LinhaVendaBanco[]).map((v) => ({
      criadaEm: v.created_at,
      plataforma: v.plataforma,
      idTransacao: v.id_transacao,
      valorCentavos: v.valor_centavos,
      compradorEmail: v.comprador_email,
      sessaoId: v.sessao_id,
    }));
    linhas = vendasExportParaLinhas(vendas);
  }

  const formatosColuna = tipo === "vendas" ? { [COLUNA_VALOR_VENDAS_EXPORT]: FORMATO_VALOR_VENDAS_EXPORT } : undefined;
  const buf = new Uint8Array(await gerarXlsx(linhas, formatosColuna));
  return new NextResponse(buf, {
    headers: {
      "content-type": CONTENT_TYPE,
      "content-disposition": `attachment; filename="${nomeArquivoExportacao(tipo, slug, new Date())}"`,
    },
  });
}
