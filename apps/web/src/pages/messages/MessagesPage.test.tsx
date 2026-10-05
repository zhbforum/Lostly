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
import { deferred } from '@/test/deferred';
import {
  conversation,
  conversationDetail,
  historyPage,
  inboxPage,
  messagePreview,
} from '@/test/fixtures/conversations';
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
