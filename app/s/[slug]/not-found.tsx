import { SearchX } from "lucide-react";
import { t } from "@/src/lib/regras/textos-sala";
import { TelaAviso } from "./_ui/sala-ui";

/** `notFound()` dentro de uma sala. O idioma do webinar não chega aqui, então fica no pt-BR. */
export default function NaoEncontradoSala() {
  return <TelaAviso icone={<SearchX aria-hidden size={28} />} tom="neutro" titulo={t("pt-BR", "paginaNaoEncontrada")} />;
}
