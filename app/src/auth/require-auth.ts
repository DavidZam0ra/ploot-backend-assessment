import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken, type AuthClaims } from "./jwt";

/** Devuelve los claims si el JWT es válido, o directamente la NextResponse 401 a devolver si no. */
export async function requireAuth(req: NextRequest): Promise<AuthClaims | NextResponse> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized", message: "Falta el header Authorization: Bearer <token>" }, { status: 401 });
  }
  try {
    return await verifyAuthToken(header.slice("Bearer ".length));
  } catch {
    return NextResponse.json({ error: "unauthorized", message: "Token inválido o expirado" }, { status: 401 });
  }
}

export function isAuthResponse(value: AuthClaims | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
