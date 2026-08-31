import type { Post } from "@ploot/core";

/** Keyset pagination sobre (created_at, id): un cursor de solo-id no sirve porque los ids son UUID v4, no ordenables por tiempo. */
export function encodeCursor(post: Post): string {
  return Buffer.from(`${post.createdAt.toISOString()}|${post.id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  return { createdAt, id };
}
