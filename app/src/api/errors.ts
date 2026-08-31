import { NextResponse } from "next/server";
import { PostNotEditableError, PostNotFoundError } from "@ploot/core";

/** Traduce los errores tipados del dominio a la respuesta HTTP que le corresponde; relanza lo que no reconoce. */
export function handleDomainError(err: unknown): NextResponse {
  if (err instanceof PostNotFoundError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: 404 });
  }
  if (err instanceof PostNotEditableError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: 409 });
  }
  throw err;
}
