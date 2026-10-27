"use client";
import { formatarHorarioJit } from "@/src/lib/regras/jit";
import { t, type Idioma } from "@/src/lib/regras/textos-sala";
import { useFusoAplicado } from "./fuso";

/** "segunda-feira, 2 de novembro às 20:00" no fuso da configuração do JIT (ou no do navegador, se "participante"). */
export default function HorarioPorExtenso({ iso, fuso, idioma }: { iso: string; fuso: string; idioma: Idioma }) {
  const aplicado = useFusoAplicado(fuso);
  const { data, hora } = formatarHorarioJit(new Date(iso), aplicado, idioma);
  return <>{t(idioma, "dataHora", { data, hora })}</>;
}
