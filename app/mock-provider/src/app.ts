import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { MockConfig } from "./config.js";
import { issueToken, stateOf } from "./tokens.js";

/**
 * Contrato del mock (documentado en README.md de esta carpeta):
 *   POST /provider/publish        Authorization: Bearer <accessToken>   body: { content }
 *   POST /provider/oauth/refresh  body: { refreshToken }
 *
 * El header opcional X-Mock-Force fuerza un desenlace concreto, ignorando el estado del token y
 * los dados de la probabilidad orgánica — es lo que usan los tests para ser deterministas sin
 * tener que fabricar tokens con un formato especial por cada escenario de error.
 */
type ForcedOutcome = "success" | "rate_limited" | "server_error" | "token_expired" | "token_revoked";
const FORCEABLE: ReadonlySet<string> = new Set([
  "success",
  "rate_limited",
  "server_error",
  "token_expired",
  "token_revoked",
]);

function parseForced(req: IncomingMessage): ForcedOutcome | undefined {
  const header = req.headers["x-mock-force"];
  const value = Array.isArray(header) ? header[0] : header;
  return value && FORCEABLE.has(value) ? (value as ForcedOutcome) : undefined;
}

function delay(maxMs: number): Promise<void> {
  const ms = maxMs <= 0 ? 0 : Math.floor(Math.random() * maxMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(payload);
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
}

async function handlePublish(req: IncomingMessage, res: ServerResponse, config: MockConfig): Promise<void> {
  const forced = parseForced(req);
  const token = bearerToken(req);
  await delay(config.maxLatencyMs);

  if (!token) return sendJson(res, 401, { error: "invalid_token" });

  if (forced) {
    if (forced === "rate_limited") {
      return sendJson(res, 429, { error: "rate_limited" }, { "retry-after": String(config.retryAfterSeconds) });
    }
    if (forced === "server_error") return sendJson(res, 500, { error: "server_error" });
    if (forced === "token_expired") return sendJson(res, 401, { error: "token_expired" });
    if (forced === "token_revoked") return sendJson(res, 403, { error: "token_revoked" });
    return sendJson(res, 200, { externalId: `mock-ext-${randomUUID()}` });
  }

  const state = stateOf(token);
  if (state === "expired") return sendJson(res, 401, { error: "token_expired" });
  if (state === "revoked") return sendJson(res, 403, { error: "token_revoked" });

  if (Math.random() < config.rateLimitProbability) {
    return sendJson(res, 429, { error: "rate_limited" }, { "retry-after": String(config.retryAfterSeconds) });
  }
  if (Math.random() < config.serverErrorProbability) {
    return sendJson(res, 500, { error: "server_error" });
  }
  return sendJson(res, 200, { externalId: `mock-ext-${randomUUID()}` });
}

async function handleRefresh(req: IncomingMessage, res: ServerResponse, config: MockConfig): Promise<void> {
  const forced = parseForced(req);
  const body = await readJsonBody(req);
  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : undefined;
  await delay(config.maxLatencyMs);

  if (!refreshToken) return sendJson(res, 401, { error: "invalid_token" });

  if (forced === "server_error") return sendJson(res, 500, { error: "server_error" });
  if (forced === "token_revoked") return sendJson(res, 403, { error: "token_revoked" });
  if (forced === "rate_limited" || forced === "token_expired") {
    // No aplica a refresh en este contrato: un refresh no se "rate-limitea" ni puede devolver un
    // access token ya caducado. Se ignora el force y se sigue la lógica normal.
  } else if (forced === "success") {
    return sendJson(res, 200, {
      accessToken: issueToken("valid"),
      refreshToken: issueToken("valid"),
      expiresIn: 3600,
    });
  }

  // Un refresh token revocado es irrecuperable. Uno expirado o válido puede refrescarse: el
  // proveedor real trata el refresh token con una ventana de vida más larga que el access token.
  if (stateOf(refreshToken) === "revoked") return sendJson(res, 403, { error: "token_revoked" });

  return sendJson(res, 200, {
    accessToken: issueToken("valid"),
    refreshToken: issueToken("valid"),
    expiresIn: 3600,
  });
}

export function createServer(config: MockConfig): Server {
  return createHttpServer((req, res) => {
    const run = async () => {
      if (req.method === "POST" && req.url === "/provider/publish") {
        return handlePublish(req, res, config);
      }
      if (req.method === "POST" && req.url === "/provider/oauth/refresh") {
        return handleRefresh(req, res, config);
      }
      return sendJson(res, 404, { error: "not_found" });
    };
    run().catch((err) => {
      sendJson(res, 500, { error: "internal_error", message: (err as Error).message });
    });
  });
}
