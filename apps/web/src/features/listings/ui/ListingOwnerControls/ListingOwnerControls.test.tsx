import { StrictMode } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveListing, resolveListing } from '@/features/listings/api/listings-api';
import type { ListingResponse } from '@/features/listings/model/types';
import { ApiError } from '@/shared/api/client';
import { ownerReport, reportId } from '@/test/fixtures/listing-management';
import { ListingOwnerControls } from './ListingOwnerControls';

vi.mock('@/features/listings/api/listings-api');

type Action = 'resolve' | 'archive';
type Outcome = 'success' | '409' | 'network';

function delayedResponse(action: Action, outcome: Outcome) {
  let finish!: () => void;
  const promise = new Promise<ListingResponse>((resolve, reject) => {
    finish = () => {
      if (outcome === 'success') {
        resolve({ listing: ownerReport(action === 'resolve' ? 'resolved' : 'archived').listing });
      } else if (outcome === '409') {
        reject(
          new ApiError(
            409,
            action === 'resolve' ? 'LISTING_NOT_RESOLVABLE' : 'LISTING_ALREADY_ARCHIVED',
            'Already closed',
          ),
        );
      } else {
        reject(new Error('Offline'));
      }
    };
  });
  return { promise, finish };
}

function controls(listingId: string, onChanged: (message: string) => void) {
  return (
    <StrictMode>
      <MemoryRouter>
        <ListingOwnerControls
          listingId={listingId}
          capabilities={ownerReport().capabilities}
          onChanged={onChanged}
        />
      </MemoryRouter>
    </StrictMode>
  );
}

describe.each(['resolve', 'archive'] as const)('%s request lifetime', (action) => {
  beforeEach(() => vi.resetAllMocks());
  const label = action === 'resolve' ? 'Mark as resolved' : 'Archive report';

  it.each(['success', '409', 'network'] as const)(
    'ignores a delayed %s after unmount',
    async (outcome) => {
      const response = delayedResponse(action, outcome);
      const mutation = vi.mocked(action === 'resolve' ? resolveListing : archiveListing);
      mutation.mockReturnValue(response.promise);
      const onChanged = vi.fn();
      const view = render(controls(reportId, onChanged));
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: label }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }));
      expect(mutation).toHaveBeenCalledWith(reportId);

      view.unmount();
      await act(async () => response.finish());
      expect(onChanged).not.toHaveBeenCalled();
    },
  );

  it.each(['success', '409', 'network'] as const)(
    'isolates a new pending request from the old %s after listing changes and a return to the same ID',
    async (outcome) => {
      const oldResponse = delayedResponse(action, outcome);
      const currentResponse = delayedResponse(action, 'success');
      const mutation = vi.mocked(action === 'resolve' ? resolveListing : archiveListing);
      mutation
        .mockReturnValueOnce(oldResponse.promise)
        .mockReturnValueOnce(currentResponse.promise);
      const oldOnChanged = vi.fn();
      const currentOnChanged = vi.fn();
      const view = render(controls(reportId, oldOnChanged));
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: label }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }));
      expect(mutation).toHaveBeenCalledTimes(1);

      // No key supplied by the caller: changing listingId must reset the controls themselves.
      view.rerender(controls('550e8400-e29b-41d4-a716-446655440002', currentOnChanged));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
      // Matching the old ID again must not make its abandoned request current.
      view.rerender(controls(reportId, currentOnChanged));
      await user.click(screen.getByRole('button', { name: label }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }));
      const dialog = screen.getByRole('dialog');
      const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
      expect(cancel).toBeDisabled();
      expect(mutation).toHaveBeenCalledTimes(2);

      await act(async () => oldResponse.finish());
      expect(oldOnChanged).not.toHaveBeenCalled();
      expect(currentOnChanged).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(cancel).toBeDisabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Saving…' }));
      expect(mutation).toHaveBeenCalledTimes(2);

      await act(async () => currentResponse.finish());
      expect(currentOnChanged).toHaveBeenCalledExactlyOnceWith(
        action === 'resolve'
          ? 'Your report was marked as resolved.'
          : 'Your report was archived. It remains available in My reports.',
      );
      expect(oldOnChanged).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    },
  );
});
