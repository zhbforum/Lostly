import { expect, it } from 'vitest';
import { safeReturnTo } from './return-to';

it.each([
  undefined,
  null,
  'https://evil.test',
  '//evil.test',
  '/\\evil.test',
  '/%5cevil.test',
  '/%2fevil.test',
  '/login',
  '/register',
  '/\n/evil.test',
  '/%',
])('rejects unsafe return destinations: %j', (value) => {
  expect(safeReturnTo(value)).toBe('/');
});
it('preserves an internal destination with query and fragment', () => {
  expect(safeReturnTo('/listings/abc?kind=found#claims')).toBe('/listings/abc?kind=found#claims');
  expect(safeReturnTo('/listings?q=blue%20backpack')).toBe('/listings?q=blue%20backpack');
  expect(safeReturnTo('/%6cogin')).toBe('/');
});
