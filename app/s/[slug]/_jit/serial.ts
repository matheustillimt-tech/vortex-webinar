import type { ConfigJit, HorarioJit } from "@/src/lib/regras/jit";

/** Horários e configuração do JIT em forma serializável (datas em ISO) para os componentes do cliente. */
export type HorarioJitSerial = Omit<HorarioJit, "data"> & { data: string | null };
export type ConfigJitSerial = Omit<ConfigJit, "fim"> & { fim: string | null };

export function serializarHorarios(h: HorarioJit[]): HorarioJitSerial[] {
  return h.map((x) => ({ ...x, data: x.data ? x.data.toISOString() : null }));
}
export function serializarConfig(c: ConfigJit): ConfigJitSerial {
  return { ...c, fim: c.fim ? c.fim.toISOString() : null };
}
export function horariosDeSerial(h: HorarioJitSerial[]): HorarioJit[] {
  return h.map((x) => ({ ...x, data: x.data ? new Date(x.data) : null }));
}
export function configDeSerial(c: ConfigJitSerial): ConfigJit {
  return { ...c, fim: c.fim ? new Date(c.fim) : null };
}
