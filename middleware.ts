import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decidirRota, hostDaRequisicao } from "@/src/lib/regras/rota";

function hostSala(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SALA_URL ?? "").hostname;
  } catch {
    return "";
  }
}

export async function middleware(req: NextRequest) {
  const destino = decidirRota(hostDaRequisicao(req.headers), req.nextUrl.pathname, { hostSala: hostSala() });
  if (destino.tipo === "sala") {
    const url = req.nextUrl.clone();
    url.pathname = destino.caminho;
    return NextResponse.rewrite(url);
  }
  if (destino.tipo === "redirecionar_sala") {
    // Mesmo caminho (sem o /s) e a mesma query (UTMs, link mágico, token de teste) no domínio da sala.
    const url = new URL(destino.caminho, process.env.NEXT_PUBLIC_SALA_URL);
    url.search = req.nextUrl.search;
    return NextResponse.redirect(url, 307);
  }
  if (destino.tipo === "publica") return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (lista) => {
        lista.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        lista.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await db.auth.getUser();
  if (!data.user) {
    if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
