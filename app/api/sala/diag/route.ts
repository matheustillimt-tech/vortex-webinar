import { cookies } from "next/headers";

const TAMANHO_MAXIMO = 20_000;

/** Recebe os eventos do modo diagnóstico da sala (`?diag=1`, ver `Diagnostico.tsx`) e só escreve no log da Vercel
 *  (`[diag]`), junto com quais cookies da sala chegaram (só o nome e se tem valor — nunca o valor). Não grava nada no
 *  banco. */
export async function POST(req: Request) {
  const texto = (await req.text()).slice(0, TAMANHO_MAXIMO);
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return new Response(null, { status: 400 });
  }
  const jar = await cookies();
  const cookiesSala = jar
    .getAll()
    .filter((c) => c.name.startsWith("vw_"))
    .map((c) => `${c.name.slice(0, 12)}${c.value ? "" : "(vazio)"}`);
  console.log(`[diag] ${JSON.stringify({ ...(corpo as object), cookiesSala })}`);
  return new Response(null, { status: 204 });
}
