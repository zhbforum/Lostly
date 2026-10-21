import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { decideClaim } from '@/features/claims/api/claims-api';
import * as api from '@/features/conversations/api/conversations-api';
import { ConversationSendProvider } from '@/features/conversations/model/ConversationSendProvider';
import { ConversationUnreadProvider } from '@/features/conversations/model/ConversationUnreadProvider';
import { ApiError } from '@/shared/api/client';
import { deferred } from '@/test/deferred';
import { claim } from '@/test/fixtures/claims';
import {
  conversation,
  conversationDetail,
  historyPage,
  inboxPage,
  message,
} from '@/test/fixtures/conversations';
import { mockIntersectionObserver } from '@/test/intersection-observer';
import { TestSession } from '@/test/session';
import { ConversationPage } from './ConversationPage';
import { MessagesPage } from './MessagesPage';

vi.mock('@/features/conversations/api/conversations-api');
vi.mock('@/features/claims/api/claims-api');

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  vi.mocked(api.getConversationInbox).mockResolvedValue(inboxPage([conversation('A')]));
  vi.mocked(api.getConversation).mockResolvedValue({
    conversation: conversationDetail({ participantRole: 'owner' }),
  });
  vi.mocked(api.getConversationMessages).mockResolvedValue(historyPage([]));
  vi.mocked(api.getUnreadConversationCount).mockResolvedValue({ unreadConversationCount: 0 });
});

