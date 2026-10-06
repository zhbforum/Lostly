import { StrictMode, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/features/auth/model/auth-context';
import { ApiError } from '@/shared/api/client';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import { deferred } from '@/test/deferred';
import { message } from '@/test/fixtures/conversations';
import { sendConversationMessage } from '../../api/conversations-api';
import { ConversationSendProvider } from '../../model/ConversationSendProvider';
import { useConversationSend } from '../../model/conversation-send-context';
import { readConversationDraft } from '../../model/message-drafts';
import { useMessageComposer } from '../../model/use-message-composer';
import {
  CONVERSATION_CONSTRAINTS,
  type ClaimMessage,
  type ClaimMessageResponse,
} from '../../model/types';
import { MessageBubble, PendingBubble } from '../MessageBubble/MessageBubble';
import { MessageComposer } from './MessageComposer';
import { SelectedImagePreviews } from './SelectedImagePreviews';
import {
  acceptMessageAttachments,
  type MessageAttachmentResource,
} from '../../model/attachment-resource';

vi.mock('../../api/conversations-api');
const auth = {
  user: { id: 'same-user', email: 'user@example.com', displayName: 'User', role: 'user' as const },
  status: 'authenticated' as const,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
};
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <AuthContext.Provider value={auth}>
        <ConversationSendProvider>{children}</ConversationSendProvider>
      </AuthContext.Provider>
    </StrictMode>
  );
}
let composer: ReturnType<typeof useMessageComposer>;
function Harness({ id = 'A' }: { id?: string }) {
  const current = useMessageComposer(id, true);
  useLayoutEffect(() => {
    composer = current;
  });
  const { subscribeToResults } = useConversationSend();
  const [sent, setSent] = useState<{
    message: ClaimMessage;
    resource: MessageAttachmentResource;
  } | null>(null);
  useEffect(
    () =>
      subscribeToResults((result) => {
        if (result.status === 'sent' && result.operation.conversationId === id)
          setSent({ message: result.message, resource: acceptMessageAttachments(result.message) });
      }),
    [id, subscribeToResults],
  );
  return (
    <>
      <MessageComposer composer={current} />
      {current.error && <p role="alert">{current.error}</p>}
      <ul>
        {current.operations.map((operation) => (
          <PendingBubble
            key={operation.operationId}
            operation={operation}
            seconds={current.retrySeconds(operation)}
            onRetry={() => void current.retry(operation.operationId)}
          />
        ))}
        {sent && (
          <MessageBubble
            message={sent.message}
            attachmentResource={sent.resource}
            onUnavailable={() => {}}
            own
            grouped={false}
            sender="User"
          />
        )}
      </ul>
    </>
  );
}

let created: Map<string, Blob>;
let revoked: Set<string>;
beforeEach(() => {
  vi.resetAllMocks();
  created = new Map();
  revoked = new Set();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn((file: Blob) => {
        const url = `blob:preview/${created.size}`;
        created.set(url, file);
        return url;
      });
      static revokeObjectURL = vi.fn((url: string) => {
        revoked.add(url);
      });
    },
  );
});
afterEach(() => {
  cleanup();
  expect([...created.keys()].every((url) => revoked.has(url))).toBe(true);
  vi.unstubAllGlobals();
});
const file = (name = 'private.jpg') => new File([name], name, { type: 'image/jpeg' });
const picker = () => screen.getByLabelText('Choose images') as HTMLInputElement;
const select = (files: File[]) => fireEvent.change(picker(), { target: { files } });
function previewUrls() {
  const urls = screen.queryAllByRole('img').map((img) => img.getAttribute('src')!);
  for (const url of urls) {
    expect(created.has(url)).toBe(true);
    expect(revoked.has(url)).toBe(false);
  }
  return urls;
}

