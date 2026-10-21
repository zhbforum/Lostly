import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProfileResponse, UserProfile } from '@lostly/contracts/profile';
import { ApiError } from '@/shared/api/client';
import { readDraft } from '@/shared/model/form-drafts';
import { deferred } from '@/test/deferred';
import { userProfile } from '@/test/fixtures/profile';
import { TestSession } from '@/test/session';
import { checkUsername, getProfile, saveProfile } from '../api/profile-api';
import { ProfileEditor } from './ProfileEditor';

vi.mock('../api/profile-api');

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(checkUsername).mockImplementation(async (username) => ({
    username,
    available: true,
    reason: null,
  }));
});

afterEach(() => vi.useRealTimers());

function showEditor(profile: UserProfile = userProfile()) {
  const actor = userEvent.setup();
  const updateProfile = vi.fn();
  const view = render(
    <TestSession auth={{ updateProfile }}>
      <ProfileEditor initialProfile={profile} />
    </TestSession>,
  );
  return { ...view, actor, updateProfile };
}

it('normalizes edits, prevents duplicate saves and clears the draft after server confirmation', async () => {
  const pending = deferred<ProfileResponse>();
  vi.mocked(saveProfile).mockReturnValue(pending.promise);
  const { actor, updateProfile } = showEditor();

  // WHEN: edited fields are submitted while the server response is held.
  await actor.clear(screen.getByLabelText('Display name'));
  await actor.type(screen.getByLabelText('Display name'), '  Alex New  ');
  await actor.clear(screen.getByLabelText('Username'));
  await actor.type(screen.getByLabelText('Username'), '  New_Name  ');
  await actor.clear(screen.getByLabelText(/Bio/));
  await actor.type(screen.getByLabelText(/Bio/), '  New introduction  ');
  await actor.click(screen.getByRole('button', { name: 'Save changes' }));

  const input = {
    displayName: 'Alex New',
    username: 'new_name',
    bio: 'New introduction',
    expectedVersion: 1,
  };

  expect(saveProfile).toHaveBeenCalledExactlyOnceWith(input, expect.any(AbortSignal));

  for (const label of ['Display name', 'Username', /Bio/])
    expect(screen.getByLabelText(label)).toBeDisabled();

  expect(screen.getByRole('button', { name: 'Upload photo' })).toBeDisabled();

  await actor.click(screen.getByRole('button', { name: 'Saving…' }));

  expect(saveProfile).toHaveBeenCalledOnce();

  const profile = userProfile({
    displayName: input.displayName,
    username: input.username,
    bio: input.bio,
    version: 2,
  });

  await act(async () => pending.resolve({ profile }));

  // THEN: only server confirmation clears the draft and publishes the saved profile.
  expect(screen.getByRole('status', { name: 'Profile save status' })).toHaveTextContent(
    'Changes saved.',
  );
  expect(screen.getByLabelText('Username')).toHaveValue('new_name');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expect(readDraft('profile:alex')).toBeUndefined();
  expect(updateProfile).toHaveBeenLastCalledWith(profile);
});

