import { useRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { deferred } from '@/test/deferred';
import { message } from '@/test/fixtures/conversations';
import { mockIntersectionObserver } from '@/test/intersection-observer';
import type { ClaimMessage } from './types';
import { useConversationRead } from './use-conversation-read';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function callbacks() {
  return { onRead: vi.fn(), onUnavailable: vi.fn(), reconcile: vi.fn(async () => {}) };
}

function Thread({
  messages,
  enabled = true,
  handlers,
}: {
  messages: ClaimMessage[];
  enabled?: boolean;
  handlers: ReturnType<typeof callbacks>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const { error, retry } = useConversationRead({
    conversationId: 'A',
    userId: 'me',
    messages,
    enabled,
    root,
    ...handlers,
  });
  return (
    <div ref={root} aria-label="Conversation messages">
      {messages.map((item) => (
        <p key={item.id} data-message-id={item.id}>
          {item.body}
        </p>
      ))}
      <p data-message-id="local-preview">Unconfirmed local message</p>
      {error && (
        <>
          <p role="alert">{error}</p>
          <button onClick={retry}>Retry read status</button>
        </>
      )}
    </div>
  );
}

it('marks only sufficiently visible incoming server messages as read', async () => {
  const observers = mockIntersectionObserver();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ lastReadSequence: 1, unreadCount: 2 }));
  vi.stubGlobal('fetch', fetcher);
  const handlers = callbacks();
  render(
    <Thread messages={[message(1), message(2, { senderUserId: 'me' })]} handlers={handlers} />,
  );
  const observer = observers[0]!;
  const incoming = screen.getByText('Message 1');
  expect(observer.root).toBe(screen.getByLabelText('Conversation messages'));
  expect([...observer.observed]).toEqual([incoming]);
  await act(async () => {
    observer.intersect(incoming, 23);
    observer.intersect(incoming, 24, 100, false);
    observer.intersect(screen.getByText('Message 2'));
    observer.intersect(screen.getByText('Unconfirmed local message'));
  });
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => observer.intersect(incoming));
  await waitFor(() =>
    expect(handlers.onRead).toHaveBeenCalledWith({ lastReadSequence: 1, unreadCount: 2 }),
  );
  expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe('/conversations/A/read');
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    method: 'POST',
    body: JSON.stringify({ messageId: 'message-1' }),
  });
  await act(async () => observer.intersect(incoming));
  expect(fetcher).toHaveBeenCalledOnce();
});

it('accepts a fully visible short message below the usual 24px threshold', async () => {
  const observers = mockIntersectionObserver();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ lastReadSequence: 1, unreadCount: 0 }));
  vi.stubGlobal('fetch', fetcher);
  const handlers = callbacks();
  render(<Thread messages={[message(1)]} handlers={handlers} />);
  await act(async () => observers[0]!.intersect(screen.getByText('Message 1'), 16, 16));
  await waitFor(() => expect(handlers.onRead).toHaveBeenCalledOnce());
});

it('requires fresh visibility evidence when returning from a hidden tab', async () => {
  const observers = mockIntersectionObserver();
  const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ lastReadSequence: 1, unreadCount: 0 }));
  vi.stubGlobal('fetch', fetcher);
  render(<Thread messages={[message(1)]} handlers={callbacks()} />);
  expect(observers).toHaveLength(0);
  await act(async () => {
    visibility.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const first = observers[0]!;
  await act(async () => {
    visibility.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    first.intersect(screen.getByText('Message 1'));
  });
  expect(first.disconnect).toHaveBeenCalledOnce();
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    visibility.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(observers).toHaveLength(2);
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => observers[1]!.intersect(screen.getByText('Message 1')));
  expect(fetcher).toHaveBeenCalledOnce();
});

it('exposes a retry for temporary read failures and clears the error on recovery', async () => {
  const observers = mockIntersectionObserver();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(Response.json({ lastReadSequence: 1, unreadCount: 0 }));
  vi.stubGlobal('fetch', fetcher);
  const actor = userEvent.setup();
  const handlers = callbacks();
  render(<Thread messages={[message(1)]} handlers={handlers} />);
  await act(async () => observers[0]!.intersect(screen.getByText('Message 1')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not update read status.');
  await act(async () => observers[0]!.intersect(screen.getByText('Message 1')));
  expect(fetcher).toHaveBeenCalledOnce();
  await actor.click(screen.getByRole('button', { name: 'Retry read status' }));
  await waitFor(() =>
    expect(handlers.onRead).toHaveBeenCalledWith({ lastReadSequence: 1, unreadCount: 0 }),
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('reconnects observations when messages change and aborts pending reads on unmount', async () => {
  const observers = mockIntersectionObserver();
  const pending = deferred<Response>();
  const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
  vi.stubGlobal('fetch', fetcher);
  const handlers = callbacks();
  const view = render(<Thread messages={[]} handlers={handlers} />);
  view.rerender(<Thread messages={[message(2)]} handlers={handlers} />);
  expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
  await act(async () => observers[1]!.intersect(screen.getByText('Message 2')));
  const signal = fetcher.mock.calls[0]![1]!.signal!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(observers[1]!.disconnect).toHaveBeenCalledOnce();
  await act(async () => {
    pending.resolve(Response.json({ lastReadSequence: 2, unreadCount: 0 }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(handlers.onRead).not.toHaveBeenCalled();
  expect(observers).toHaveLength(2);
});

it.each(['disabled', 'no observer'] as const)(
  'does not mark unseen messages as read when %s',
  async (mode) => {
    const observers = mockIntersectionObserver();
    if (mode === 'no observer') vi.stubGlobal('IntersectionObserver', undefined);
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    render(<Thread messages={[message(1)]} enabled={mode !== 'disabled'} handlers={callbacks()} />);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(observers).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  },
);
