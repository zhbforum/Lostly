import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import { deferred } from '@/test/deferred';
import { message } from '@/test/fixtures/conversations';
import { attachment, renewed } from '@/test/fixtures/conversation-attachments';
import { refreshMessageAttachments } from '../../api/conversations-api';
import { acceptMessageAttachments } from '../../model/attachment-resource';
import type { RefreshMessageAttachmentsResponse } from '../../model/types';
import { MessageAttachments } from './MessageAttachments';
import { MessageBubble } from '../MessageBubble/MessageBubble';

vi.mock('../../api/conversations-api');
const unavailable = vi.fn();
let observers: Observer[];
class Observer {
  target: Element | null = null;
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }
  observe(target: Element) {
    this.target = target;
  }
  disconnect() {
    this.target = null;
  }
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-05T15:00:00Z');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  observers = [];
  vi.stubGlobal('IntersectionObserver', Observer);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function activate(active = true) {
  act(() => {
    for (const observer of observers)
      if (observer.target)
        observer.callback(
          [{ target: observer.target, isIntersecting: active } as IntersectionObserverEntry],
          observer as unknown as IntersectionObserver,
        );
  });
}
function visibility(visible: boolean) {
  act(() => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visible ? 'visible' : 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
function setup(images = [attachment()]) {
  const resource = acceptMessageAttachments(message(1, { attachments: images }));
  const view = render(<MessageAttachments resource={resource} onUnavailable={unavailable} />, {
    wrapper: StrictMode,
  });
  return { resource, ...view };
}
const flush = () => act(async () => {});

it.each([1, 2, 3, 4])(
  'renders %i images ordered by position with safe attributes and stable dimensions',
  (count) => {
    const attachments = Array.from({ length: count }, (_, position) => attachment(position));
    setup([...attachments].reverse());
    expect(screen.getAllByRole('img')).toHaveLength(count);
    screen.getAllByRole('img').forEach((image, index) => {
      expect(image).toHaveAttribute('src', attachments[index].url);
      expect(image).toHaveAttribute('alt', `Attached image ${index + 1} of ${count}`);
      expect(image).toHaveAttribute('width', '600');
      expect(image).toHaveAttribute('height', '400');
      expect(image).toHaveAttribute('loading', 'lazy');
      expect(image).toHaveAttribute('decoding', 'async');
      expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
      expect(image).not.toHaveAttribute('crossorigin');
      const link = image.closest('a')!;
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    });
    activate();
    expect(refreshMessageAttachments).not.toHaveBeenCalled();
  },
);

it.each([null, 'Caption'])('renders body %j with images without an empty paragraph', (body) => {
  const persisted = message(1, { body, attachments: [attachment()] });
  const resource = acceptMessageAttachments(persisted);
  const { container } = render(
    <ul>
      <MessageBubble
        message={persisted}
        attachmentResource={resource}
        onUnavailable={unavailable}
        own={false}
        grouped={false}
        sender="Alex"
      />
    </ul>,
  );
  expect(screen.getByRole('img')).toBeInTheDocument();
  if (body) expect(screen.getByText(body)).toBeInTheDocument();
  else expect(container.querySelector('p')).toBeNull();
});

it.each([
  { count: 1, width: 1, height: 2048, ratio: 0.5 },
  { count: 1, width: 2048, height: 1, ratio: 2 },
  { count: 4, width: 1, height: 2048, ratio: 0.5 },
  { count: 4, width: 2048, height: 1, ratio: 2 },
])(
  'bounds $width × $height presentation in a $count-image layout without changing intrinsic dimensions',
  ({ count, width, height, ratio }) => {
    const images = Array.from({ length: count }, (_, position) => attachment(position));
    images[0] = attachment(0, { width, height });
    setup(images);
    const image = screen.getByRole('img', { name: `Attached image 1 of ${count}` });
    const cell = image.closest('a')!.parentElement!;
    const displayRatio = () => {
      const [numerator, denominator = 1] = cell.style.aspectRatio.split('/').map(Number);
      return numerator / denominator;
    };
    expect(displayRatio()).toBe(ratio);
    expect(cell.style.aspectRatio).not.toBe(`${width} / ${height}`);
    expect(image).toHaveAttribute('width', String(width));
    expect(image).toHaveAttribute('height', String(height));
    fireEvent.error(image);
    expect(displayRatio()).toBe(ratio);
    expect(cell).toHaveTextContent('Photo unavailable');
  },
);

it('does not show Retry images when an old refresh fails after the replacement group fully recovers', async () => {
  const images = [attachment(), attachment(1)];
  const late = deferred<RefreshMessageAttachmentsResponse>();
  vi.mocked(refreshMessageAttachments).mockReturnValueOnce(late.promise);
  const { resource } = setup(images);
  activate();
  fireEvent.error(screen.getAllByRole('img')[1]);
  await flush();
  expect(refreshMessageAttachments).toHaveBeenCalledOnce();
  act(() => resource.ingest(renewed(images, 30 * 60_000)));
  act(() => screen.getAllByRole('img').forEach((image) => fireEvent.load(image)));
  expect(resource.getSnapshot()).toMatchObject({ automaticAvailable: true, retryable: false });
  const recoveredImages = screen.getAllByRole('img');
  await act(async () => late.reject(new TypeError('Offline')));
  expect(screen.queryByRole('button', { name: 'Retry images' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('img')).toEqual(recoveredImages);
  expect(refreshMessageAttachments).toHaveBeenCalledOnce();
});

it('renders no group for a text-only message and never refreshes it', async () => {
  setup([]);
  activate();
  await flush();
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
  expect(refreshMessageAttachments).not.toHaveBeenCalled();
});

it('defers near-expiry refresh offscreen and while hidden, then renews on activation', async () => {
  const images = [attachment(0, { urlExpiresAt: new Date(Date.now() + 30_000).toISOString() })];
  vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({ attachments: renewed(images) });
  setup(images);
  expect(screen.getByRole('img')).toHaveAttribute('src', images[0].url);
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(refreshMessageAttachments).not.toHaveBeenCalled();
  visibility(false);
  activate();
  await flush();
  expect(refreshMessageAttachments).not.toHaveBeenCalled();
  visibility(true);
  await flush();
  expect(refreshMessageAttachments).toHaveBeenCalledOnce();
  expect(screen.getByRole('img')).toHaveAttribute('src', `${images[0].url}-renewed`);
});

it.each(['2026-10-05T14:00:00Z', 'invalid'])(
  'never renders expired/invalid capability %s before recovery',
  async (urlExpiresAt) => {
    const pending = deferred<RefreshMessageAttachmentsResponse>();
    vi.mocked(refreshMessageAttachments).mockReturnValueOnce(pending.promise);
    const { container } = setup([attachment(0, { urlExpiresAt })]);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    activate();
    await flush();
    expect(refreshMessageAttachments).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ attachments: [attachment()] }));
    expect(container.querySelector('img')).not.toBeNull();
  },
);

it('falls back to active without IntersectionObserver', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({ attachments: [attachment()] });
  setup([attachment(0, { urlExpiresAt: 'invalid' })]);
  await flush();
  expect(refreshMessageAttachments).toHaveBeenCalledOnce();
});

