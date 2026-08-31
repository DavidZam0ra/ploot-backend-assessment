import { NextRequest, NextResponse } from "next/server";
import type { PostStatus } from "@ploot/core";
import { isAuthResponse, requireAuth } from "../../../../auth/require-auth";
import { getPostRepository } from "../../../../db/repositories";
import { handleDomainError } from "../../../../api/errors";

const VALID_STATUSES: readonly PostStatus[] = ["draft", "scheduled", "publishing", "published", "failed", "cancelled"];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (isAuthResponse(auth)) return auth;

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  if (statusParam && !VALID_STATUSES.includes(statusParam as PostStatus)) {
    return NextResponse.json({ error: "invalid_status", message: `status debe ser uno de: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);
  const cursor = searchParams.get("cursor") ?? undefined;

  const result = await getPostRepository().list({
    tenantId: auth.tenantId,
    status: (statusParam as PostStatus) ?? undefined,
    limit,
    cursor,
  });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (isAuthResponse(auth)) return auth;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.content !== "string" || typeof body.profileId !== "string") {
    return NextResponse.json({ error: "invalid_body", message: "content y profileId son obligatorios" }, { status: 400 });
  }
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: "invalid_body", message: "scheduledAt debe ser una fecha ISO válida" }, { status: 400 });
  }

  try {
    const post = await getPostRepository().create({
      tenantId: auth.tenantId,
      profileId: body.profileId,
      content: body.content,
      scheduledAt,
    });
    return NextResponse.json(post, { status: 201 });
  } catch (err) {
    return handleDomainError(err);
  }
}
