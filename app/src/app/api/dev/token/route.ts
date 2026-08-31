import { NextRequest, NextResponse } from "next/server";
import { signTestToken } from "../../../../auth/jwt";

/**
 * Solo para la UI de demostración (ver HANDOFF.md) — firma un JWT de prueba a partir de un
 * tenantId/profileId que YA existen (p.ej. los que imprime worker/scripts/seed.ts). No forma
 * parte del contrato v1 de la API: en un despliegue real esto lo haría un IdP, nunca un endpoint
 * propio que firma lo que le pidas sin autenticarte primero.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.tenantId !== "string" || typeof body.profileId !== "string") {
    return NextResponse.json({ error: "invalid_body", message: "tenantId y profileId son obligatorios" }, { status: 400 });
  }
  const token = await signTestToken({ tenantId: body.tenantId, profileId: body.profileId });
  return NextResponse.json({ token });
}
