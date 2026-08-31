import { NextRequest, NextResponse } from "next/server";
import { isAuthResponse, requireAuth } from "../../../../../../auth/require-auth";
import { getIdempotencyStore, getPostRepository } from "../../../../../../db/repositories";
import { handleDomainError } from "../../../../../../api/errors";

interface PublishResult {
  postId: string;
  status: string;
}

/**
 * "Publicación inmediata" no llama al proveedor aquí — eso violaría el requisito de que el
 * proveedor solo se llama desde el worker, nunca desde el ciclo de request de Next.js (timeouts,
 * cold starts, N instancias abriendo conexiones). Esto solo adelanta scheduled_at a ahora mismo;
 * el worker lo reclama en su siguiente ciclo de polling, igual que cualquier otro post vencido.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (isAuthResponse(auth)) return auth;

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json({ error: "missing_idempotency_key", message: "Falta el header Idempotency-Key" }, { status: 400 });
  }

  const idempotency = getIdempotencyStore();
  const reservation = await idempotency.reserve<PublishResult>(auth.tenantId, idempotencyKey);
  if (!reservation.isNew) {
    if (reservation.existingResult) return NextResponse.json(reservation.existingResult, { status: 200 });
    return NextResponse.json({ error: "in_progress", message: "Ya hay una request con esta Idempotency-Key en curso" }, { status: 409 });
  }

  try {
    const post = await getPostRepository().update(auth.tenantId, params.id, { scheduledAt: new Date() });
    const result: PublishResult = { postId: post.id, status: post.status };
    await idempotency.complete(auth.tenantId, idempotencyKey, result);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return handleDomainError(err);
  }
}
