import { NextResponse, type NextRequest } from "next/server";
import { autenticarSala, respostaErro } from "@/src/lib/sala/api";
import { trocarNome } from "@/src/lib/regras/nomes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { lerTudo } from "@/src/lib/supabase/paginar";
import { cacheCurto } from "@/src/lib/cache-curto";

const JANELA_MAXIMA_SEG = 600;

type LinhaMensagem = { segundo: number; nome: string; texto: string; suporte: boolean };
type LinhaVenda = { segundo: number; texto: string };

type JanelaBruta = { mensagens: LinhaMensagem[]; vendas: LinhaVenda[]; completa: boolean };

/** A janela crua (antes de trocar o `#nome`) é a mesma pra todo mundo do webinar: cada instância guarda 15 s por
 *  `webinar:de:ate` (ver `cacheCurto`). Uma edição do chat simulado no painel leva até 15 s pra chegar na sala.
 *  Resultado com erro de consulta não fica no cache. */
const janelaDoBanco = cacheCurto<JanelaBruta>(
  async (chave) => {
    const [webinarId, deTxt, ateTxt] = chave.split(":");
    const de = Number(deTxt);
    const ate = Number(ateTxt);
    const db = dbAdmin();
    const [mensagens, vendas] = await Promise.all([
      lerTudo<LinhaMensagem>(() => {
        const q = db.from("mensagens_simuladas").select("segundo, nome, texto, suporte").eq("webinar_id", webinarId);
        // `de === 0`: inclui o segundo 0 (a janela seguinte começa em `> ate`, então nada se repete).
        return (de === 0 ? q.gte("segundo", 0) : q.gt("segundo", de)).lte("segundo", ate).order("segundo").order("id");
      }),
      lerTudo<LinhaVenda>(() => {
        const q = db.from("vendas_simuladas").select("segundo, texto").eq("webinar_id", webinarId);
        return (de === 0 ? q.gte("segundo", 0) : q.gt("segundo", de)).lte("segundo", ate).order("segundo").order("id");
      }),
    ]);
    return { mensagens: mensagens.data ?? [], vendas: vendas.data ?? [], completa: !mensagens.error && !vendas.error };
  },
  { ttlMs: 15_000, guardar: (j) => j.completa },
);


function inteiroNaoNegativo(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Mensagens e vendas simuladas da janela `(de, ate]` (ou `[0, ate]` quando `de === 0`, pra não perder o que foi
 *  marcado no segundo 0), com os placeholders de nome (`#nome` etc.) já trocados
 *  pelo nome de quem está vendo (a sessão do cookie), nunca o texto cru guardado no banco. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const auth = await autenticarSala(q.get("w"));
  if ("erro" in auth) return auth.erro;

  const de = inteiroNaoNegativo(q.get("de"));
  const ate = inteiroNaoNegativo(q.get("ate"));
  if (de === null || ate === null || ate <= de || ate - de > JANELA_MAXIMA_SEG) {
    return respostaErro("Janela inválida.", 400);
  }

  const { mensagens, vendas } = await janelaDoBanco(`${auth.sessao.webinarId}:${de}:${ate}`);

  return NextResponse.json({
    mensagens: (mensagens ?? []).map((m) => ({
      segundo: m.segundo,
      nome: m.nome,
      texto: trocarNome(m.texto, auth.sessao.participanteNome),
      suporte: m.suporte,
    })),
    vendas: (vendas ?? []).map((v) => ({ segundo: v.segundo, texto: v.texto })),
  });
}