afterEach(() => {
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('recovers a failed initial history load without making the conversation unavailable', async () => {
  const actor = userEvent.setup();
  vi.mocked(api.getConversationMessages)
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValue(historyPage([message(1)]));

  showConversation();

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load message history.');
  expect(screen.getByRole('textbox', { name: 'Write a message' })).toBeEnabled();
  expect(screen.getByRole('link', { name: /AirPods Pro/ })).toBeVisible();

  await actor.click(screen.getByRole('button', { name: 'Retry messages' }));

  expect(await screen.findByText('Message 1')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('This conversation is no longer available.')).not.toBeInTheDocument();
  expect(api.getConversationMessages).toHaveBeenCalledTimes(2);
});

it('keeps loaded history during a failed background poll and resumes from its confirmed cursor', async () => {
  vi.useFakeTimers();
  vi.mocked(api.getConversationMessages)
    .mockResolvedValueOnce(historyPage([message(5)]))
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValue(historyPage([message(6)]));

  await act(async () => {
    showConversation();
  });
  await act(() => vi.advanceTimersByTimeAsync(4000));

  const warning = screen.getByText('Could not check for new messages. We will try again.');

  expect(warning.parentElement).toHaveAttribute('role', 'status');
  expect(screen.getByText('Message 5')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry messages' })));

  expect(screen.getByText('Message 6')).toBeVisible();
  expect(screen.getByText('Message 5')).toBeVisible();
  expect(
    screen.queryByText('Could not check for new messages. We will try again.'),
  ).not.toBeInTheDocument();
  expect(api.getConversationMessages).toHaveBeenLastCalledWith(
    'A',
    { after: 5, limit: 100 },
    expect.any(AbortSignal),
  );
});

it('reloads history after a missing read target and waits for a newly visible server message', async () => {
  const observers = mockIntersectionObserver();
  vi.mocked(api.getConversationMessages)
    .mockResolvedValueOnce(historyPage([message(5)]))
    .mockResolvedValue(historyPage([message(6)]));
  vi.mocked(api.readConversation)
    .mockRejectedValueOnce(new ApiError(404, 'MESSAGE_NOT_FOUND', 'Message removed'))
    .mockResolvedValue({ lastReadSequence: 6, unreadCount: 0 });

  showConversation();

  const first = (await screen.findByText('Message 5')).closest('[data-message-id]')!;

  await waitFor(() =>
    expect(observers.some((observer) => observer.observed.has(first))).toBe(true),
  );

  // WHEN: the visible read target is missing on the server, reload history first.
  await act(async () =>
    observers.findLast((observer) => observer.observed.has(first))!.intersect(first),
  );

  const next = (await screen.findByText('Message 6')).closest('[data-message-id]')!;

  expect(screen.queryByText('Message 5')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Write a message' })).toBeEnabled();
  expect(screen.getByRole('link', { name: /AirPods Pro/ })).toBeVisible();
  expect(api.getConversationMessages).toHaveBeenLastCalledWith(
    'A',
    { limit: 50 },
    expect.any(AbortSignal),
  );
  expect(api.readConversation).toHaveBeenCalledOnce();
  await waitFor(() => expect(observers.some((observer) => observer.observed.has(next))).toBe(true));

  // THEN: only a newly visible server message can advance the read pointer.
  await act(async () =>
    observers.findLast((observer) => observer.observed.has(next))!.intersect(next),
  );

  expect(api.readConversation).toHaveBeenCalledTimes(2);
  expect(api.readConversation).toHaveBeenLastCalledWith('A', 'message-6', expect.any(AbortSignal));
});

it('retries an uncertain send through its pending bubble without duplicating the confirmed message', async () => {
  const actor = userEvent.setup();
  const confirmed = message(1, { senderUserId: 'alex', body: 'Can we meet at the library?' });
  const retry = deferred<Awaited<ReturnType<typeof api.sendConversationMessage>>>();
  vi.mocked(api.sendConversationMessage)
    .mockRejectedValueOnce(new TypeError('response lost'))
    .mockReturnValueOnce(retry.promise);

  showConversation();
  await actor.type(
    await screen.findByRole('textbox', { name: 'Write a message' }),
    confirmed.body!,
  );
  await actor.click(screen.getByRole('button', { name: 'Send' }));

  const retryButton = await screen.findByRole('button', { name: 'Retry to confirm' });

  expect(screen.getByText('Delivery status unknown')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Write a message' })).toHaveAttribute('readonly');

  const firstCall = vi.mocked(api.sendConversationMessage).mock.calls[0]!;

  // WHEN: the pending bubble retries, it must reuse the original payload and operation key.
  await actor.click(retryButton);

  expect(api.sendConversationMessage).toHaveBeenNthCalledWith(2, ...firstCall);
  expect(screen.queryByRole('button', { name: 'Retry to confirm' })).not.toBeInTheDocument();

  await act(async () => retry.resolve({ message: confirmed }));

  // THEN: confirmation replaces the pending bubble and unlocks the composer.
  expect(screen.getAllByText(confirmed.body!)).toHaveLength(1);
  expect(screen.queryByText('Delivery status unknown')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Write a message' })).toBeEnabled();
  expect(screen.getByRole('textbox', { name: 'Write a message' })).not.toHaveAttribute('readonly');
  expect(api.sendConversationMessage).toHaveBeenCalledTimes(2);
});

function showConversation() {
  return render(
    <MemoryRouter initialEntries={['/messages/A']}>
      <TestSession>
        <ConversationSendProvider>
          <ConversationUnreadProvider>
            <Routes>
              <Route path="/messages" element={<MessagesPage />}>
                <Route path=":conversationId" element={<ConversationPage />} />
              </Route>
            </Routes>
          </ConversationUnreadProvider>
        </ConversationSendProvider>
      </TestSession>
    </MemoryRouter>,
  );
}

it('propagates a visible message read to its inbox row and global unread badge', async () => {
  const observers = mockIntersectionObserver();
  vi.mocked(api.getConversationInbox).mockResolvedValue(
    inboxPage([conversation('A', { unreadCount: 2 })]),
  );
  vi.mocked(api.getConversationMessages).mockResolvedValue(historyPage([message(1)]));
  vi.mocked(api.getUnreadConversationCount)
    .mockResolvedValueOnce({ unreadConversationCount: 1 })
    .mockResolvedValue({ unreadConversationCount: 0 });
  vi.mocked(api.readConversation).mockResolvedValue({ lastReadSequence: 1, unreadCount: 0 });

  showConversation();

  expect(
    await screen.findByRole('link', { name: 'Messages, 1 unread conversation' }),
  ).toBeVisible();

  const row = await screen.findByRole('link', { name: /AirPods Pro.*2 unread messages/ });
  const body = await screen.findByText('Message 1');

  await waitFor(() => expect(observers.some((observer) => observer.observed.size > 0)).toBe(true));

  const target = body.closest('[data-message-id]')!;
  const observer = observers.findLast((item) => item.observed.has(target))!;

  expect(api.readConversation).not.toHaveBeenCalled();

  // WHEN: an incoming message actually enters the history viewport.
  vi.mocked(api.getConversationInbox).mockResolvedValue(
    inboxPage([conversation('A', { unreadCount: 0 })]),
  );

  await act(async () => observer.intersect(target));

  // THEN: the read response reconciles both the inbox row and the navigation badge.
  await waitFor(() => expect(row).not.toHaveTextContent('2 unread messages'));
  expect(api.readConversation).toHaveBeenCalledExactlyOnceWith(
    'A',
    'message-1',
    expect.any(AbortSignal),
  );
  expect(api.getUnreadConversationCount).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('link', { name: /Messages,.*unread/ })).not.toBeInTheDocument();
  expect(api.getConversation).toHaveBeenCalledTimes(2);
});

it('propagates approval to the conversation context, inbox and unread refresh', async () => {
  const actor = userEvent.setup();
  const approved = claim({
    status: 'approved',
    handoverDetails: 'Collect at the library.',
    reviewedAt: '2026-09-25T12:00:00.000Z',
  });
  vi.mocked(decideClaim).mockResolvedValue({ claim: approved });

  showConversation();
  await actor.click(await screen.findByRole('button', { name: 'Approve claim' }));
  await actor.type(
    screen.getByLabelText('Private collection instructions'),
    approved.handoverDetails!,
  );

  const detail = conversationDetail({ participantRole: 'owner' });
  vi.mocked(api.getConversation).mockResolvedValue({
    conversation: {
      ...detail,
      claim: { ...detail.claim, ...approved },
      listing: { ...detail.listing, status: 'resolved' },
    },
  });
  vi.mocked(api.getConversationInbox).mockResolvedValue(
    inboxPage([conversation('A', { claim: { id: approved.id, status: 'approved' } })]),
  );

  await actor.click(screen.getByRole('button', { name: 'Confirm approval' }));

  expect(decideClaim).toHaveBeenCalledExactlyOnceWith('claim-A', {
    decision: 'approved',
    handoverDetails: approved.handoverDetails,
  });
  expect(await screen.findByRole('heading', { name: 'Collection instructions' })).toBeVisible();
  expect(screen.getByText(approved.handoverDetails!)).toBeVisible();
  expect(screen.getByRole('link', { name: /AirPods Pro.*Claim approved/ })).toBeVisible();
  expect(api.getConversation).toHaveBeenCalledTimes(2);
  expect(api.getConversationInbox).toHaveBeenCalledTimes(2);
  expect(api.getUnreadConversationCount).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('reconciles a failed decision across context, inbox and global count without losing its draft', async () => {
  const actor = userEvent.setup();
  vi.mocked(decideClaim).mockRejectedValue(
    new ApiError(409, 'CLAIM_ALREADY_DECIDED', 'This claim was already reviewed.'),
  );

  showConversation();
  await actor.click(await screen.findByRole('button', { name: 'Approve claim' }));
  await actor.type(
    screen.getByLabelText('Private collection instructions'),
    'Collect at the library.',
  );
  await actor.click(screen.getByRole('button', { name: 'Confirm approval' }));

  const dialog = screen.getByRole('dialog');

  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'This claim was already reviewed.',
  );
  expect(within(dialog).getByLabelText('Private collection instructions')).toHaveValue(
    'Collect at the library.',
  );
  expect(api.getConversation).toHaveBeenCalledTimes(2);
  expect(api.getConversationInbox).toHaveBeenCalledTimes(2);
  expect(api.getUnreadConversationCount).toHaveBeenCalledTimes(2);

  await actor.click(screen.getByRole('button', { name: 'Refresh status' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.getConversation).toHaveBeenCalledTimes(3);
  expect(api.getConversationInbox).toHaveBeenCalledTimes(3);
  expect(api.getUnreadConversationCount).toHaveBeenCalledTimes(3);

  await actor.click(screen.getByRole('button', { name: 'Approve claim' }));

  expect(screen.getByLabelText('Private collection instructions')).toHaveValue(
    'Collect at the library.',
  );
  expect(decideClaim).toHaveBeenCalledOnce();
});
