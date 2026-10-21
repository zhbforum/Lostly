import { describe, expect, it } from 'vitest';
import { analyzeMessageBody, normalizeMessageBody } from './message-body';
import { CONVERSATION_CONSTRAINTS } from './types';

const maxLength = CONVERSATION_CONSTRAINTS.messageMaxLength;

describe('message normalization matches the server contract', () => {
  it('normalizes CRLF/CR and trims only the outside', () => {
    expect(normalizeMessageBody(' \r\nHello  \r\n  Alex\rBye\n ')).toEqual({
      status: 'text',
      body: 'Hello  \n  Alex\nBye',
    });
  });

  it.each(['', ' \r\n\t '])('distinguishes empty text: %j', (body) => {
    expect(normalizeMessageBody(body)).toEqual({ status: 'empty' });
  });

  it.each(['\0', 'hello\0world', '\ud800', '\udfff', 'a\ud800b', '\udfff\ud800'])(
    'rejects invalid Unicode: %j',
    (body) => {
      expect(normalizeMessageBody(body)).toEqual({ status: 'invalid' });
    },
  );

  it.each(['😀'.repeat(2000), 'e\u0301'.repeat(1000), 'a'.repeat(2000), '\uFFFD'])(
    'accepts valid scalars up to 2000 code points',
    (body) => {
      expect(normalizeMessageBody(body)).toEqual({ status: 'text', body });
    },
  );

  it.each(['😀'.repeat(2001), 'e\u0301'.repeat(1001), 'a'.repeat(2001)])(
    'rejects oversized text',
    (body) => {
      expect(normalizeMessageBody(body)).toEqual({ status: 'invalid' });
    },
  );
});

describe('message body analysis', () => {
  it.each(['', ' \r\n\t '])('reports empty normalized text with zero count: %j', (input) => {
    expect(analyzeMessageBody(input)).toEqual({
      normalization: { status: 'empty' },
      count: 0,
      overLimit: false,
    });
  });

  it.each(['a', '😀'])(
    'accepts exactly the code-point limit with an exact count: %s',
    (character) => {
      const body = character.repeat(maxLength);

      expect(analyzeMessageBody(body)).toEqual({
        normalization: { status: 'text', body },
        count: maxLength,
        overLimit: false,
      });
    },
  );

  it.each([maxLength + 1, 100_000])('caps oversized text at max + 1: %i code points', (length) => {
    expect(analyzeMessageBody('x'.repeat(length))).toEqual({
      normalization: { status: 'invalid' },
      count: maxLength + 1,
      overLimit: true,
    });
  });

  it('counts emoji and combining characters by code point, not UTF-16 unit or grapheme', () => {
    const body = '😀e\u0301';

    expect(analyzeMessageBody(body)).toEqual({
      normalization: { status: 'text', body },
      count: 3,
      overLimit: false,
    });
  });

  it('counts the CRLF/CR-normalized, trimmed body without changing internal whitespace', () => {
    expect(analyzeMessageBody(' \r\na  \r\nb\rc\n ')).toEqual({
      normalization: { status: 'text', body: 'a  \nb\nc' },
      count: 7,
      overLimit: false,
    });
  });

  it.each(['\0', '\ud800', '\udfff'])(
    'continues counting invalid characters below the cap regardless of their position: %j',
    (invalid) => {
      for (const body of [`${invalid}😀ab`, `😀a${invalid}b`, `😀ab${invalid}`]) {
        expect(analyzeMessageBody(body)).toEqual({
          normalization: { status: 'invalid' },
          count: 4,
          overLimit: false,
        });
      }
    },
  );

  it.each(['\0', '\ud800', '\udfff'])(
    'still caps the count after invalid Unicode followed by a huge tail: %j',
    (invalid) => {
      expect(analyzeMessageBody(invalid + 'x'.repeat(100_000))).toEqual({
        normalization: { status: 'invalid' },
        count: maxLength + 1,
        overLimit: true,
      });
    },
  );

  it('accepts the replacement character as a valid scalar', () => {
    expect(analyzeMessageBody('\uFFFD')).toEqual({
      normalization: { status: 'text', body: '\uFFFD' },
      count: 1,
      overLimit: false,
    });
  });
});
