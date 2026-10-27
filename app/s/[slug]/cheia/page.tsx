import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { slugValido } from "@/src/lib/regras/sala";
import { t } from "@/src/lib/regras/textos-sala";
import { carregarSalaCached as carregarSala, salaCheia } from "@/src/lib/sala/dados";
import { caminhoSala } from "@/src/lib/sala/caminho";
import { lerSessaoDoCookie } from "@/src/lib/sala/sessao";
import Indisponivel from "../indisponivel";
import Tentar from "./tentar";
import { TelaAviso } from "../_ui/sala-ui";

export default async function Cheia({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugValido(slug)) return <Indisponivel idioma="pt-BR" />;

  const sala = await carregarSala(slug);
  if (!sala) redirect(await caminhoSala(slug));

  const sessao = await lerSessaoDoCookie(sala.webinar.id);
  if (sessao) redirect(await caminhoSala(slug, "sala"));

  const cheia = await salaCheia(sala.webinar.id, sala.webinar.limiteSimultaneo, new Date());
  // Vagou entre a entrada e aqui: a raiz da sala decide de novo (pode voltar pra cá, mas sem loop de verdade).
  if (!cheia) redirect(await caminhoSala(slug));

  const idioma = sala.webinar.idioma;

  return (
    <TelaAviso icone={<Users aria-hidden size={28} />} titulo={t(idioma, "cheiaTitulo")} texto={t(idioma, "cheiaTexto")}>
      <span className="inline-flex items-center gap-2 text-sm text-texto-4" aria-hidden>
        <span className="h-2 w-2 animate-pulse rounded-full bg-marca" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-marca [animation-delay:200ms]" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-marca [animation-delay:400ms]" />
      </span>
      <Tentar />
    </TelaAviso>
  );
}
