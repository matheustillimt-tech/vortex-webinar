import { redirect } from "next/navigation";
import { destinoProximo } from "@/src/lib/regras/assistente";

/** "Continuar" do assistente: depois de salvar com sucesso, se o formulário mandou `proximo` (o botão Continuar é
 *  `name="proximo" value="/webinars/{id}/{passo}"`), redireciona pra lá. Sem `proximo` (ou com um destino que não é
 *  passo deste webinar), não faz nada e a action devolve o resultado normal. Fica fora dos arquivos "use server"
 *  porque não é uma action. */
export function seguirParaProximo(form: FormData, webinarId: string): void {
  const destino = destinoProximo(form.get("proximo"), webinarId);
  if (destino) redirect(destino);
}
