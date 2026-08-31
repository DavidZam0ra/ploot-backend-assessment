import { randomUUID } from "node:crypto";

export type TokenState = "valid" | "expired" | "revoked";

/**
 * No hay IdP real: el estado del token vive codificado en el propio string
 * (`mock_<state>_<opaco>`) para que el seed de datos pueda fijar deliberadamente el escenario
 * (token válido / expirado / revocado) sin necesitar un store de estado aparte en el mock.
 * Cualquier formato que no reconozcamos se trata como revocado — fallar cerrado, no abierto.
 */
const TOKEN_PATTERN = /^mock_(valid|expired|revoked)_/;

export function stateOf(token: string): TokenState {
  const match = TOKEN_PATTERN.exec(token);
  return match ? (match[1] as TokenState) : "revoked";
}

export function issueToken(state: TokenState): string {
  return `mock_${state}_${randomUUID()}`;
}
