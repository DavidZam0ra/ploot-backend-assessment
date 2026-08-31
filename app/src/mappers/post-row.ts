import type { Post, PostStatus } from "@ploot/core";

export interface PostRow {
  id: string;
  tenant_id: string;
  profile_id: string;
  status: PostStatus;
  content: string;
  scheduled_at: Date | null;
  claimed_at: Date | null;
  claimed_by: string | null;
  published_at: Date | null;
  external_id: string | null;
  attempt_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export function toPost(row: PostRow): Post {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    profileId: row.profile_id,
    status: row.status,
    content: row.content,
    scheduledAt: row.scheduled_at,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    publishedAt: row.published_at,
    externalId: row.external_id,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
