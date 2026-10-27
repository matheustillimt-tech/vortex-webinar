"use client";
import { useRouter } from "next/navigation";
import { Campo, estiloSelect } from "../../_componentes/ui";

/** Escolhe de qual webinar mostrar as integrações (webhooks, WhatsApp, GTM, script e pixels): abre
 *  `/configuracoes/integracoes/{id}`. */
export function SeletorWebinar({ webinars, atual }: { webinars: { id: string; nome: string; arquivado?: boolean }[]; atual?: string }) {
  const router = useRouter();
  return (
    <Campo rotulo="Webinar" className="max-w-md">
      <select
        value={atual ?? ""}
        onChange={(e) => e.target.value && router.push(`/configuracoes/integracoes/${e.target.value}`)}
        className={estiloSelect}
      >
        {!atual && (
          <option value="" disabled>
            Escolha o webinar
          </option>
        )}
        {webinars.map((w) => (
          <option key={w.id} value={w.id}>
            {w.nome}
            {w.arquivado ? " (arquivado)" : ""}
          </option>
        ))}
      </select>
    </Campo>
  );
}
