import { expect, test } from 'bun:test';
import { readR2Config } from './r2-storage';

test('requires all R2 settings without disclosing values in errors', () => {
  expect(() => readR2Config({ R2_SECRET_ACCESS_KEY: 'never-print-me' })).toThrow('are required');
  expect(() =>
    readR2Config({
      R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      R2_BUCKET: 'test',
      R2_ACCESS_KEY_ID: 'test',
      R2_SECRET_ACCESS_KEY: 'test',
    }),
  ).not.toThrow();
  expect(() =>
    readR2Config({
      R2_ENDPOINT: 'http://attacker.invalid',
      R2_BUCKET: 'test',
      R2_ACCESS_KEY_ID: 'test',
      R2_SECRET_ACCESS_KEY: 'test',
    }),
  ).toThrow('HTTPS Cloudflare');
  expect(() =>
    readR2Config({
      R2_ENDPOINT: 'malformed-never-print-me',
      R2_BUCKET: 'test',
      R2_ACCESS_KEY_ID: 'test',
      R2_SECRET_ACCESS_KEY: 'test',
    }),
  ).toThrow(new Error('R2_ENDPOINT must be an HTTPS Cloudflare R2 endpoint'));
});