it('allows image-only Send, exposes count/max and permits selecting the same file again after removal', async () => {
  const actor = userEvent.setup();
  render(<Harness />, { wrapper: Wrapper });
  expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled();
  expect(picker()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  const image = file();
  await actor.upload(picker(), image);
  expect(picker().value).toBe('');
  expect(screen.getByRole('button', { name: /Send/ })).toBeEnabled();
  expect(screen.getByRole('status', { name: '1 of 4 images selected' })).toHaveTextContent('1/4');
  await actor.click(screen.getByRole('button', { name: 'Remove image 1' }));
  await actor.upload(picker(), image);
  await actor.upload(picker(), image);
  expect(composer.draft.images).toHaveLength(2);
  expect(composer.draft.images[0]).toBe(image);
  expect(composer.draft.images[1]).toBe(image);
  select([file('second'), file('third')]);
  expect(picker()).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add photos' })).toBeDisabled();
  expect(previewUrls()).toHaveLength(4);
});

it('keeps existing files/previews on a rejected batch and associates the selection alert with the input', () => {
  render(<Harness />, { wrapper: Wrapper });
  const image = file();
  select([image]);
  const previous = composer.draft;
  const urls = previewUrls();
  select([file(), new File([], 'empty.png'), file()]);
  expect(composer.draft).toBe(previous);
  expect(previewUrls()).toEqual(urls);
  expect(screen.getByRole('alert')).toHaveTextContent('This image is empty.');
  expect(picker()).toHaveAttribute('aria-describedby', 'image-selection-error');
  expect(picker().value).toBe('');
  select([file(), file(), file(), file()]);
  expect(composer.draft).toBe(previous);
  expect(screen.getByRole('alert')).toHaveTextContent('You can attach up to 4 images.');
});

it('gives duplicate File occurrences independent URLs and revokes only the removed occurrence', () => {
  render(<Harness />, { wrapper: Wrapper });
  const image = file();
  select([image, image]);
  const [first, second] = previewUrls();
  expect(first).not.toBe(second);
  fireEvent.click(screen.getByRole('button', { name: 'Remove image 1' }));
  expect(revoked.has(first)).toBe(true);
  expect(previewUrls()).toEqual([second]);
  expect(composer.draft.images[0]).toBe(image);
  fireEvent.change(screen.getByLabelText('Write a message'), { target: { value: 'Caption' } });
  expect(previewUrls()).toEqual([second]);
});

it('releases replaced preview resources and disables remove while locked', () => {
  const remove = vi.fn(() => true);
  const view = render(
    <SelectedImagePreviews files={[file('A')]} disabled={false} onRemove={remove} />,
    { wrapper: StrictMode },
  );
  const before = previewUrls();
  view.rerender(<SelectedImagePreviews files={[file('B')]} disabled onRemove={remove} />);
  expect(before.every((url) => revoked.has(url))).toBe(true);
  expect(previewUrls()).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Remove image 1' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove image 1' }));
  expect(remove).not.toHaveBeenCalled();
});

it('keeps an empty-MIME file sendable even when its local preview cannot decode', () => {
  render(<Harness />, { wrapper: Wrapper });
  const unknown = new File(['Server must inspect bytes'], 'private');
  select([unknown]);
  fireEvent.error(screen.getByRole('img', { name: 'Selected image 1' }));
  expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Send/ })).toBeEnabled();
  expect(composer.draft.images[0]).toBe(unknown);
});

it('revokes previews on acceptance while registry owns files, and creates fresh URLs after rejection', async () => {
  const request = deferred<ClaimMessageResponse>();
  vi.mocked(sendConversationMessage).mockReturnValueOnce(request.promise);
  render(<Harness />, { wrapper: Wrapper });
  const images = [file('A'), file('B')];
  select(images);
  const before = previewUrls();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /Send/ })));
  expect(previewUrls()).toEqual([]);
  expect(before.every((url) => revoked.has(url))).toBe(true);
  expect(composer.draft).toEqual({ text: '', images: [] });
  images.forEach((image, index) => expect(composer.operations[0].images[index]).toBe(image));
  expect(screen.getByLabelText('Write a message')).toHaveAttribute('readonly');
  expect(picker()).toBeDisabled();
  expect(screen.getByText('2 photos')).toBeInTheDocument();
  await act(async () => request.reject(new ApiError(422, 'VALIDATION_ERROR', 'Bad image')));
  const after = previewUrls();
  expect(after).toHaveLength(2);
  expect(after.every((url) => !before.includes(url))).toBe(true);
  images.forEach((image, index) => expect(composer.draft.images[index]).toBe(image));
  expect(composer.operations).toEqual([]);
});

