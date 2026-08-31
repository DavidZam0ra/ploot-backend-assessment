import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer, issueToken, loadConfig } from "@ploot/mock-provider";
import { ProviderRateLimitedError, ProviderServerError, TokenExpiredError, TokenRevokedError } from "@ploot/core";
import { HttpProviderAdapter } from "../src/adapters/http-provider-adapter.js";

// Sin latencia ni fallos orgánicos: los tests fuerzan cada rama con X-Mock-Force via fetchWithForce.
const config = loadConfig({ MOCK_MAX_LATENCY_MS: "0", MOCK_RATE_LIMIT_PROBABILITY: "0", MOCK_SERVER_ERROR_PROBABILITY: "0" });
const server = createServer(config);
let baseUrl: string;
let adapter: HttpProviderAdapter;

function fetchWithForce(force?: string): typeof fetch {
  return (input, init) =>
    fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), ...(force ? { "x-mock-force": force } : {}) } });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  adapter = new HttpProviderAdapter(baseUrl);
});

afterAll(() => {
  server.close();
});

describe("HttpProviderAdapter.publish", () => {
  it("200 -> PublishResult con externalId", async () => {
    const result = await adapter.publish("profile-1", issueToken("valid"), "hola mundo");
    expect(result.externalId).toMatch(/^mock-ext-/);
  });

  it("token expirado (401) -> TokenExpiredError con el profileId del llamador", async () => {
    await expect(adapter.publish("profile-1", issueToken("expired"), "x")).rejects.toThrow(TokenExpiredError);
  });

  it("token revocado (403) -> TokenRevokedError con el profileId del llamador", async () => {
    await expect(adapter.publish("profile-1", issueToken("revoked"), "x")).rejects.toThrow(TokenRevokedError);
  });

  it("429 -> ProviderRateLimitedError con retryAfterMs desde el header Retry-After", async () => {
    const forced = new HttpProviderAdapter(baseUrl, fetchWithForce("rate_limited"));
    try {
      await forced.publish("profile-1", issueToken("valid"), "x");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderRateLimitedError);
      expect((err as InstanceType<typeof ProviderRateLimitedError>).retryAfterMs).toBe(config.retryAfterSeconds * 1000);
    }
  });

  it("5xx -> ProviderServerError", async () => {
    const forced = new HttpProviderAdapter(baseUrl, fetchWithForce("server_error"));
    await expect(forced.publish("profile-1", issueToken("valid"), "x")).rejects.toThrow(ProviderServerError);
  });
});

describe("HttpProviderAdapter.refresh", () => {
  it("200 -> RefreshedToken con expiresAt en el futuro", async () => {
    const before = Date.now();
    const result = await adapter.refresh("profile-1", issueToken("valid"));
    expect(result.accessToken).toMatch(/^mock_valid_/);
    expect(result.expiresAt.getTime()).toBeGreaterThan(before);
  });

  it("refresh token revocado -> TokenRevokedError", async () => {
    await expect(adapter.refresh("profile-1", issueToken("revoked"))).rejects.toThrow(TokenRevokedError);
  });
});
