import { NextResponse } from "next/server";
import { gerarXlsx } from "@/src/lib/planilha";
import { vendasParaLinhas } from "@/src/lib/regras/planilha";
import { lerTudo } from "@/src/lib/supabase/paginar";
import { dbUsuario, membroApi } from "@/src/lib/supabase/usuario";

const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MODELO = vendasParaLinhas([
  { segundo: 30, texto: "Ana acabou de comprar!" },
  { segundo: 90, texto: "Bruno garantiu a vaga!" },
]);

/** `GET`: exige admin (401 sem admin). Com `?modelo=1`, devolve só o cabeçalho + 2 linhas de exemplo; sem o
 *  parâmetro, exporta as vendas já cadastradas do webinar, ordenadas por segundo. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membro = await membroApi();
  if (!membro || membro.papel !== "admin") return NextResponse.json({ erro: "Só administradores podem fazer isso." }, { status: 401 });

  const { id } = await params;
  const db = await dbUsuario();
  const { data: webinar } = await db.from("webinars").select("slug").eq("id", id).maybeSingle();
  if (!webinar) return NextResponse.json({ erro: "Webinar não encontrado." }, { status: 404 });
  const slug = (webinar as { slug: string }).slug;

  const url = new URL(req.url);
  let linhas: unknown[][];
  if (url.searchParams.get("modelo") === "1") {
    linhas = MODELO;
  } else {
    const { data, error } = await lerTudo(() =>
      db
        .from("vendas_simuladas")
        .select("segundo, texto, id")
        .eq("webinar_id", id)
        .order("segundo", { ascending: true })
        .order("id", { ascending: true }),
    );
    // Falhou no meio da paginação: não gera um arquivo parcial (quem exporta não teria como notar).
    if (error) return NextResponse.json({ erro: "Não deu para gerar a planilha. Tente de novo." }, { status: 500 });
    linhas = vendasParaLinhas(data as { segundo: number; texto: string }[]);
  }

  const buf = new Uint8Array(await gerarXlsx(linhas));
  return new NextResponse(buf, {
    headers: {
      "content-type": CONTENT_TYPE,
      "content-disposition": `attachment; filename="vendas-${slug}.xlsx"`,
    },
  });
}
