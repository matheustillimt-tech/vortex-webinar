import { NextResponse, type NextRequest } from "next/server";
import { autenticarSala, respostaErro } from "@/src/lib/sala/api";
import { dbAdmin } from "@/src/lib/supabase/admin";

type AutorMensagem = "participante" | "atendente" | "chatbot" | "ia";

type LinhaMensagem = {
  id: string;
  autor: AutorMensagem;
  autor_id: string | null;
  texto: string | null;
  imagem_url: string | null;
  editada: boolean;
  apagada: boolean;
  created_at: string;
  updated_at: string;
  usuarios: { nome: string } | null;
};

const ISO_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/;


/** Conversa privada da própria sessão (`mensagens_suporte`), pra a sala buscar as respostas por polling (aparecem no chat) — o
 *  participante nunca usa Supabase Realtime (não tem usuário no Auth).
 *  `desde` (ISO) devolve só o que mudou (editado ou criado) depois disso; sem `desde`, a conversa inteira.
 *  Modo teste: lista vazia (não deixa rastro). Sem sessão válida: 401. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const auth = await autenticarSala(q.get("w"));
  if ("erro" in auth) return auth.erro;

  // `desde` vai pro filtro como veio (o `atualizadaEm` que a própria API devolveu, com os microssegundos do
  // Postgres): passar por `Date` cortaria pra milissegundos e a mesma mensagem voltaria em toda busca. Só confere
  // que é um instante ISO de verdade.
  const desde = q.get("desde");
  if (desde && (!ISO_INSTANTE.test(desde) || Number.isNaN(Date.parse(desde)))) return respostaErro("Parâmetros inválidos.", 400);

  if (auth.sessao.modo === "teste") return NextResponse.json({ mensagens: [] });

  const db = dbAdmin();
  let query = db
    .from("mensagens_suporte")
    .select("id, autor, autor_id, texto, imagem_url, editada, apagada, created_at, updated_at, usuarios(nome)")
    .eq("sessao_id", auth.sessao.sessaoId)
    .order("created_at", { ascending: true });
  if (desde) query = query.gt("updated_at", desde);

  const { data, error } = await query;
  if (error) return respostaErro("Não deu para carregar a conversa.", 500);

  const linhas = (data ?? []) as unknown as LinhaMensagem[];

  // Nomes de exibição: IA e equipe humana saem com o mesmo nome, o configurado no agente do webinar (ex.: "Equipe
  // Sua Empresa") — pra pessoa, quem responde é sempre "a equipe". Só consulta se aparece IA ou atendente nesta
  // página, pra não pesar o polling. Sem agente com nome, o atendente cai no próprio nome. Respostas antigas do
  // chatbot (descontinuado) ficam sem nome: a sala mostra "Suporte".
  const temResposta = linhas.some((l) => l.autor === "ia" || l.autor === "atendente");
  const { data: agenteIa } = temResposta
    ? await db.from("agentes_ia").select("nome").eq("webinar_id", auth.sessao.webinarId).maybeSingle()
    : { data: null };
  const nomeEquipe = (agenteIa as { nome: string | null } | null)?.nome?.trim() || null;

  function nomeAutor(l: LinhaMensagem): string | null {
    if (l.autor === "atendente") return nomeEquipe ?? l.usuarios?.nome ?? null;
    if (l.autor === "ia") return nomeEquipe;
    return null;
  }

  return NextResponse.json({
    mensagens: linhas.map((l) => ({
      id: l.id,
      autor: l.autor,
      texto: l.apagada ? null : l.texto,
      imagemUrl: l.apagada ? null : l.imagem_url,
      nomeAutor: nomeAutor(l),
      editada: l.editada,
      apagada: l.apagada,
      criadaEm: l.created_at,
      atualizadaEm: l.updated_at,
    })),
  });
}
