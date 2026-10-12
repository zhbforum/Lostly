import { usernameIssue } from '@lostly/contracts/profile';

export function getUsernameError(value: string, current: string | null) {
  if (!value && !current) return null;
  if (!value)
    return 'Your username cannot be cleared. You can choose a different one when the lock ends.';
  const issue = usernameIssue(value);
  if (issue === 'reserved') return 'This username is reserved. Please choose another.';
  return issue
    ? 'Use 3–30 letters, numbers or underscores. Start and end with a letter or number.'
    : null;
}
