import { SearchX } from "lucide-react";
import { t } from "@/src/lib/regras/textos-sala";
import { TelaAviso } from "./[slug]/_ui/sala-ui";

/** Raiz do domínio da sala, sem slug. */
export default function RaizSala() {
  return (
    <div lang="pt-BR" className="min-h-dvh bg-[#F9F9F9] font-sans text-base text-texto">
      <TelaAviso icone={<SearchX aria-hidden size={28} />} tom="neutro" titulo={t("pt-BR", "indisponivel")} />
    </div>
  );
}