it('removes expired URLs on an offscreen rerender without minting new capabilities', async () => {
  const { resource, rerender, container } = setup();
  expect(container.querySelector('img')).not.toBeNull();
  vi.setSystemTime(Date.now() + 16 * 60_000);
  rerender(<MessageAttachments resource={resource} onUnavailable={unavailable} />);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('a')).toBeNull();
  await flush();
  expect(refreshMessageAttachments).not.toHaveBeenCalled();
});

it('coalesces four simultaneous errors and explicit retry into one POST', async () => {
  const pending = deferred<RefreshMessageAttachmentsResponse>();
  vi.mocked(refreshMessageAttachments).mockReturnValueOnce(pending.promise);
  const images = [0, 1, 2, 3].map((position) => attachment(position));
  const { resource } = setup(images);
  activate();
  act(() => screen.getAllByRole('img').forEach((image) => fireEvent.error(image)));
  await flush();
  const first = resource.recover(true);
  expect(resource.recover(true)).toBe(first);
  expect(refreshMessageAttachments).toHaveBeenCalledOnce();
  await act(async () => pending.resolve({ attachments: renewed(images, 30 * 60_000) }));
  expect(screen.getAllByRole('link')).toHaveLength(4);
  screen
    .getAllByRole('link')
    .forEach((link, index) => expect(link).toHaveAttribute('href', `${images[index].url}-renewed`));
});

