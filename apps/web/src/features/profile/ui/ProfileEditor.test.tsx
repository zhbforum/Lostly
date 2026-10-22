import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AuthUser } from '@lostly/contracts/auth';
import type { UserProfile } from '@lostly/contracts/profile';
import { useAuth } from '@/features/auth/model/auth-context';
import { readDraft, saveDraft } from '@/shared/model/form-drafts';
import { ApiError } from '@/shared/api/client';
import { saveProfile } from '../api/profile-api';
import { ProfileEditor } from './ProfileEditor';

vi.mock('@/features/auth/model/auth-context');
vi.mock('../api/profile-api');

const profile: UserProfile = {
  id: 'alex',
  displayName: 'Alex Morgan',
  username: null,
  bio: 'Original bio',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  nextDisplayNameChangeAt: null,
  nextUsernameChangeAt: null,
  avatar: null,
};
const user: AuthUser = {
  id: profile.id,
  email: 'alex@example.com',
  displayName: profile.displayName,
  role: 'user',
  avatar: null,
  profileVersion: 1,
};

function authenticate(current = user) {
  vi.mocked(useAuth).mockReturnValue({
    user: current,
    status: 'authenticated',
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateProfile: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  authenticate();
});

it('keeps a stale draft across reopening and requires a decision before saving', () => {
  const first = render(<ProfileEditor initialProfile={profile} />);

  fireEvent.change(screen.getByLabelText(/Bio/), { target: { value: 'Unsaved bio' } });
  first.unmount();

  const latest = { ...profile, version: 2 };
  const second = render(<ProfileEditor initialProfile={latest} />);

  expect(screen.getByLabelText(/Bio/)).toHaveValue('Unsaved bio');
  expect(screen.getByRole('status', { name: 'Profile conflict' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expect(readDraft(`profile:${profile.id}`)).toMatchObject({ version: 1, bio: 'Unsaved bio' });

  second.unmount();
  render(<ProfileEditor initialProfile={latest} />);

  expect(screen.getByRole('status', { name: 'Profile conflict' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Keep editable changes' }));

  expect(screen.getByLabelText(/Bio/)).toHaveValue('Unsaved bio');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  expect(saveProfile).not.toHaveBeenCalled();
});

it('preserves remote changes to untouched fields when accepting a stale draft', () => {
  saveDraft(`profile:${profile.id}`, {
    ...profile,
    displayName: 'Local name',
    base: profile,
  });
  render(<ProfileEditor initialProfile={{ ...profile, version: 2, bio: 'Remote bio' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Keep editable changes' }));

  expect(screen.getByLabelText('Display name')).toHaveValue('Local name');
  expect(screen.getByLabelText(/Bio/)).toHaveValue('Remote bio');
});

it('applies name cooldowns only after the user resolves the stale draft', () => {
  saveDraft(`profile:${profile.id}`, { ...profile, displayName: 'Local name', bio: 'Local bio' });
  render(
    <ProfileEditor
      initialProfile={{
        ...profile,
        version: 2,
        displayName: 'Remote name',
        nextDisplayNameChangeAt: new Date(Date.now() + 86_400_000).toISOString(),
      }}
    />,
  );

  expect(screen.getByLabelText('Display name')).toHaveValue('Local name');

  fireEvent.click(screen.getByRole('button', { name: 'Keep editable changes' }));

  expect(screen.getByLabelText('Display name')).toHaveValue('Remote name');
  expect(screen.getByLabelText(/Bio/)).toHaveValue('Local bio');
});

it('discards a stale draft only when the user cancels', () => {
  saveDraft(`profile:${profile.id}`, { ...profile, bio: 'Local bio' });
  render(<ProfileEditor initialProfile={{ ...profile, version: 2, bio: 'Remote bio' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.getByLabelText(/Bio/)).toHaveValue('Remote bio');
  expect(readDraft(`profile:${profile.id}`)).toBeUndefined();
});

it('focuses a taken username after the saving state re-enables the input', async () => {
  vi.mocked(saveProfile).mockRejectedValue(new ApiError(409, 'USERNAME_TAKEN', 'Username taken'));

  render(<ProfileEditor initialProfile={profile} />);

  fireEvent.change(screen.getByLabelText('Username Optional'), {
    target: { value: 'taken_name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  const usernameInput = screen.getByLabelText('Username Optional');

  await waitFor(() => {
    expect(screen.getByText('Username taken')).toBeVisible();
    expect(usernameInput).toBeEnabled();
    expect(usernameInput).toHaveFocus();
  });
});

const oldAvatar = {
  id: 'old',
  url: 'https://images.example.com/old.webp',
  staticUrl: 'https://images.example.com/old.webp',
  animated: false,
  urlExpiresAt: '2027-01-01T00:00:00Z',
};
const newAvatar = { ...oldAvatar, id: 'new', staticUrl: 'https://images.example.com/new.webp' };

it.each([newAvatar, null])('uses a newer session avatar, including removal: %s', (avatar) => {
  authenticate({ ...user, avatar: oldAvatar });

  const view = render(<ProfileEditor initialProfile={{ ...profile, avatar: oldAvatar }} />);

  expect(view.container.querySelector('img')?.getAttribute('src')).toBe(oldAvatar.staticUrl);

  authenticate({ ...user, profileVersion: 2, avatar });
  view.rerender(<ProfileEditor initialProfile={{ ...profile, avatar: oldAvatar }} />);

  if (avatar)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(avatar.staticUrl);
  else expect(view.container.querySelector('img')).toBeNull();
});

it('does not replace a newer editor avatar with an older session', () => {
  authenticate({ ...user, avatar: oldAvatar });

  const view = render(
    <ProfileEditor initialProfile={{ ...profile, version: 2, avatar: newAvatar }} />,
  );

  expect(view.container.querySelector('img')?.getAttribute('src')).toBe(newAvatar.staticUrl);
});