it('navigation revokes URLs, retains draft File refs and creates new URLs on returning', () => {
  const view = render(<Harness key="A" id="A" />, { wrapper: Wrapper });
  const image = file();
  select([image]);
  const before = previewUrls();
  view.rerender(<Harness key="B" id="B" />);
  expect(before.every((url) => revoked.has(url))).toBe(true);
  expect(previewUrls()).toEqual([]);
  expect(readConversationDraft('A').images[0]).toBe(image);
  view.rerender(<Harness key="A" id="A" />);
  const after = previewUrls();
  expect(after).toHaveLength(1);
  expect(before).not.toContain(after[0]);
  expect(composer.draft.images[0]).toBe(image);
});

it('restores a rejected image send after navigation without changing B, then creates fresh previews for A', async () => {
  const request = deferred<ClaimMessageResponse>();
  vi.mocked(sendConversationMessage).mockReturnValueOnce(request.promise);
  const view = render(<Harness key="A" id="A" />, { wrapper: Wrapper });
  const images = [file('A-1'), file('A-2')];
  select(images);
  fireEvent.change(screen.getByLabelText('Write a message'), {
    target: { value: ' Caption A\r\n ' },
  });
  const oldUrls = previewUrls();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /Send/ })));
  view.rerender(<Harness key="B" id="B" />);
  const imageB = file('Draft B');
  select([imageB]);
  const bUrls = previewUrls();
  await act(async () => request.reject(new ApiError(422, 'VALIDATION_ERROR', 'Rejected A')));
  expect(previewUrls()).toEqual(bUrls);
  expect(composer.draft.images[0]).toBe(imageB);
  expect(readConversationDraft('A').text).toBe('Caption A');
  images.forEach((image, index) => expect(readConversationDraft('A').images[index]).toBe(image));
  view.rerender(<Harness key="A" id="A" />);
  const restoredUrls = previewUrls();
  expect(restoredUrls).toHaveLength(2);
  expect(oldUrls.every((url) => revoked.has(url))).toBe(true);
  expect(restoredUrls.every((url) => !oldUrls.includes(url))).toBe(true);
  expect(composer.operations).toEqual([]);
  images.forEach((image, index) => expect(composer.draft.images[index]).toBe(image));
});

it('clears mounted state and previews on generation change, and ignores late old-session rejection', async () => {
  const request = deferred<ClaimMessageResponse>();
  vi.mocked(sendConversationMessage).mockReturnValueOnce(request.promise);
  render(<Harness />, { wrapper: Wrapper });
  const old = file('Old');
  select([old]);
  const urls = previewUrls();
  act(() => advanceSessionGeneration());
  expect(previewUrls()).toEqual([]);
  expect(urls.every((url) => revoked.has(url))).toBe(true);
  expect(composer.draft).toEqual({ text: '', images: [] });
  expect(readConversationDraft('A')).toEqual({ text: '', images: [] });
  select([old]);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /Send/ })));
  act(() => advanceSessionGeneration());
  expect(composer.operations).toEqual([]);
  const current = file('New session');
  select([current]);
  const newUrls = previewUrls();
  await act(async () => request.reject(new ApiError(422, 'VALIDATION_ERROR', 'Old error')));
  expect(previewUrls()).toEqual(newUrls);
  expect(composer.draft.images).toHaveLength(1);
  expect(composer.draft.images[0]).toBe(current);
  expect(readConversationDraft('A').images[0]).toBe(current);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['\0', '\ud800', 'x'.repeat(2001)])(
  'blocks invalid text + images for button and keyboard paths',
  async (text) => {
    render(<Harness />, { wrapper: Wrapper });
    select([file()]);
    const textarea = screen.getByLabelText('Write a message');
    fireEvent.change(textarea, { target: { value: text } });
    expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled();
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    await act(async () => {});
    expect(sendConversationMessage).not.toHaveBeenCalled();
    expect(composer.draft.images).toHaveLength(1);
  },
);