it('coalesces a near-expiry timer with an image error, retaining healthy siblings during refresh', async () => {
  const pending = deferred<RefreshMessageAttachmentsResponse>();
  vi.mocked(refreshMessageAttachments).mockReturnValueOnce(pending.promise);
  const images = [
    attachment(0, { urlExpiresAt: new Date(Date.now() + 61_000).toISOString() }),
    attachment(1),
  ];
  const { container } = setup(images);
  activate();
  fireEvent.load(screen.getAllByRole('img')[1]);
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  fireEvent.error(container.querySelector('img')!);
  await flush();
  expect(refreshMessageAttachments).toHaveBeenCalledOnce();
  expect(container.querySelector('img')).toHaveAttribute('src', images[1].url);
  await act(async () => pending.reject(new Error('Offline')));
  expect(container.querySelector('img')).toHaveAttribute('src', images[1].url);
  expect(screen.getByRole('button', { name: 'Retry images' })).toBeInTheDocument();
});

it('does not mint capabilities for late offscreen errors until active and visible', async () => {
  vi.mocked(refreshMessageAttachments).mockRejectedValueOnce(new Error('Offline'));
  setup();
  activate();
  activate(false);
  fireEvent.error(screen.getByRole('img'));
  await flush();
  expect(refreshMessageAttachments).not.toHaveBeenCalled();
  visibility(false);
  activate();
  await flush();
  expect(refreshMessageAttachments).not.toHaveBeenCalled();
  visibility(true);
  await flush();
  expect(refreshMessageAttachments).toHaveBeenCalledOnce();
});

it('keeps an already-started refresh valid when the group leaves the viewport', async () => {
  const pending = deferred<RefreshMessageAttachmentsResponse>();
  vi.mocked(refreshMessageAttachments).mockReturnValueOnce(pending.promise);
  const { resource } = setup([attachment(0, { urlExpiresAt: 'invalid' })]);
  activate();
  await flush();
  activate(false);
  visibility(false);
  const replacement = attachment();
  await act(async () => pending.resolve({ attachments: [replacement] }));
  expect(resource.getSnapshot().attachments).toEqual([replacement]);
});

