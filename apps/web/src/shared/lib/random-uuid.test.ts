import { afterEach, expect, it, vi } from 'vitest';
import { randomUuid } from './random-uuid';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('generates a UUID v4 with the RFC variant when crypto.randomUUID is unavailable', () => {
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });

  expect(crypto.randomUUID).toBeUndefined();

  expect(randomUuid()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

it.each([
  [0x00, '00000000-0000-4000-8000-000000000000'],
  [0x55, '55555555-5555-4555-9555-555555555555'],
  [0xaa, 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'],
  [0xff, 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
])('sets version/variant bits while preserving the other random bits (%i)', (byte, expected) => {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
    expect(array).toBeInstanceOf(Uint8Array);
    expect(array?.byteLength).toBe(16);
    (array as Uint8Array).fill(byte);
    return array;
  });

  expect(randomUuid()).toBe(expected);
});
