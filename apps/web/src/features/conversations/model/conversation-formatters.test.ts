import { expect, it } from 'vitest';
import { formatConversationActivity } from './conversation-formatters';

it('formats recent activity and calendar dates without negative or invalid labels', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  expect(formatConversationActivity('2026-09-25T12:00:30Z', now)).toBe('Now');
  expect(formatConversationActivity('2026-09-25T11:58:00Z', now)).toBe('2m');
  expect(formatConversationActivity('2026-09-25T10:00:00Z', now)).toBe('2h');
  expect(formatConversationActivity('2026-09-23T12:00:00Z', now)).toBe('Sep 23');
  expect(formatConversationActivity('2025-09-23T12:00:00Z', now)).toBe('Sep 23, 2025');
  expect(formatConversationActivity('invalid', now)).toBe('');
});
