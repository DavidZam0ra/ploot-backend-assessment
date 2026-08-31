import { describe, expect, it } from "vitest";
import { utcToZonedTime, zonedTimeToUtc } from "../src/time/zoned-time.js";

const MADRID = "Europe/Madrid";

describe("zonedTimeToUtc — Europe/Madrid", () => {
  it("invierno (CET, UTC+1): resta una hora", () => {
    expect(zonedTimeToUtc("2026-01-15T10:00:00", MADRID).toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("verano (CEST, UTC+2): resta dos horas", () => {
    expect(zonedTimeToUtc("2026-07-15T10:00:00", MADRID).toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });

  it("justo antes del cambio de primavera (todavía CET)", () => {
    // 2026-03-29 es el domingo del cambio: a la 01:00 UTC los relojes de Madrid saltan de 02:00 a 03:00.
    expect(zonedTimeToUtc("2026-03-29T01:30:00", MADRID).toISOString()).toBe("2026-03-29T00:30:00.000Z");
  });

  it("justo después del cambio de primavera (ya CEST)", () => {
    expect(zonedTimeToUtc("2026-03-29T03:30:00", MADRID).toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("la hora que no existe (02:30, dentro del hueco del cambio de primavera) se rechaza", () => {
    expect(() => zonedTimeToUtc("2026-03-29T02:30:00", MADRID)).toThrow(/no existe/);
  });

  it("hora ambigua del cambio de otoño: se resuelve a la primera ocurrencia (todavía verano)", () => {
    // 2026-10-25: a la 01:00 UTC los relojes caen de 03:00 CEST a 02:00 CET — 02:00-03:00 ocurre dos veces.
    expect(zonedTimeToUtc("2026-10-25T02:30:00", MADRID).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("una hora antes y una hora después del cambio de otoño siguen siendo instantes UTC distintos y en orden", () => {
    const before = zonedTimeToUtc("2026-10-25T02:00:00", MADRID); // interpretado como CEST (primera ocurrencia)
    const after = zonedTimeToUtc("2026-10-25T04:00:00", MADRID); // ya inequívocamente CET
    // En reloj de pared parecen "2 horas" de diferencia, pero de verdad son 3 horas de UTC real
    // porque el cambio de horario resta una hora al medio — la ordenación absoluta es la que
    // importa para el scheduler, no la resta ingenua de las horas locales.
    expect(after.getTime() - before.getTime()).toBe(3 * 60 * 60 * 1000);
  });

  it("rechaza una fecha/hora con formato inválido", () => {
    expect(() => zonedTimeToUtc("no-es-una-fecha", MADRID)).toThrow();
  });
});

describe("utcToZonedTime — round-trip con zonedTimeToUtc a través de ambos cambios de hora", () => {
  const cases = [
    "2026-01-15T10:00:00",
    "2026-07-15T10:00:00",
    "2026-03-29T01:30:00",
    "2026-03-29T03:30:00",
  ];

  it.each(cases)("%s sobrevive el viaje de ida y vuelta", (local) => {
    const utc = zonedTimeToUtc(local, MADRID);
    expect(utcToZonedTime(utc, MADRID)).toBe(local);
  });
});
