import type {
  CreateReportInput,
  ModerationCase,
  ModerationNotification,
  ModerationPage,
} from '@lostly/contracts/moderation';
import { apiRequest } from '@/shared/api/client';

export function submitReport(input: CreateReportInput) {
  return apiRequest<{ case: ModerationCase }>('/reports', { method: 'POST', body: input });
}
export function getModerationNotifications(cursor?: string, signal?: AbortSignal) {
  return apiRequest<{ notifications: ModerationPage<ModerationNotification>; unreadCount: number }>(
    '/me/moderation/notifications' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
    { signal },
  );
}
export function getMyCases(cursor?: string, signal?: AbortSignal) {
  return apiRequest<ModerationPage<ModerationCase>>(
    '/me/moderation/cases' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
    { signal },
  );
}
export function markRead(id: string) {
  return apiRequest<void>('/me/moderation/notifications/' + id + '/read', { method: 'POST' });
}
export function appeal(eventId: string, description: string) {
  return apiRequest<{ case: ModerationCase }>('/me/moderation/appeals', {
    method: 'POST',
    body: { eventId, description },
  });
}
