import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { profileAvatar } from '@/test/fixtures/profile';
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

it('falls back to initials for a broken image and displays a replacement URL', () => {
  const avatar = profileAvatar();
  const { container, rerender } = render(<Avatar name="Alex Morgan" avatar={avatar} />);
  const image = container.querySelector('img');
  expect(image).toHaveAttribute('src', avatar.staticUrl);

  fireEvent.error(image!);
  expect(screen.getByText('AM')).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();

  rerender(<Avatar name="Alex Morgan" avatar={{ ...avatar }} />);
  expect(container.querySelector('img')).toBeNull();

  const replacement = profileAvatar({ staticUrl: 'https://images.example.com/replacement.webp' });
  rerender(<Avatar name="Alex Morgan" avatar={replacement} />);
  expect(container.querySelector('img')).toHaveAttribute('src', replacement.staticUrl);
  expect(screen.queryByText('AM')).not.toBeInTheDocument();
});
