import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Telefone digitado → E.164 (`+5511987654321`), ou null se não for um número válido. */
export function paraE164(telefone: string, pais: CountryCode = "BR"): string | null {
  const t = telefone.trim();
  if (!t) return null;
  const n = parsePhoneNumberFromString(t, pais);
  return n && n.isValid() ? n.number : null;
}

/** E.164 → como a gente lê: Brasil sem o +55 (`(11) 90000-1234`), fora do Brasil no formato internacional
 *  (`+1 415 555 2671`). Inválido: devolve como veio. */
export function telefoneLegivel(e164: string): string {
  const n = parsePhoneNumberFromString(e164);
  if (!n) return e164;
  return n.country === "BR" ? n.formatNational() : n.formatInternational();
}
