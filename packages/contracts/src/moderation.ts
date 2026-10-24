import type { PageInfo } from './pagination';

export const MODERATION_TARGETS = [
  'listing',
  'user',
  'claim',
  'message',
  'listing_image',
  'avatar',
  'conversation',
] as const;
export type ModerationTarget = (typeof MODERATION_TARGETS)[number];
export const CASE_CATEGORIES = [
  'spam',
  'harassment',
  'fraud',
  'impersonation',
  'unsafe_content',
  'other',
] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];
export const CASE_STATUSES = ['open', 'in_review', 'resolved', 'dismissed'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export interface AccountRestriction {
  reason: string;
  until: string | null;
}
export interface ModerationCase {
  id: string;
  kind: 'report' | 'appeal';
  targetType: ModerationTarget;
  targetId: string;
  category: CaseCategory;
  description: string;
  status: CaseStatus;
  version: number;
  reporterId: string | null;
  assigneeId: string | null;
  parentEventId: string | null;
  publicResolution: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ModerationNotification {
  id: string;
  eventId: string;
  targetType: string;
  targetId: string;
  title: string;
  message: string;
  canAppeal: boolean;
  readAt: string | null;
  createdAt: string;
}
export interface ModerationPage<T> {
  items: T[];
  pageInfo: PageInfo;
}
export interface CreateReportInput {
  targetType: ModerationTarget;
  targetId: string;
  category: CaseCategory;
  description: string;
}
export interface PublicModerationActivity {
  notifications: ModerationPage<ModerationNotification>;
  cases: ModerationPage<ModerationCase>;
  unreadCount: number;
}
export const MODERATION_ACTION_LABELS = {
  restore_archived_listing: 'Restore archived listing',
  reopen_claim: 'Reopen claim',
  archive_listing: 'Listing archived',
  reject_claim: 'Claim rejected',
  hide_listing: 'Listing hidden',
  restore_listing: 'Listing restored',
  suspend_user: 'Account restricted',
  unsuspend_user: 'Account restriction removed',
  revoke_sessions: 'Sessions revoked',
  reset_profile: 'Profile moderated',
  hide_listing_image: 'Photo hidden',
  restore_listing_image: 'Photo restored',
  hide_message: 'Message hidden',
  restore_message: 'Message restored',
  close_conversation: 'Conversation paused',
  reopen_conversation: 'Conversation resumed',
  assign_case: 'Case assigned',
  resolve_case: 'Case resolved',
  dismiss_case: 'Case dismissed',
  view_case_evidence: 'Private evidence viewed',
  add_case_note: 'Internal note added',
} as const;
export type ModerationAction = keyof typeof MODERATION_ACTION_LABELS;