it('stops broken replacement loops despite successful sibling loads, then allows manual retry', async () => {
  const images = [attachment(), attachment(1)];
  vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({
    attachments: renewed(images, 30 * 60_000),
  });
  setup(images);
  activate();
  fireEvent.error(screen.getAllByRole('img')[1]);
  await flush();
  fireEvent.load(screen.getAllByRole('img')[0]);
  fireEvent.error(screen.getAllByRole('img')[1]);
  activate(false);
  activate();
  visibility(false);
  visibility(true);
  await flush();
  expect(refreshMessageAttachments).toHaveBeenCalledOnce();
  vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({
    attachments: renewed(images, 45 * 60_000),
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry images' }));
  await flush();
  expect(refreshMessageAttachments).toHaveBeenCalledTimes(2);
  screen.getAllByRole('img').forEach((image) => fireEvent.load(image));
  vi.mocked(refreshMessageAttachments).mockRejectedValueOnce(new Error('Offline again'));
  fireEvent.error(screen.getAllByRole('img')[1]);
  await flush();
  expect(refreshMessageAttachments).toHaveBeenCalledTimes(3);
});

it('ignores events from replaced DOM resources and preserves nodes for equal-expiry responses', async () => {
  const images = [attachment()];
  const { resource } = setup(images);
  const old = screen.getByRole('img');
  act(() => resource.ingest([attachment(0, { url: 'ignored-equal-expiry' })]));
  expect(screen.getByRole('img')).toBe(old);
  act(() => resource.ingest(renewed(images, 30 * 60_000)));
  const next = screen.getByRole('img');
  expect(next).not.toBe(old);
  activate();
  fireEvent.error(old);
  fireEvent.load(old);
  await flush();
  expect(resource.getSnapshot().failed).toEqual([]);
  expect(refreshMessageAttachments).not.toHaveBeenCalled();
});

it.each(['failure', 'equal', 'near', 'expired', 'invalid'])(
  'terminates expiry recovery after %s without visibility/rerender loops and removes URLs on expiry',
  async (kind) => {
    const images = [attachment(0, { urlExpiresAt: new Date(Date.now() + 10_000).toISOString() })];
    if (kind === 'failure')
      vi.mocked(refreshMessageAttachments).mockRejectedValueOnce(new Error('Offline'));
    else
      vi.mocked(refreshMessageAttachments).mockResolvedValueOnce({
        attachments:
          kind === 'equal'
            ? images
            : kind === 'invalid'
              ? [attachment(0, { urlExpiresAt: 'invalid' })]
              : renewed(images, kind === 'near' ? 20_000 : -1),
      });
    const { resource, rerender, container } = setup(images);
    fireEvent.load(screen.getByRole('img'));
    activate();
    await flush();
    for (const image of container.querySelectorAll('img')) fireEvent.load(image);
    rerender(<MessageAttachments resource={resource} onUnavailable={unavailable} />);
    activate(false);
    activate();
    visibility(false);
    visibility(true);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(refreshMessageAttachments).toHaveBeenCalledOnce();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry images' })).toBeInTheDocument();
  },
);

it.each(['click', 'auxclick'])(
  'prevents expired %s even after failed proactive refresh, without opening on late success',
  async (eventType) => {
    const images = [attachment(0, { urlExpiresAt: new Date(Date.now() + 10_000).toISOString() })];
    vi.mocked(refreshMessageAttachments).mockRejectedValueOnce(new Error('Offline'));
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    setup(images);
    activate();
    await flush();
    const link = screen.getByRole('link');
    // Move wall clock without running timers: the click must validate again independently of render.
    vi.setSystemTime(Date.now() + 11_000);
    const late = deferred<RefreshMessageAttachmentsResponse>();
    vi.mocked(refreshMessageAttachments).mockReturnValueOnce(late.promise);
    expect(
      fireEvent(
        link,
        new MouseEvent(eventType, {
          bubbles: true,
          cancelable: true,
          button: eventType === 'auxclick' ? 1 : 0,
        }),
      ),
    ).toBe(false);
    await flush();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(refreshMessageAttachments).toHaveBeenCalledTimes(2);
    await act(async () => late.resolve({ attachments: renewed(images) }));
    expect(screen.getByRole('link')).toBeInTheDocument();
    expect(opened).not.toHaveBeenCalled();
  },
);

it('a new session resource never reuses old DOM resources or old viewport/load/error evidence', async () => {
  const { rerender } = setup();
  activate();
  const old = screen.getByRole('img');
  fireEvent.load(old);
  act(() => advanceSessionGeneration());
  const current = acceptMessageAttachments(message(1, { attachments: [attachment()] }));
  rerender(<MessageAttachments resource={current} onUnavailable={unavailable} />);
  expect(screen.getByRole('img')).not.toBe(old);
  fireEvent.error(old);
  fireEvent.load(old);
  await flush();
  expect(current.getSnapshot().failed).toEqual([]);
  expect(refreshMessageAttachments).not.toHaveBeenCalled();
  vi.mocked(refreshMessageAttachments).mockRejectedValueOnce(new Error('Offline'));
  fireEvent.error(screen.getByRole('img'));
  await flush();
  expect(refreshMessageAttachments).not.toHaveBeenCalled();
  activate();
  await flush();
  expect(refreshMessageAttachments).toHaveBeenCalledOnce();
});

it.each(['MESSAGE_NOT_FOUND', 'CONVERSATION_NOT_FOUND'])(
  'routes %s to the correct availability boundary',
  async (code) => {
    vi.mocked(refreshMessageAttachments).mockRejectedValueOnce(new ApiError(404, code, 'secret'));
    const { container } = setup([attachment(0, { urlExpiresAt: 'invalid' })]);
    activate();
    await flush();
    expect(container.querySelector('img')).toBeNull();
    if (code === 'MESSAGE_NOT_FOUND') {
      expect(screen.getByText('Attachments unavailable')).toBeInTheDocument();
      expect(unavailable).not.toHaveBeenCalled();
    } else expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ code }));
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  },
);

it('clears mounted capabilities on session change and cannot be resurrected by late completion', async () => {
  const late = deferred<RefreshMessageAttachmentsResponse>();
  vi.mocked(refreshMessageAttachments).mockReturnValueOnce(late.promise);
  const { container, resource } = setup([
    attachment(0, { urlExpiresAt: new Date(Date.now() + 10_000).toISOString() }),
  ]);
  activate();
  await flush();
  act(() => advanceSessionGeneration());
  expect(container.querySelector('img')).toBeNull();
  await act(async () => late.resolve({ attachments: [attachment()] }));
  expect(container.querySelector('img')).toBeNull();
  expect(resource.getSnapshot().attachments).toEqual([]);
  expect(unavailable).not.toHaveBeenCalled();
});
