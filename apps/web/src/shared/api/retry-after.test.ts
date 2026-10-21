import { describe, expect, it } from 'vitest';
import { parseRetryAfter } from './retry-after';

describe('Retry-After', () => {
  it.each([
    ['42', 42],
    ['0', 0],
    [' 60 ', 60],
  ])('parses delay %s', (header, seconds) => {
    expect(parseRetryAfter(header as string)).toBe(seconds);
  });

  it.each([
    null,
    '',
    ' ',
    '-1',
    '1.5',
    '+4',
    '1e2',
    'Infinity',
    'tomorrow',
    '99999999999999999999',
  ])('rejects invalid delay %s', (header) => {
    expect(parseRetryAfter(header)).toBeNull();
  });

  it('supports HTTP dates, rounds up and clamps expired dates', () => {
    const now = Date.parse('2026-09-24T12:00:00.500Z');

    expect(parseRetryAfter('Thu, 24 Sep 2026 12:00:42 GMT', now)).toBe(42);
    expect(parseRetryAfter('Thu, 24 Sep 2026 11:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('Thu, definitely not a date', now)).toBeNull();
  });
});
