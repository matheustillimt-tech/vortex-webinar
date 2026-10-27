import "server-only";

export type VarObrigatoria =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "CRYPTO_KEY"
  | "SALA_TOKEN_SECRET"
  | "CRON_SECRET"
  | "NEXT_PUBLIC_PAINEL_URL"
  | "NEXT_PUBLIC_SALA_URL";

export function envOpcional(nome: string): string | undefined {
  const v = process.env[nome];
  return v ? v : undefined;
}

export function env(nome: VarObrigatoria): string {
  const v = envOpcional(nome);
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

/** Bunny Stream configurado? Sem as três variáveis, o envio de vídeo fica desligado. */
export function bunnyConfig(): { libraryId: string; apiKey: string; cdnHost: string } | null {
  const libraryId = envOpcional("BUNNY_STREAM_LIBRARY_ID");
  const apiKey = envOpcional("BUNNY_STREAM_API_KEY");
  const cdnHost = envOpcional("BUNNY_STREAM_CDN_HOST");
  return libraryId && apiKey && cdnHost ? { libraryId, apiKey, cdnHost } : null;
}

/** IA configurada? Sem `OPENROUTER_API_KEY` + `OPENROUTER_TEXT_MODEL` (um modelo ou vários separados por vírgula: o
 *  primeiro é o principal, os outros reserva), geração de chat e agente ficam desligados
 *  (devolve `null`). `elevenlabsKey` é separado: sem ela, só a transcrição (passo da geração de chat) não funciona;
 *  o agente não precisa dela. */
export function iaConfig(): { openrouterKey: string; modelo: string; elevenlabsKey: string | null } | null {
  const openrouterKey = envOpcional("OPENROUTER_API_KEY");
  const modelo = envOpcional("OPENROUTER_TEXT_MODEL");
  if (!openrouterKey || !modelo) return null;
  return { openrouterKey, modelo, elevenlabsKey: envOpcional("ELEVENLABS_API_KEY") ?? null };
}

/** E-mail (Resend) configurado? Sem `RESEND_API_KEY` + `EMAIL_FROM`, os e-mails do just in time ficam desligados
 *  (devolve `null`): o painel avisa e o cron só expira os vencidos. `de` é o endereço do remetente (pode vir como
 *  `Nome <email>`; o nome de cada e-mail vem do modelo, ver `remetenteEmail`). */
export function emailConfig(): { resendKey: string; de: string } | null {
  const resendKey = envOpcional("RESEND_API_KEY");
  const de = envOpcional("EMAIL_FROM");
  return resendKey && de ? { resendKey, de } : null;
}
