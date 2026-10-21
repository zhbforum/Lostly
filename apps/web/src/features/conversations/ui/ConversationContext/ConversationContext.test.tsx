import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type { useClaimDecision } from '@/features/claims/model/use-claim-decision';
import { deferred } from '@/test/deferred';
import { conversationDetail } from '@/test/fixtures/conversations';
import type { ConversationDetail } from '../../model/types';
import { ConversationContext } from './ConversationContext';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const completion = deferred<boolean>();
  const decision: ReturnType<typeof useClaimDecision> = {
    pendingId: null,
    error: null,
    submit: vi.fn(() => completion.promise),
    clearError: vi.fn(),
    reconcile: vi.fn(),
  };
  const pending = conversationDetail({ participantRole: 'owner' });
  const tree = (conversation: ConversationDetail) => (
    <StrictMode>
      <MemoryRouter>
        <ConversationContext conversation={conversation} decision={decision} />
        <textarea aria-label="Write a message" />
      </MemoryRouter>
    </StrictMode>
  );
  const view = render(tree(pending));
  const heading = screen.getByRole('heading', { name: 'AirPods Pro' });
  const focus = vi.spyOn(heading, 'focus');
  const actor = userEvent.setup();
  async function confirm(status: 'approved' | 'rejected') {
    await actor.click(
      screen.getByRole('button', { name: status === 'approved' ? 'Approve claim' : 'Reject' }),
    );
    const dialog = screen.getByRole('dialog');
    if (status === 'approved')
      await actor.type(
        within(dialog).getByLabelText('Private collection instructions'),
        'Collect at the library.',
      );
    await actor.click(
      within(dialog).getByRole('button', {
        name: status === 'approved' ? 'Confirm approval' : 'Confirm rejection',
      }),
    );
    expect(decision.submit).toHaveBeenCalledOnce();
  }
  function updated(status: 'approved' | 'rejected') {
    return {
      ...pending,
      claim: {
        ...pending.claim,
        status,
        handoverDetails: status === 'approved' ? 'Collect at the library.' : null,
      },
    };
  }
  return {
    completion,
    heading,
    focus,
    actor,
    confirm,
    updated,
    rerender: (conversation: ConversationDetail) => view.rerender(tree(conversation)),
  };
}

it.each(['approved', 'rejected'] as const)(
  'focuses after successful %s context renders, once, not on subsequent polling',
  async (status) => {
    const test = setup();

    await test.confirm(status);

    expect(test.focus).not.toHaveBeenCalled();

    await act(async () => test.completion.resolve(true));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(test.focus).not.toHaveBeenCalled();

    test.rerender(test.updated(status));

    expect(test.heading).toHaveFocus();
    expect(test.heading).toHaveAttribute('tabindex', '-1');
    expect(test.focus).toHaveBeenCalledOnce();

    const composer = screen.getByRole('textbox', { name: 'Write a message' });

    await test.actor.click(composer);
    test.rerender(test.updated(status));
    test.rerender({ ...test.updated(status), unreadCount: 1 });

    expect(composer).toHaveFocus();
    expect(test.focus).toHaveBeenCalledOnce();
  },
);

it('handles context arriving before the successful PATCH continuation without focusing early', async () => {
  const test = setup();

  await test.confirm('approved');
  test.rerender(test.updated('approved'));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(test.focus).not.toHaveBeenCalled();

  await act(async () => test.completion.resolve(true));

  expect(test.heading).toHaveFocus();
  expect(test.focus).toHaveBeenCalledOnce();
});

it('does not transfer focus for a passive context update without a successful decision', async () => {
  const test = setup();
  const composer = screen.getByRole('textbox', { name: 'Write a message' });

  await test.actor.click(composer);
  test.rerender(test.updated('approved'));

  expect(composer).toHaveFocus();
  expect(test.focus).not.toHaveBeenCalled();
});

it('keeps failure in the dialog and preserves cancel/Escape focus restoration', async () => {
  const test = setup();

  await test.confirm('approved');
  await act(async () => test.completion.resolve(false));

  const dialog = screen.getByRole('dialog');

  expect(dialog).toBeInTheDocument();
  expect(test.focus).not.toHaveBeenCalled();

  await test.actor.click(within(dialog).getByRole('button', { name: 'Cancel' }));

  const approve = screen.getByRole('button', { name: 'Approve claim' });

  await waitFor(() => expect(approve).toHaveFocus());

  await test.actor.click(approve);
  await test.actor.keyboard('{Escape}');

  await waitFor(() => expect(approve).toHaveFocus());
  expect(test.focus).not.toHaveBeenCalled();

  test.rerender(test.updated('approved'));

  expect(test.focus).not.toHaveBeenCalled();
});
