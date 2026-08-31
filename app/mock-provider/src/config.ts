/**
 * Probabilidades de fallo "orgánico" (sin forzar nada por header) para que la demo en vivo
 * muestre de verdad 429 y 5xx sin que cada test tenga que tolerar aleatoriedad: los tests fijan
 * ambas a 0 vía env y usan el header X-Mock-Force para casos deterministas.
 */
export interface MockConfig {
  port: number;
  maxLatencyMs: number;
  rateLimitProbability: number;
  serverErrorProbability: number;
  retryAfterSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MockConfig {
  return {
    port: Number(env.PORT ?? 4000),
    maxLatencyMs: Number(env.MOCK_MAX_LATENCY_MS ?? 3000),
    rateLimitProbability: Number(env.MOCK_RATE_LIMIT_PROBABILITY ?? 0.1),
    serverErrorProbability: Number(env.MOCK_SERVER_ERROR_PROBABILITY ?? 0.05),
    retryAfterSeconds: Number(env.MOCK_RETRY_AFTER_SECONDS ?? 5),
  };
}