it('focuses an invalid display name without saving, then clears the error while editing', async () => {
  const { actor } = showEditor();

  await actor.clear(screen.getByLabelText('Display name'));
  await actor.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(screen.getByLabelText('Display name')).toHaveFocus();
  expect(screen.getByLabelText('Display name')).toHaveAccessibleDescription(
    /Enter your display name/,
  );
  expect(saveProfile).not.toHaveBeenCalled();

  await actor.type(screen.getByLabelText('Display name'), 'Alex New');

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each([
  ['', 'Your username cannot be cleared.'],
  ['admin', 'This username is reserved.'],
  ['_invalid', 'Use 3–30 letters, numbers or underscores.'],
])('rejects an invalid username (%s) and focuses its field', async (value, feedback) => {
  const { actor } = showEditor();

  await actor.clear(screen.getByLabelText('Username'));

  if (value) await actor.type(screen.getByLabelText('Username'), value);

  await actor.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(screen.getByLabelText('Username')).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent(feedback);
  expect(saveProfile).not.toHaveBeenCalled();
});

it.each([
  [
    'PROFILE_CHANGED',
    'Your profile changed elsewhere. Review the latest details, then save again.',
  ],
  ['DISPLAY_NAME_LOCKED', 'Your name was recently changed. You can still update your bio.'],
  [
    'USERNAME_LOCKED',
    'Your username was recently changed. You can still update the other details.',
  ],
])(
  'refreshes %s conflicts, preserves locally edited bio and retries using the new version',
  async (code, feedback) => {
    // GIVEN: another edit has advanced the profile version without changing the local bio.
    const next = userProfile({ displayName: 'Remote name', username: 'remote_name', version: 2 });
    vi.mocked(getProfile).mockResolvedValue({ profile: next });
    vi.mocked(saveProfile)
      .mockRejectedValueOnce(new ApiError(409, code, 'Internal details'))
      .mockResolvedValueOnce({ profile: { ...next, bio: 'Local bio', version: 3 } });
    const { actor } = showEditor();

    await actor.clear(screen.getByLabelText(/Bio/));
    await actor.type(screen.getByLabelText(/Bio/), 'Local bio');
    await actor.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(feedback);
    expect(getProfile).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Display name')).toHaveValue('Remote name');
    expect(screen.getByLabelText('Username')).toHaveValue('remote_name');
    expect(screen.getByLabelText(/Bio/)).toHaveValue('Local bio');

    // WHEN: the user retries, preserve their bio but use the authoritative identity and version.
    await actor.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(saveProfile).toHaveBeenLastCalledWith(
      { displayName: next.displayName, bio: 'Local bio', expectedVersion: 2 },
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('status', { name: 'Profile save status' })).toHaveTextContent(
      'Changes saved.',
    );
  },
);

it('keeps edits recoverable when refreshing a conflict fails', async () => {
  vi.mocked(saveProfile).mockRejectedValue(new ApiError(409, 'PROFILE_CHANGED', 'Conflict'));
  vi.mocked(getProfile).mockRejectedValue(new TypeError('offline'));
  const { actor } = showEditor();

  await actor.clear(screen.getByLabelText(/Bio/));
  await actor.type(screen.getByLabelText(/Bio/), 'Local bio');
  await actor.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Your profile changed elsewhere.');
  expect(screen.getByLabelText(/Bio/)).toHaveValue('Local bio');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  expect(readDraft('profile:alex')).toMatchObject({ bio: 'Local bio', version: 1 });
});

it('reports network failures safely and permits a successful retry', async () => {
  vi.mocked(saveProfile)
    .mockRejectedValueOnce(new TypeError('Internal details'))
    .mockResolvedValueOnce({ profile: userProfile({ bio: '', version: 2 }) });
  const { actor } = showEditor();

  await actor.clear(screen.getByLabelText(/Bio/));
  await actor.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'We could not save your changes. Please try again.',
  );

  await actor.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Profile save status' })).toHaveTextContent(
    'Changes saved.',
  );
});

it('unlocks name and username independently when their cooldowns expire', async () => {
  vi.useFakeTimers();
  const profile = userProfile({
    nextDisplayNameChangeAt: new Date(Date.now() + 1000).toISOString(),
    nextUsernameChangeAt: new Date(Date.now() + 2000).toISOString(),
  });

  render(
    <TestSession>
      <ProfileEditor initialProfile={profile} />
    </TestSession>,
  );

  expect(screen.getByLabelText('Display name')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Username')).toHaveAttribute('readonly');

  await act(() => vi.advanceTimersByTimeAsync(1000));

  expect(screen.getByLabelText('Display name')).not.toHaveAttribute('readonly');
  expect(screen.getByLabelText('Username')).toHaveAttribute('readonly');

  await act(() => vi.advanceTimersByTimeAsync(1000));

  expect(screen.getByLabelText('Username')).not.toHaveAttribute('readonly');
});

it.each([false, true])(
  'aborts a pending save on unmount and ignores late results (rejected: %s)',
  async (rejected) => {
    const pending = deferred<ProfileResponse>();
    vi.mocked(saveProfile).mockReturnValue(pending.promise);
    const { actor, unmount, updateProfile } = showEditor();

    await actor.clear(screen.getByLabelText(/Bio/));
    await actor.click(screen.getByRole('button', { name: 'Save changes' }));

    const signal = vi.mocked(saveProfile).mock.calls[0]![1]!;

    updateProfile.mockClear();
    unmount();

    expect(signal.aborted).toBe(true);

    // Even a transport that ignores cancellation must not publish after unmount.
    await act(async () => {
      if (rejected) pending.reject(new TypeError('offline'));
      else pending.resolve({ profile: userProfile({ bio: '', version: 2 }) });
    });

    expect(updateProfile).not.toHaveBeenCalled();
  },
);

it('warns about unsaved edits and removes that warning after cancellation', async () => {
  const { actor } = showEditor();
  const warn = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  expect(warn()).toBe(false);

  await actor.clear(screen.getByLabelText(/Bio/));

  expect(warn()).toBe(true);

  await actor.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.getByLabelText(/Bio/)).toHaveValue(userProfile().bio));
  expect(warn()).toBe(false);
  expect(readDraft('profile:alex')).toBeUndefined();
});
