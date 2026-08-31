/**
 * Indirección sobre Date.now() para poder inyectar tiempos concretos en los tests de DST
 * (Europe/Madrid) y de reclamos obsoletos sin esperar de verdad.
 */
export interface ClockPort {
  now(): Date;
}
