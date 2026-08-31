import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Todos los tests de integración comparten una única Postgres real y hacen TRUNCATE en su
    // beforeEach: si Vitest los corriera en paralelo (su comportamiento por defecto entre
    // ficheros), el TRUNCATE de un fichero borraría a mitad de camino las filas que otro
    // acaba de insertar.
    fileParallelism: false,
  },
});
