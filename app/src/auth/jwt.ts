import { jwtVerify, SignJWT } from "jose";

export interface AuthClaims {
  tenantId: string;
  profileId: string;
}

/**
 * Sin IdP: JWTs de prueba firmados por nosotros mismos (HS256, secreto compartido). En
 * producción esto sería un problema distinto (rotación de claves, un IdP de verdad); aquí basta
 * para demostrar que el aislamiento de tenant viene del claim del JWT, no de algo que el cliente
 * pueda elegir en el body de la request.
 */
function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET no está configurada");
  return new TextEncoder().encode(secret);
}

export async function verifyAuthToken(token: string): Promise<AuthClaims> {
  const { payload } = await jwtVerify(token, getSecret());
  const tenantId = payload.tenant_id;
  const profileId = payload.profile_id;
  if (typeof tenantId !== "string" || typeof profileId !== "string") {
    throw new Error("El token no lleva tenant_id/profile_id");
  }
  return { tenantId, profileId };
}

/** Solo para generar tokens de prueba (scripts, tests) — nunca se usa en el camino de request real. */
export async function signTestToken(claims: AuthClaims, expiresIn = "2h"): Promise<string> {
  return new SignJWT({ tenant_id: claims.tenantId, profile_id: claims.profileId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret());
}
