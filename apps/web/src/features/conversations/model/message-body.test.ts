import { describe, expect, it } from 'vitest';
import { normalizeMessageBody } from './message-body';

describe('message normalization matches the server contract', () => {
  it('normalizes line endings and trims only the outside', () => {
    expect(normalizeMessageBody(' \r\nHello  \r\n  Alex\rBye\n ')).toBe('Hello  \n  Alex\nBye');
  });
  it.each(['', ' \r\n\t ', '\0', 'hello\0world', '\ud800', '\udfff', 'a\ud800b', '\udfff\ud800'])(
    'rejects empty, NUL or malformed Unicode: %j',
    (body) => {
      expect(normalizeMessageBody(body)).toBeNull();
    },
  );
  it('counts Unicode code points, not UTF-16 units or grapheme clusters', () => {
    expect(normalizeMessageBody('😀'.repeat(2000))).toBe('😀'.repeat(2000));
    expect(normalizeMessageBody('😀'.repeat(2001))).toBeNull();
    expect(normalizeMessageBody('e\u0301'.repeat(1000))).not.toBeNull();
    expect(normalizeMessageBody('e\u0301'.repeat(1001))).toBeNull();
    expect(normalizeMessageBody('a'.repeat(2000))).not.toBeNull();
    expect(normalizeMessageBody('a'.repeat(2001))).toBeNull();
    expect(normalizeMessageBody(' \n😀\n ')).toBe('😀');
  });
});
