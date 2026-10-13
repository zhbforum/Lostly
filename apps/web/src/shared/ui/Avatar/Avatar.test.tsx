import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Avatar } from './Avatar';

it.each([
  ['👩🏽‍💻 Alex', '👩🏽‍💻A'],
  ['🇺🇦 Morgan', '🇺🇦M'],
  ['e\u0301 Morgan', 'E\u0301M'],
  ['Alex Morgan', 'AM'],
])('keeps complete graphemes in the initials for %s', (name, initials) => {
  render(<Avatar name={name} />);
  expect(screen.getByText(initials)).toBeInTheDocument();
});
