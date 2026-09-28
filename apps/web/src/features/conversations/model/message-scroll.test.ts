import { expect, it } from 'vitest';
import { anchoredScrollTop, isNearMessageBottom } from './message-scroll';
import { messageDay, messageTime } from './conversation-formatters';

it('preserves the visual anchor after prepend and distinguishes reading from bottom', () => {
  expect(anchoredScrollTop(1200, 100, 1800)).toBe(700);
  expect(isNearMessageBottom(1200, 100, 400)).toBe(false);
  expect(isNearMessageBottom(1200, 790, 400)).toBe(true);
});
it('formats calendar separators across month/year boundaries in local time', () => {
  const now = new Date(2026, 0, 1, 10);
  expect(messageDay(new Date(2026, 0, 1, 1).toISOString(), now)).toBe('Today');
  expect(messageDay(new Date(2025, 11, 31, 1).toISOString(), now)).toBe('Yesterday');
  expect(messageDay('invalid', now)).toBe('');
  expect(messageTime(new Date(2026, 0, 1, 14, 32).toISOString())).toBe('14:32');
});
