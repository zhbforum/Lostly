import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppRouter } from '@/app/router/AppRouter';
import { AuthContext } from '@/features/auth/model/auth-context';
import { ConversationUnreadProvider } from '@/features/conversations/model/ConversationUnreadProvider';
import { ConversationSendProvider } from '@/features/conversations/model/ConversationSendProvider';
import * as api from '@/features/conversations/api/conversations-api';
import type { ConversationInboxResponse } from '@/features/conversations/model/types';
import { ApiError } from '@/shared/api/client';
import { readConversationDraft } from '@/features/conversations/model/message-drafts';
import { deferred } from '@/test/deferred';
import {
  conversation,
  conversationDetail,
  historyPage,
  inboxPage,
  messagePreview,
  message,
} from '@/test/fixtures/conversations';
import { attachment, renewed } from '@/test/fixtures/conversation-attachments';
import { ConversationPage } from './ConversationPage';
import { MessagesEmptyRoute } from './MessagesEmptyRoute';
import { MessagesPage } from './MessagesPage';

vi.mock('@/features/conversations/api/conversations-api');
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getUnreadConversationCount).mockResolvedValue({ unreadConversationCount: 2 });
  vi.mocked(api.getConversation).mockImplementation(async (id) => ({
    conversation: conversationDetail({ id, canSendMessages: id !== 'B' }),
  }));
  vi.mocked(api.getConversationMessages).mockResolvedValue(historyPage([]));
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const user = { id: 'user', email: 'alex@example.com', displayName: 'Alex', role: 'user' as const };
function Position() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Current URL">{location.pathname}</output>
      <button onClick={() => void navigate(-1)}>Browser back</button>
    </>
  );
}
function renderMessages(
  path = '/messages',
  options: { probe?: boolean; guest?: boolean; previousPath?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={options.previousPath ? [options.previousPath, path] : [path]}>
      <AuthContext.Provider
        value={{
          user: options.guest ? null : user,
          status: options.guest ? 'unauthenticated' : 'authenticated',
          login: async () => {},
          register: async () => {},
          logout: async () => {},
          updateProfile: () => {},
        }}
      >
        <ConversationSendProvider>
          <ConversationUnreadProvider>
            {options.probe ? (
              <Routes>
                <Route path="/messages" element={<MessagesPage />}>
                  <Route index element={<MessagesEmptyRoute />} />
                  <Route path=":conversationId" element={<ConversationPage />} />
                </Route>
              </Routes>
            ) : (
              <AppRouter />
            )}
            <Position />
          </ConversationUnreadProvider>
        </ConversationSendProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

it('loads the inbox with item/participant/preview/unread states and keeps it mounted between details', async () => {
  vi.mocked(api.getConversationInbox).mockResolvedValue(
    inboxPage([
      conversation('A', {
        unreadCount: 3,
        lastMessage: messagePreview(1, { body: 'Can we meet tomorrow?' }),
      }),
      conversation('B', {
        listing: { ...conversation().listing, title: 'Blue backpack' },
        claim: { id: 'claim-B', status: 'rejected' },
        canSendMessages: false,
      }),
    ]),
  );
  const actor = userEvent.setup();
  renderMessages();
  const a = await screen.findByRole('link', {
    name: /AirPods Pro.*Alex.*3 unread messages.*Can we meet tomorrow/,
  });
  expect(screen.getByRole('heading', { name: 'Select a conversation' })).toBeInTheDocument();
  expect(
    await screen.findByRole('link', { name: 'Messages, 2 unread conversations' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Claim submitted · No messages yet')).toBeInTheDocument();
  const scroll = screen.getByTestId('inbox-scroll');
  scroll.scrollTop = 240;
  await actor.click(a);
  expect(screen.getByLabelText('Current URL')).toHaveTextContent('/messages/A');
  expect(a).toHaveAttribute('aria-current', 'page');
  await actor.click(screen.getByRole('link', { name: /Blue backpack.*Read-only/ }));
  expect(screen.getByLabelText('Current URL')).toHaveTextContent('/messages/B');
  expect(screen.getByTestId('inbox-scroll')).toBe(scroll);
  expect(scroll.scrollTop).toBe(240);
  expect(api.getConversationInbox).toHaveBeenCalledOnce();
  expect(await screen.findByText('This conversation is read-only.')).toBeInTheDocument();
  for (const request of [api.readConversation, api.sendConversationMessage])
    expect(request).not.toHaveBeenCalled();
});

it('renders latest, older and catch-up attachments without inbox refreshes or changing read/scroll state on URL renewal', async () => {
  vi.useFakeTimers();
  const images = [attachment()];
  vi.mocked(api.getConversationInbox).mockResolvedValue(
    inboxPage([
      conversation('A', { lastMessage: messagePreview(50, { body: null, attachmentCount: 1 }) }),
    ]),
  );
  vi.mocked(api.getConversationMessages).mockImplementation(async (_id, query) => {
    if (query?.before) return historyPage([message(49, { body: null, attachments: images })]);
    if (query?.after === 50)
      return historyPage([message(51, { body: 'New caption', attachments: images })]);
    if (query?.after) return historyPage([]);
    return historyPage([message(50, { body: null, attachments: images })], true);
  });
  await act(async () => {
    renderMessages('/messages/A', { probe: true });
  });
  const history = screen.getByRole('region', { name: 'Message history' });
  expect(within(history).getAllByRole('img')).toHaveLength(1);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' })),
  );
  expect(within(history).getAllByRole('img')).toHaveLength(2);
  await act(() => vi.advanceTimersByTimeAsync(4_000));
  expect(within(history).getAllByRole('img')).toHaveLength(3);
  expect(within(history).getByText('New caption')).toBeInTheDocument();
  expect(api.refreshMessageAttachments).not.toHaveBeenCalled();
  const before = history.querySelector('[data-message-id="message-50"]')!;
  const getUnreadCalls = vi.mocked(api.getUnreadConversationCount).mock.calls.length;
  const getInboxCalls = vi.mocked(api.getConversationInbox).mock.calls.length;
  const scrollCalls = vi.mocked(history.scrollTo).mock.calls.length;
  vi.mocked(api.refreshMessageAttachments).mockResolvedValueOnce({ attachments: renewed(images) });
  await act(async () => fireEvent.error(before.querySelector('img')!));
  expect(api.refreshMessageAttachments).toHaveBeenCalledExactlyOnceWith('A', 'message-50');
  expect(history.querySelector('[data-message-id="message-50"]')).toBe(before);
  expect(before.querySelector('img')).toHaveAttribute('src', `${images[0].url}-renewed`);
  expect(vi.mocked(history.scrollTo).mock.calls.length).toBe(scrollCalls);
  expect(api.readConversation).not.toHaveBeenCalled();
  expect(api.getUnreadConversationCount).toHaveBeenCalledTimes(getUnreadCalls);
  expect(api.getConversationInbox).toHaveBeenCalledTimes(getInboxCalls);
});

it.each([
  { body: null, images: 1, incoming: 1, expected: '1 new message. Photo' },
  { body: null, images: 4, incoming: 1, expected: '1 new message. 4 photos' },
  { body: null, images: 2, incoming: 2, expected: '2 new messages. 2 photos' },
  { body: 'New caption', images: 2, incoming: 1, expected: '1 new message. New caption' },
  { body: 'Just text', images: 0, incoming: 1, expected: '1 new message. Just text' },
])('announces incoming messages as "$expected" in the live region', async (entry) => {
  vi.useFakeTimers();
  vi.mocked(api.getConversationInbox).mockResolvedValue(inboxPage([conversation('A')]));
  vi.mocked(api.getConversationMessages).mockImplementation(async (_id, query) => {
    if (query?.after === 1)
      return historyPage(
        Array.from({ length: entry.incoming }, (_, index) =>
          message(index + 2, {
            body: entry.body,
            attachments: Array.from({ length: entry.images }, (_image, position) =>
              attachment(position),
            ),
          }),
        ),
      );
    if (query?.after) return historyPage([]);
    return historyPage([message(1, { body: null, attachments: [attachment()] })]);
  });
  await act(async () => {
    renderMessages('/messages/A', { probe: true });
  });
  const announcer = screen.getByTestId('message-announcer');
  expect(announcer).toHaveAttribute('aria-live', 'polite');
  expect(announcer.textContent).toBe('');
  await act(() => vi.advanceTimersByTimeAsync(4_000));
  expect(announcer.textContent).toBe(entry.expected);
  const announced = announcer.firstChild;
  await act(() => vi.advanceTimersByTimeAsync(4_000));
  expect(announcer.firstChild).toBe(announced);
});

it('routes a refresh CONVERSATION_NOT_FOUND through the existing unavailable flow', async () => {
  vi.useFakeTimers();
  vi.mocked(api.getConversationInbox).mockResolvedValue(inboxPage([conversation('A')]));
  vi.mocked(api.getConversationMessages).mockResolvedValue(
    historyPage([message(1, { body: null, attachments: [attachment()] })]),
  );
  vi.mocked(api.refreshMessageAttachments).mockRejectedValueOnce(
    new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Hidden'),
  );
  await act(async () => {
    renderMessages('/messages/A', { probe: true });
  });
  const history = screen.getByRole('region', { name: 'Message history' });
  await act(async () => fireEvent.error(within(history).getByRole('img')));
  expect(
    screen.getByRole('heading', { name: 'This conversation is no longer available.' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Message history' })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Write a message' })).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(api.refreshMessageAttachments).toHaveBeenCalledOnce();
});

it('does not fetch attachment URLs for image-only inbox previews', async () => {
  vi.mocked(api.getConversationInbox).mockResolvedValue(
    inboxPage([
      conversation('A', { lastMessage: messagePreview(1, { body: null, attachmentCount: 4 }) }),
    ]),
  );
  renderMessages('/messages', { probe: true });
  expect(await screen.findByRole('link', { name: /4 photos/ })).toBeInTheDocument();
  expect(api.refreshMessageAttachments).not.toHaveBeenCalled();
  expect(api.getConversationMessages).not.toHaveBeenCalled();
});

it('shows initial loading, error/retry and the empty inbox', async () => {
  const page = deferred<ConversationInboxResponse>();
  vi.mocked(api.getConversationInbox)
    .mockReturnValueOnce(page.promise)
    .mockResolvedValueOnce(inboxPage([]));
  const actor = userEvent.setup();
  renderMessages();
  expect(await screen.findByText('Loading conversations…')).toBeInTheDocument();
  expect(screen.getByTestId('inbox-scroll')).toHaveAttribute('aria-busy', 'true');
  await act(async () => page.reject(new Error('Offline')));
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load your conversations.');
  await actor.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'No conversations yet' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
});

it('appends older inbox rows after a recoverable load-more failure', async () => {
  vi.mocked(api.getConversationInbox)
    .mockResolvedValueOnce(inboxPage([conversation('A')], 'page-2'))
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(
      inboxPage([conversation('B', { listing: { ...conversation().listing, title: 'Camera' } })]),
    );
  const actor = userEvent.setup();
  renderMessages();
  await actor.click(await screen.findByRole('button', { name: 'Load more' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load more conversations.');
  await actor.click(screen.getByRole('button', { name: 'Retry loading more' }));
  expect(await screen.findByRole('link', { name: /Camera/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /AirPods Pro/ })).toBeInTheDocument();
});

it('announces background refresh failures politely while keeping the loaded inbox usable', async () => {
  vi.useFakeTimers();
  vi.mocked(api.getConversationInbox)
    .mockResolvedValueOnce(inboxPage([conversation('A')]))
    .mockRejectedValue(new Error('Offline'));
  await act(async () => {
    renderMessages('/messages', { probe: true });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  const inbox = within(screen.getByRole('region', { name: 'Messages' }));
  expect(inbox.getByRole('status')).toHaveTextContent(
    'Could not refresh messages. Your conversations are still available.',
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /AirPods Pro/ })).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(inbox.getAllByRole('status')).toHaveLength(1);
});

it('returns to the existing inbox entry, restores row focus and does not reopen the detail on Back', async () => {
  vi.mocked(api.getConversationInbox).mockResolvedValue(inboxPage([conversation('A')]));
  const actor = userEvent.setup();
  renderMessages('/messages', { previousPath: '/' });
  const row = await screen.findByRole('link', { name: /AirPods Pro/ });
  await actor.click(row);
  await actor.click(screen.getByRole('link', { name: 'Messages' }));
  expect(screen.getByLabelText('Current URL')).toHaveTextContent(/^\/messages$/);
  expect(row).toHaveFocus();
  await actor.click(screen.getByRole('button', { name: 'Browser back' }));
  expect(screen.getByLabelText('Current URL')).toHaveTextContent(/^\/$/);
});

it.each(['A', 'not-loaded'])(
  'replaces a cold detail entry for %s and focuses its row or the inbox heading',
  async (id) => {
    vi.mocked(api.getConversationInbox).mockResolvedValue(inboxPage([conversation('A')]));
    const actor = userEvent.setup();
    renderMessages(`/messages/${id}`, { previousPath: '/' });
    const row = await screen.findByRole('link', { name: /AirPods Pro/ });
    await actor.click(screen.getByRole('link', { name: 'Messages' }));
    expect(screen.getByLabelText('Current URL')).toHaveTextContent(/^\/messages$/);
    expect(id === 'A' ? row : screen.getByRole('heading', { name: 'Messages' })).toHaveFocus();
    await actor.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(screen.getByLabelText('Current URL')).toHaveTextContent(/^\/$/);
  },
);

it('does not declare a deep-linked conversation unavailable just because it is absent from page one', async () => {
  vi.mocked(api.getConversationInbox).mockResolvedValue(inboxPage([conversation('A')]));
  renderMessages('/messages/not-on-first-page');
  expect(await screen.findByRole('textbox', { name: 'Write a message' })).toBeInTheDocument();
  expect(screen.queryByText('This conversation is no longer available.')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Current URL')).toHaveTextContent('/messages/not-on-first-page');
});

it('only removes confirmed unavailable conversations and refreshes the global count', async () => {
  vi.mocked(api.getConversationInbox)
    .mockResolvedValueOnce(inboxPage([conversation('A')]))
    .mockResolvedValue(inboxPage([]));
  vi.mocked(api.getConversation)
    .mockRejectedValueOnce(new ApiError(404, 'MESSAGE_NOT_FOUND', 'Missing message'))
    .mockRejectedValueOnce(new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Unavailable'));
  const actor = userEvent.setup();
  renderMessages('/messages/A', { probe: true });
  await screen.findByRole('link', { name: /AirPods Pro/ });
  await screen.findByRole('button', { name: 'Retry details' });
  expect(screen.getByRole('link', { name: /AirPods Pro/ })).toBeInTheDocument();
  expect(api.getConversationInbox).toHaveBeenCalledTimes(1);
  await actor.click(screen.getByRole('button', { name: 'Retry details' }));
  expect(api.getConversationInbox).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('link', { name: /AirPods Pro/ })).not.toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'This conversation is no longer available.' }),
  ).toBeInTheDocument();
  expect(api.getUnreadConversationCount).toHaveBeenCalledTimes(2);
  await actor.click(screen.getByRole('button', { name: 'Back to messages' }));
  expect(screen.getByLabelText('Current URL')).toHaveTextContent(/^\/messages$/);
  expect(screen.getByRole('heading', { name: 'Messages' })).toHaveFocus();
});

it('guards message routes for guests without requesting private conversation data', async () => {
  renderMessages('/messages/A', { guest: true });
  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  expect(screen.getByLabelText('Current URL')).toHaveTextContent('/login');
  expect(api.getConversationInbox).not.toHaveBeenCalled();
  expect(api.getUnreadConversationCount).not.toHaveBeenCalled();
});

it('keeps a failed cover decorative while retaining the accessible item title', async () => {
  vi.mocked(api.getConversationInbox).mockResolvedValue(
    inboxPage([
      conversation('A', {
        listing: {
          ...conversation().listing,
          coverImage: {
            id: 'photo',
            url: 'https://images.example.com/expired.webp',
            urlExpiresAt: '2026-09-25T10:00:00Z',
            position: 0,
            width: 100,
            height: 100,
          },
        },
      }),
    ]),
  );
  renderMessages();
  const inbox = await screen.findByRole('region', { name: 'Messages' });
  expect(await within(inbox).findByRole('link', { name: /AirPods Pro/ })).toBeInTheDocument();
  const image = inbox.querySelector('img')!;
  expect(image).toHaveAttribute('alt', '');
  fireEvent.error(image);
  expect(inbox.querySelector('img')).toBeNull();
  expect(within(inbox).getByRole('link', { name: /AirPods Pro/ })).toBeInTheDocument();
  expect(within(inbox).queryByRole('img')).not.toBeInTheDocument();
});

it('shows restored unsent photos after a definitive read-only send rejection', async () => {
  vi.mocked(api.getConversationInbox).mockResolvedValue(inboxPage([conversation('A')]));
  vi.mocked(api.getConversation)
    .mockResolvedValueOnce({ conversation: conversationDetail() })
    .mockResolvedValue({
      conversation: conversationDetail({
        canSendMessages: false,
        claim: { ...conversationDetail().claim, status: 'rejected' },
      }),
    });
  vi.mocked(api.sendConversationMessage).mockRejectedValueOnce(
    new ApiError(409, 'CONVERSATION_READ_ONLY', 'Read only'),
  );
  const createUrl = vi.fn(() => 'blob:unsent-photo');
  const revokeUrl = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revokeUrl;
    },
  );
  try {
    renderMessages('/messages/A', { probe: true });
    const textarea = await screen.findByRole('textbox', { name: 'Write a message' });
    const images = [
      new File(['A'], 'A.jpg', { type: 'image/jpeg' }),
      new File(['B'], 'B.png', { type: 'image/png' }),
    ];
    fireEvent.change(textarea, { target: { value: ' Caption\r\n ' } });
    fireEvent.change(screen.getByLabelText('Choose images'), { target: { files: images } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    const readonly = await screen.findByRole('region', { name: 'Read-only conversation' });
    expect(readonly).toHaveTextContent('Your unsent draft has been kept');
    expect(readonly).toHaveTextContent('2 unsent photos attached.');
    expect(within(readonly).getByLabelText('Unsent draft')).toHaveValue('Caption');
    images.forEach((image, index) => expect(readConversationDraft('A').images[index]).toBe(image));
    expect(revokeUrl).toHaveBeenCalled();
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});
