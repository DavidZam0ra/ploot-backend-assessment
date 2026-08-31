import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { issueToken } from "../src/tokens.js";

// Probabilidades a 0: sin esto los tests de "camino feliz" serían intermitentes (podrían
// caer, por azar, en la rama de 429/5xx que también existe para la demo en vivo).
const config = loadConfig({ MOCK_MAX_LATENCY_MS: "0", MOCK_RATE_LIMIT_PROBABILITY: "0", MOCK_SERVER_ERROR_PROBABILITY: "0" });
const server = createServer(config);
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

function publish(token: string | undefined, force?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (force) headers["x-mock-force"] = force;
  return fetch(`${baseUrl}/provider/publish`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: "hola" }),
  });
}

function refresh(refreshToken: string | undefined, force?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (force) headers["x-mock-force"] = force;
  return fetch(`${baseUrl}/provider/oauth/refresh`, {
    method: "POST",
    headers,
    body: JSON.stringify({ refreshToken }),
  });
}

describe("POST /provider/publish", () => {
  it("token válido -> 200 con externalId", async () => {
    const res = await publish(issueToken("valid"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.externalId).toMatch(/^mock-ext-/);
  });

  it("token expirado -> 401 token_expired", async () => {
    const res = await publish(issueToken("expired"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("token_expired");
  });

  it("token revocado -> 403 token_revoked", async () => {
    const res = await publish(issueToken("revoked"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("token_revoked");
  });

  it("sin Authorization -> 401 invalid_token", async () => {
    const res = await publish(undefined);
    expect(res.status).toBe(401);
  });

  it("formato de token desconocido -> se trata como revocado (falla cerrado)", async () => {
    const res = await publish("no-tiene-el-formato-mock");
    expect(res.status).toBe(403);
  });

  it("X-Mock-Force: rate_limited -> 429 con Retry-After, sin importar el token", async () => {
    const res = await publish(issueToken("valid"), "rate_limited");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe(String(config.retryAfterSeconds));
  });

  it("X-Mock-Force: server_error -> 500, sin importar el token", async () => {
    const res = await publish(issueToken("valid"), "server_error");
    expect(res.status).toBe(500);
  });
});

describe("POST /provider/oauth/refresh", () => {
  it("refresh token válido -> 200 con tokens nuevos", async () => {
    const res = await refresh(issueToken("valid"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toMatch(/^mock_valid_/);
    expect(body.refreshToken).toMatch(/^mock_valid_/);
    expect(body.expiresIn).toBeGreaterThan(0);
  });

  it("refresh token expirado -> se recupera igualmente (el access token es lo que caducó)", async () => {
    const res = await refresh(issueToken("expired"));
    expect(res.status).toBe(200);
  });

  it("refresh token revocado -> 403 irrecuperable", async () => {
    const res = await refresh(issueToken("revoked"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("token_revoked");
  });

  it("X-Mock-Force: token_revoked -> 403, sin importar el refresh token enviado", async () => {
    const res = await refresh(issueToken("valid"), "token_revoked");
    expect(res.status).toBe(403);
  });
});

describe("rutas desconocidas", () => {
  it("404 en cualquier otra ruta", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });
});
