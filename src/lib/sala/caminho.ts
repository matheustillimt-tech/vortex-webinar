import "server-only";
import { headers } from "next/headers";
import { hostDaRequisicao } from "../regras/rota";
import { caminhoPublico } from "../regras/sala";

/** Hostname configurado em `NEXT_PUBLIC_SALA_URL` (vazio se a variável faltar ou não for uma URL válida). */
function hostSalaConfigurado(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SALA_URL ?? "").hostname;
  } catch {
    return "";
  }
}

/** Caminho público da sala a partir do host da requisição atual: no domínio da sala, `/<slug>/<sufixo>`; em
 *  qualquer outro host (painel, localhost em dev — onde a rota `/s/...` também fica pública), `/s/<slug>/<sufixo>`. */
export async function caminhoSala(slug: string, sufixo = ""): Promise<string> {
  const h = await headers();
  return caminhoPublico(hostDaRequisicao(h), hostSalaConfigurado(), slug, sufixo);
}
