import { expect, it } from 'vitest';
import { requireApiUrl } from '../../../config/environment';

it.each([
  undefined,
  '',
  ' ',
  '/api',
  'javascript:alert(1)',
  'https://user:secret@example.com',
  'https://example.com?key=secret',
  'https://example.com#api',
])('rejects missing or invalid build configuration: %j', (value) => {
  expect(() => requireApiUrl(value)).toThrow(/VITE_API_URL/);
});

it('normalizes an explicitly configured API base URL', () => {
  expect(requireApiUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
});
