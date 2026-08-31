export type PostStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export interface Post {
  id: string;
  tenantId: string;
  profileId: string;
  status: PostStatus;
  content: string;
  scheduledAt: Date | null;
  claimedAt: Date | null;
  claimedBy: string | null;
  publishedAt: Date | null;
  externalId: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}
