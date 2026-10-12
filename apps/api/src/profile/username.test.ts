import { expect, test } from 'bun:test';
import { normalizeUsername, usernameIssue } from '@lostly/contracts/profile';

test('username rules normalize ASCII case, reserve service names, and bound the URL-safe namespace', () => {
  expect(normalizeUsername('  Alex_Morgan ')).toBe('alex_morgan');
  for (const name of ['abc', '123', 'a_b', 'a'.repeat(30), 'Alex_Morgan'])
    expect(usernameIssue(name)).toBeNull();
  for (const name of ['admin', 'SUPPORT', 'lostly', 'settings'])
    expect(usernameIssue(name)).toBe('reserved');
  for (const name of [
    'ab',
    'a'.repeat(31),
    '_alex',
    'alex_',
    '___',
    'alex.name',
    'alex/name',
    'alex name',
    'аlex',
    '😄',
  ])
    expect(usernameIssue(name)).toBe('invalid');
});
