import { expect, it } from 'vitest';
import { profilePath } from './profile-path';

it('prefers the canonical handle and preserves the stable ID fallback for existing accounts', () => {
  expect(profilePath({ id: 'user-id', username: 'alex_morgan' })).toBe('/u/alex_morgan');
  expect(profilePath({ id: 'user-id', username: null })).toBe('/users/user-id');
  expect(profilePath({ id: 'user-id' })).toBe('/users/user-id');
  expect(profilePath({ id: 'not/a/path' })).toBe('/users/not%2Fa%2Fpath');
});
