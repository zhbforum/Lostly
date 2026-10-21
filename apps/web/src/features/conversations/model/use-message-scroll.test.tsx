import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { message } from '@/test/fixtures/conversations';
import { useMessageScroll } from './use-message-scroll';
import type { ClaimMessage } from './types';

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

afterEach(() => {
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(reducedMotion = false) {
  const scrollTo = vi.fn();
  // jsdom has no layout; only viewport dimensions and the browser scroll API are supplied.
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(400);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  const disconnect = vi.fn();
  const observe = vi.fn();
  let onResize!: () => void;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({ media, matches: reducedMotion })),
  );
  const loadOlder = vi.fn(async () => false);
  function Thread({ messages }: { messages: ClaimMessage[] }) {
    const {
      root: historyRef,
      onScroll,
      hasNew,
      bottom,
    } = useMessageScroll(messages, true, [], 0, 'me', loadOlder);
    return (
      <>
        <div ref={historyRef} aria-label="Message history" onScroll={onScroll}>
          {messages.map((item) => (
            <p key={item.id}>{item.body}</p>
          ))}
        </div>
        {hasNew && <button onClick={() => bottom(true)}>New messages</button>}
      </>
    );
  }
  const view = render(<Thread messages={[message(1)]} />);
  scrollTo.mockClear();
  const history = screen.getByLabelText('Message history');
  return {
    ...view,
    history,
    scrollTo,
    disconnect,
    observe,
    resize: () => act(() => onResize()),
    append: () => view.rerender(<Thread messages={[message(1), message(2)]} />),
  };
}

it('follows a resize only while the reader is at the bottom and disconnects on unmount', () => {
  const test = setup();

  expect(test.observe).toHaveBeenCalledExactlyOnceWith(test.history);

  test.resize();

  expect(test.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1000, behavior: 'instant' });

  test.scrollTo.mockClear();
  fireEvent.scroll(test.history, { target: { scrollTop: 100 } });
  test.resize();

  expect(test.scrollTo).not.toHaveBeenCalled();

  fireEvent.scroll(test.history, { target: { scrollTop: 600 } });
  test.resize();

  expect(test.scrollTo).toHaveBeenCalledOnce();

  test.unmount();

  expect(test.disconnect).toHaveBeenCalledOnce();
});

it.each([false, true])(
  'honors reduced motion when jumping to new messages (reduced: %s)',
  async (reduced) => {
    const actor = userEvent.setup();
    const test = setup(reduced);

    fireEvent.scroll(test.history, { target: { scrollTop: 100 } });
    test.append();

    expect(test.scrollTo).not.toHaveBeenCalled();

    await actor.click(screen.getByRole('button', { name: 'New messages' }));

    expect(test.scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 1000,
      behavior: reduced ? 'instant' : 'smooth',
    });
    expect(screen.queryByRole('button', { name: 'New messages' })).not.toBeInTheDocument();
  },
);

it('dismisses the new-message affordance when the reader scrolls back to the bottom', () => {
  const test = setup();

  fireEvent.scroll(test.history, { target: { scrollTop: 100 } });
  test.append();

  expect(screen.getByRole('button', { name: 'New messages' })).toBeVisible();

  fireEvent.scroll(test.history, { target: { scrollTop: 600 } });

  expect(screen.queryByRole('button', { name: 'New messages' })).not.toBeInTheDocument();
  expect(test.scrollTo).not.toHaveBeenCalled();
});