it('shows an exact count at the limit and a capped indicator for a huge draft', () => {
  const maxLength = CONVERSATION_CONSTRAINTS.messageMaxLength;
  render(<Harness />, { wrapper: Wrapper });
  select([file()]);
  const textarea = screen.getByLabelText('Write a message');
  fireEvent.change(textarea, { target: { value: '😀'.repeat(maxLength) } });
  expect(screen.getByText(`${maxLength} / ${maxLength}`)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Send/ })).toBeEnabled();
  expect(textarea).not.toHaveAttribute('aria-invalid');

  fireEvent.change(textarea, { target: { value: 'x'.repeat(100_000) } });
  expect(composer.count).toBe(maxLength + 1);
  expect(composer.overLimit).toBe(true);
  expect(screen.getByText(`${maxLength}+ / ${maxLength}`)).toBeInTheDocument();
  expect(screen.queryByText(`100000 / ${maxLength}`)).not.toBeInTheDocument();
  expect(textarea).toHaveAttribute('aria-describedby', 'message-count');
  expect(textarea).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled();

  fireEvent.change(textarea, { target: { value: 'x'.repeat(maxLength) } });
  expect(screen.getByText(`${maxLength} / ${maxLength}`)).toBeInTheDocument();
  expect(screen.queryByText(`${maxLength}+ / ${maxLength}`)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Send/ })).toBeEnabled();
});

it('preserves IME protection and Cmd+Enter after composition, with neutral rate-limit copy', async () => {
  vi.mocked(sendConversationMessage).mockRejectedValueOnce(
    new ApiError(429, 'RATE_LIMITED', 'Capacity', 3),
  );
  render(<Harness />, { wrapper: Wrapper });
  select([file()]);
  const textarea = screen.getByLabelText('Write a message');
  fireEvent.compositionStart(textarea);
  fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
  fireEvent.submit(textarea.closest('form')!);
  expect(sendConversationMessage).not.toHaveBeenCalled();
  fireEvent.compositionEnd(textarea);
  await act(async () => fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true }));
  expect(sendConversationMessage).toHaveBeenCalledOnce();
  expect(screen.getByText('Temporarily rate-limited.')).toBeInTheDocument();
  expect(screen.queryByText('Too many messages.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
});

it.each([null, 'Caption'])(
  'replaces pending photo text with persisted remote images: %j',
  async (body) => {
    const request = deferred<ClaimMessageResponse>();
    vi.mocked(sendConversationMessage).mockReturnValueOnce(request.promise);
    const attachments = [0, 1].map((position) => ({
      id: `image-${position}`,
      kind: 'image' as const,
      position,
      url: `https://private.example/${position}`,
      urlExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      width: 30,
      height: 20,
    }));
    render(<Harness />, { wrapper: Wrapper });
    select([file('A'), file('B')]);
    if (body)
      fireEvent.change(screen.getByLabelText('Write a message'), { target: { value: body } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Send/ })));
    expect(screen.getByText('2 photos')).toBeInTheDocument();
    expect(screen.getByText('Sending…')).toBeInTheDocument();
    await act(async () => request.resolve({ message: message(1, { body, attachments }) }));
    expect(screen.getByRole('group', { name: '2 photos' })).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Attached image 1 of 2' })).toHaveAttribute(
      'src',
      attachments[0].url,
    );
    if (body) expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    expect([...created.keys()].every((url) => revoked.has(url))).toBe(true);
    expect(composer.operations).toEqual([]);
  },
);
