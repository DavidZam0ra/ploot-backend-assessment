import { DateTime } from "luxon";

const LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm:ss";

/**
 * Convierte una hora local "de pared" (sin offset, formato `yyyy-MM-ddTHH:mm:ss`) en una zona
 * horaria dada a un instante UTC absoluto — p. ej. "el Embajador programó esto a las 14:00 hora
 * de Madrid" -> el `scheduled_at` (timestamptz) que se guarda en Postgres. Postgres ya almacena
 * timestamptz como instante absoluto (inmune a DST una vez guardado); el riesgo de DST vive
 * entero en esta conversión de entrada, no en el esquema ni en el scheduler.
 *
 * Dos bordes de DST para Europe/Madrid, verificados en zoned-time.test.ts:
 *  - Hueco del cambio de primavera (una hora que no existe: los relojes saltan de 02:00 a 03:00,
 *    p. ej. 2026-03-29T02:30 nunca ocurrió) -> lanza, en vez de reinterpretar en silencio una
 *    hora distinta de la que pidió el usuario.
 *  - Hora ambigua del cambio de otoño (ocurre dos veces, p. ej. 2026-10-25T02:30) -> se resuelve
 *    a la primera ocurrencia (todavía en horario de verano) — comportamiento por defecto de
 *    luxon/la tzdb de IANA, no algo que decidamos nosotros, documentado aquí para que no sorprenda.
 */
export function zonedTimeToUtc(localDateTime: string, timeZone: string): Date {
  const dt = DateTime.fromISO(localDateTime, { zone: timeZone });
  if (!dt.isValid) {
    throw new Error(`Fecha/hora inválida (${dt.invalidReason}): ${dt.invalidExplanation}`);
  }
  if (dt.toFormat(LOCAL_FORMAT) !== localDateTime) {
    throw new Error(`${localDateTime} no existe en ${timeZone}: cae en el hueco del cambio a horario de verano`);
  }
  return dt.toJSDate();
}

/** Inverso de zonedTimeToUtc — para mostrarle al Embajador su hora local en la UI. */
export function utcToZonedTime(instant: Date, timeZone: string): string {
  return DateTime.fromJSDate(instant, { zone: "utc" }).setZone(timeZone).toFormat(LOCAL_FORMAT);
}
