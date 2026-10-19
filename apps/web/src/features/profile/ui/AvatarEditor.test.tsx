import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PROFILE_CONSTRAINTS } from '@lostly/contracts/profile';
import { deferred } from '@/test/deferred';
import { profileAvatar, userProfile } from '@/test/fixtures/profile';
import { AvatarEditor } from './AvatarEditor';

const drawImage = vi.fn();
const bitmap = { width: 600, height: 400, close: vi.fn() };
const decode = vi.fn();
const preview = 'data:image/png;base64,cHJldmlldw==';

beforeEach(() => {
  vi.clearAllMocks();
  decode.mockReset().mockResolvedValue(bitmap);
  vi.stubGlobal('createImageBitmap', decode);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(preview);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function showEditor({
  avatar = null as ReturnType<typeof profileAvatar> | null,
  disabled = false,
} = {}) {
  const actor = userEvent.setup({ applyAccept: false });
  const profile = userProfile({ avatar, version: 4 });
  const callbacks = { onBusy: vi.fn(), onSaved: vi.fn(), onConflict: vi.fn(async () => {}) };
  const view = render(
    <AvatarEditor profile={profile} avatar={avatar} disabled={disabled} {...callbacks} />,
  );
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const select = (file = new File(['original image'], 'photo.gif', { type: 'image/gif' })) =>
    actor.upload(input, file);
  return { ...view, actor, profile, input, select, ...callbacks };
}

it.each([
  ['empty', new File([], 'empty.png', { type: 'image/png' })],
  ['unsupported', new File(['svg'], 'photo.svg', { type: 'image/svg+xml' })],
  [
    'too large',
    new File([new Uint8Array(PROFILE_CONSTRAINTS.avatarMaxBytes + 1)], 'photo.png', {
      type: 'image/png',
    }),
  ],
])('rejects an %s file before decoding or submitting', async (_name, file) => {
  const { select, onBusy, onSaved } = showEditor();
  await select(file);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Choose a JPG, PNG, WebP or GIF up to 5 MB.',
  );
  expect(decode).not.toHaveBeenCalled();
  expect(onBusy).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each([
  [600, 400, 100, 0],
  [400, 600, 0, 100],
])(
  'previews a centered square for a %s × %s image and restores focus on cancel',
  async (width, height, x, y) => {
    const decoded = { width, height, close: vi.fn() };
    decode.mockResolvedValue(decoded);
    const { actor, select, input, onSaved } = showEditor();
    const openFilePicker = vi.spyOn(input, 'click');
    await actor.click(screen.getByRole('button', { name: 'Upload photo' }));
    expect(openFilePicker).toHaveBeenCalledOnce();
    await select();
    expect(await screen.findByRole('dialog', { name: 'Update profile photo' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Preview of your new profile photo' })).toHaveAttribute(
      'src',
      preview,
    );
    expect(drawImage).toHaveBeenCalledWith(decoded, x, y, 400, 400, 0, 0, 256, 256);
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(input).toHaveValue('');
    await actor.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload photo' })).toHaveFocus());
    expect(onSaved).not.toHaveBeenCalled();
    await select();
    expect(await screen.findByRole('dialog')).toBeVisible();
    await actor.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  },
);

it('accepts a file with unknown MIME at the inclusive size limit for server inspection', async () => {
  const file = new File([new Uint8Array(PROFILE_CONSTRAINTS.avatarMaxBytes)], 'photo.jpg');
  const { select } = showEditor();
  await select(file);
  expect(await screen.findByRole('dialog', { name: 'Update profile photo' })).toBeVisible();
  expect(decode).toHaveBeenCalledWith(file);
});

it('saves the original animated file with version protection and locks the dialog while pending', async () => {
  const pending = deferred<Response>();
  const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
  vi.stubGlobal('fetch', fetcher);
  const { actor, select, profile, onBusy, onSaved } = showEditor();
  const file = new File(['animated gif'], 'photo.gif', { type: 'image/gif' });
  await select(file);
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
  await actor.click(screen.getByRole('button', { name: 'Save photo' }));
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await actor.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeVisible();
  await actor.click(screen.getByRole('button', { name: 'Saving…' }));
  expect(fetcher).toHaveBeenCalledOnce();
  const [, options] = fetcher.mock.calls[0]!;
  expect(Object.fromEntries(options!.body as FormData)).toEqual({ file, expectedVersion: '4' });
  const updated = { ...profile, version: 5, avatar: profileAvatar() };
  await act(async () => pending.resolve(Response.json({ profile: updated })));
  expect(onSaved).toHaveBeenCalledExactlyOnceWith(updated, 'Profile photo updated.');
  expect(onBusy.mock.calls).toEqual([[true], [false], [true], [false]]);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('requires confirmation before removal and returns the updated profile', async () => {
  const updated = userProfile({ avatar: null, version: 5 });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ profile: updated }));
  vi.stubGlobal('fetch', fetcher);
  const { actor, onSaved } = showEditor({ avatar: profileAvatar() });
  await actor.click(screen.getByRole('button', { name: 'Remove' }));
  expect(await screen.findByRole('dialog', { name: 'Remove profile photo?' })).toBeVisible();
  await actor.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toHaveFocus());
  expect(fetcher).not.toHaveBeenCalled();
  await actor.click(screen.getByRole('button', { name: 'Remove' }));
  await actor.click(await screen.findByRole('button', { name: 'Remove photo' }));
  await waitFor(() =>
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(updated, 'Profile photo removed.'),
  );
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    method: 'DELETE',
    body: JSON.stringify({ expectedVersion: 4 }),
  });
});

it.each([
  [422, 'INVALID_AVATAR', 'This image cannot be used.'],
  [429, 'RATE_LIMITED', 'Please wait before updating your photo.'],
  [413, 'REQUEST_TOO_LARGE', 'This file is too large.'],
  [500, 'INTERNAL_ERROR', 'We could not update your photo. Please try again.'],
])('keeps the preview available after %s/%s and allows retry', async (status, code, feedback) => {
  const updated = userProfile({ avatar: profileAvatar(), version: 5 });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        { error: { code, message: status === 500 ? 'Internal details' : feedback } },
        { status },
      ),
    )
    .mockResolvedValueOnce(Response.json({ profile: updated }));
  vi.stubGlobal('fetch', fetcher);
  const { actor, select, onSaved } = showEditor();
  await select();
  await actor.click(await screen.findByRole('button', { name: 'Save photo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(feedback);
  expect(screen.getByRole('img', { name: 'Preview of your new profile photo' })).toBeVisible();
  expect(onSaved).not.toHaveBeenCalled();
  await actor.click(screen.getByRole('button', { name: 'Save photo' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated, 'Profile photo updated.'));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('reconciles a stale profile before asking the user to review and retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: { code: 'PROFILE_CHANGED', message: 'Conflict' } }, { status: 409 }),
      ),
  );
  const { actor, select, onConflict, onSaved } = showEditor();
  const refresh = deferred<void>();
  onConflict.mockReturnValue(refresh.promise);
  await select();
  await actor.click(await screen.findByRole('button', { name: 'Save photo' }));
  expect(onConflict).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await act(async () => refresh.resolve());
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your profile changed elsewhere. Review it, then try again.',
  );
  expect(screen.getByRole('button', { name: 'Save photo' })).toBeEnabled();
  expect(onSaved).not.toHaveBeenCalled();
});

it.each(['decode', 'canvas'] as const)(
  'recovers from a %s preview failure without saving',
  async (failure) => {
    if (failure === 'decode') decode.mockRejectedValueOnce(new Error('Invalid bytes'));
    else vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
    const { select, onBusy, onSaved } = showEditor();
    await select();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not open this image. Try another file.',
    );
    expect(onBusy.mock.calls).toEqual([[true], [false]]);
    expect(onSaved).not.toHaveBeenCalled();
    if (failure === 'canvas') expect(bitmap.close).toHaveBeenCalledOnce();
    await select();
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  },
);

