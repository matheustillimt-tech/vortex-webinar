import { VideoOff } from "lucide-react";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import { TelaAviso } from "./_ui/sala-ui";

/** Webinar inexistente, arquivado, ou sem vídeo configurado. */
export default function Indisponivel({ idioma }: { idioma: Idioma }) {
  return <TelaAviso icone={<VideoOff aria-hidden size={28} />} tom="neutro" titulo={t(idioma, "indisponivel")} />;
}
