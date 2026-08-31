import { NextRequest, NextResponse } from "next/server";
import { isAuthResponse, requireAuth } from "../../../../../auth/require-auth";
import { getPostRepository } from "../../../../../db/repositories";
import { handleDomainError } from "../../../../../api/errors";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (isAuthResponse(auth)) return auth;

  const body = await req.json().catch(() => null);
  if (!body || (body.content === undefined && body.scheduledAt === undefined)) {
    return NextResponse.json({ error: "invalid_body", message: "nada que actualizar" }, { status: 400 });
  }
  const input: { content?: string; scheduledAt?: Date | null } = {};
  if (typeof body.content === "string") input.content = body.content;
  if ("scheduledAt" in body) {
    if (body.scheduledAt === null) {
      input.scheduledAt = null;
    } else {
      const date = new Date(body.scheduledAt);
      if (Number.isNaN(date.getTime())) {
        return NextResponse.json({ error: "invalid_body", message: "scheduledAt debe ser una fecha ISO válida" }, { status: 400 });
      }
      input.scheduledAt = date;
    }
  }

  try {
    const post = await getPostRepository().update(auth.tenantId, params.id, input);
    return NextResponse.json(post);
  } catch (err) {
    return handleDomainError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (isAuthResponse(auth)) return auth;

  try {
    const post = await getPostRepository().cancel(auth.tenantId, params.id);
    return NextResponse.json(post);
  } catch (err) {
    return handleDomainError(err);
  }
}