it('discards a preview that finishes after unmount and still releases the bitmap', async () => {
  const pending = deferred<typeof bitmap>();
  decode.mockReturnValue(pending.promise);
  const { select, unmount, onBusy, onSaved } = showEditor();
  await select();
  expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();
  unmount();
  await act(async () => pending.resolve(bitmap));
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(onBusy).toHaveBeenCalledExactlyOnceWith(true);
  expect(onSaved).not.toHaveBeenCalled();
});

it.each([false, true])(
  'aborts an in-flight save and ignores a late completion (rejected: %s)',
  async (rejected) => {
    const pending = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    vi.stubGlobal('fetch', fetcher);
    const { actor, select, unmount, onBusy, onSaved, onConflict } = showEditor();
    await select();
    await actor.click(await screen.findByRole('button', { name: 'Save photo' }));
    const signal = fetcher.mock.calls[0]![1]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      if (rejected) pending.reject(new TypeError('offline'));
      else pending.resolve(Response.json({ profile: userProfile() }));
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(onConflict).not.toHaveBeenCalled();
    expect(onBusy).toHaveBeenLastCalledWith(true);
  },
);

it('disables photo changes when requested but allows explicit animation playback', async () => {
  const avatar = profileAvatar();
  const { actor } = showEditor({ avatar, disabled: true });
  const section = screen.getByRole('region', { name: 'Profile photo' });
  const image = within(section).getByRole('presentation', { hidden: true });
  expect(image).toHaveAttribute('src', avatar.staticUrl);
  expect(screen.getByRole('button', { name: 'Change photo' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  await actor.click(screen.getByRole('button', { name: 'Play animation' }));
  expect(image).toHaveAttribute('src', avatar.url);
  await actor.click(screen.getByRole('button', { name: 'Pause animation' }));
  expect(image).toHaveAttribute('src', avatar.staticUrl);
});
