import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateListing } from '@/features/listings/api/listings-api';
import { ownerReport } from '@/test/fixtures/listing-management';
import { ApiError } from '@/shared/api/client';
import { readDraft } from '@/shared/model/form-drafts';
import type { ListingResponse } from '@/features/listings/model/types';
import { EditListingForm } from './EditListingForm';

vi.mock('@/features/listings/api/listings-api');
const update = vi.mocked(updateListing);
const listing = ownerReport().listing;

function delayedUpdate() {
  let resolve!: (value: ListingResponse) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<ListingResponse>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('EditListingForm', () => {
  beforeEach(() => vi.resetAllMocks());

  it('prefills editable fields and displays immutable report type', () => {
    render(<EditListingForm listing={listing} onSaved={vi.fn()} />);
    expect(screen.getByLabelText('Title')).toHaveValue(listing.title);
    expect(screen.getByLabelText('Description')).toHaveValue(listing.description);
    expect(screen.getByLabelText('Location')).toHaveValue(listing.location);
    expect(screen.getByRole('spinbutton', { name: /month/i })).toHaveTextContent('9');
    expect(screen.getByRole('spinbutton', { name: /day/i })).toHaveTextContent('1');
    expect(screen.getByRole('spinbutton', { name: /year/i })).toHaveTextContent('2026');
    expect(screen.getByText('Report type cannot be changed after publication.')).toBeVisible();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('validates fields, focuses the summary, and links to text and date inputs', async () => {
    const user = userEvent.setup();
    render(
      <EditListingForm
        listing={{ ...listing, title: '', description: '', location: '', occurredOn: '' }}
        onSaved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Check your report' }).parentElement).toHaveFocus();
    await user.click(screen.getByRole('link', { name: 'Enter a title.' }));
    expect(screen.getByLabelText('Title')).toHaveFocus();
    await user.click(screen.getByRole('link', { name: /Enter the date/ }));
    expect(screen.getByRole('spinbutton', { name: /month/i })).toHaveFocus();
  });

  it('saves trimmed editable fields with the version the editor opened', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    update.mockResolvedValue({ listing });
    render(<EditListingForm listing={listing} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Updated backpack  ' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: '  Updated description  ' },
    });
    fireEvent.change(screen.getByLabelText('Location'), {
      target: { value: '  Updated location  ' },
    });
    await user.click(screen.getByRole('spinbutton', { name: /day/i }));
    await user.keyboard('{ArrowUp}');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(update).toHaveBeenCalledWith(
      listing.id,
      {
        expectedVersion: listing.version,
        title: 'Updated backpack',
        description: 'Updated description',
        location: 'Updated location',
        occurredOn: '2026-09-02',
      },
      expect.any(AbortSignal),
    );
    expect(onSaved).toHaveBeenCalledWith(listing);
  });

  it('disables editing and duplicate submissions while saving', async () => {
    const user = userEvent.setup();
    let finish!: (value: { listing: typeof listing }) => void;
    update.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<EditListingForm listing={listing} onSaved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('button', { name: 'Saving changes…' })).toBeDisabled();
    expect(screen.getByLabelText('Title')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Saving changes…' }));
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => finish({ listing }));
  });

  it('discards the versioned draft before handing a successful save to navigation', async () => {
    const user = userEvent.setup();
    const draftKey = `listing:edit:${listing.id}:${listing.version}`;
    const saved = {
      ...listing,
      title: 'Updated backpack',
      version: listing.version + 1,
      updatedAt: '2026-09-02T10:00:00.000Z',
    };
    update.mockResolvedValue({ listing: saved });
    const onSaved = vi.fn(() => expect(readDraft(draftKey)).toBeUndefined());
    const view = render(<EditListingForm listing={listing} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: saved.title } });
    expect(readDraft(draftKey)).toMatchObject({ title: saved.title });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSaved).toHaveBeenCalledWith(saved);
    view.unmount();
    expect(readDraft(draftKey)).toBeUndefined();
  });

  it('preserves input and permits retry after an API failure', async () => {
    const user = userEvent.setup();
    update
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'Unexpected error'))
      .mockResolvedValue({ listing });
    const onSaved = vi.fn();
    render(<EditListingForm listing={listing} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My updated title' } });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your input is still here');
    expect(screen.getByLabelText('Title')).toHaveValue('My updated title');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('explains stale state and prevents resubmitting after 409', async () => {
    update.mockRejectedValue(new ApiError(409, 'LISTING_NOT_EDITABLE', 'Not editable'));
    const user = userEvent.setup();
    render(<EditListingForm listing={listing} onSaved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This report can no longer be edited because its status has changed.',
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('preserves every field and the draft on version conflict without retrying or navigating', async () => {
    update.mockRejectedValue(new ApiError(409, 'LISTING_VERSION_CONFLICT', 'Version conflict'));
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<EditListingForm listing={listing} onSaved={onSaved} />);
    const values = {
      title: 'My unsaved title',
      description: 'My unsaved description',
      location: 'My unsaved location',
      occurredOn: '2026-09-02',
    };
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: values.title } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: values.description },
    });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: values.location } });
    await user.click(screen.getByRole('spinbutton', { name: /day/i }));
    await user.keyboard('{ArrowUp}');
    const submit = screen.getByRole('button', { name: 'Save changes' });
    await user.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This report was updated elsewhere. Your input is still here.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('status has changed');
    expect(screen.getByLabelText('Title')).toHaveValue(values.title);
    expect(screen.getByLabelText('Description')).toHaveValue(values.description);
    expect(screen.getByLabelText('Location')).toHaveValue(values.location);
    expect(screen.getByRole('spinbutton', { name: /day/i })).toHaveTextContent('2');
    expect(readDraft(`listing:edit:${listing.id}:${listing.version}`)).toEqual(values);
    expect(screen.getByLabelText('Description')).toBeEnabled();
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest('form')!);
    expect(update).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('ignores a late success after unmount, including when the same draft has been reopened', async () => {
    const delayed = delayedUpdate();
    update.mockReturnValue(delayed.promise);
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const editor = () => (
      <StrictMode>
        <EditListingForm listing={listing} onSaved={onSaved} />
      </StrictMode>
    );
    const view = render(editor());
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Original draft' } });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const signal = update.mock.calls[0]![2]!;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);

    render(editor());
    expect(screen.getByLabelText('Title')).toHaveValue('Original draft');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Newer unsaved draft' } });
    await act(async () =>
      delayed.resolve({ listing: { ...listing, version: listing.version + 1 } }),
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(readDraft(`listing:edit:${listing.id}:${listing.version}`)).toMatchObject({
      title: 'Newer unsaved draft',
    });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it.each([
    { change: 'listing', outcome: 'success' },
    { change: 'listing', outcome: 'failure' },
    { change: 'version', outcome: 'success' },
    { change: 'version', outcome: 'failure' },
  ])(
    'ignores a stale $outcome after changing $change while the new editor is saving',
    async ({ change, outcome }) => {
      const oldRequest = delayedUpdate();
      const newRequest = delayedUpdate();
      update.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
      const user = userEvent.setup();
      const oldSaved = vi.fn();
      const newSaved = vi.fn();
      const view = render(<EditListingForm listing={listing} onSaved={oldSaved} />);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      const oldSignal = update.mock.calls[0]![2]!;
      const current = {
        ...listing,
        id: change === 'listing' ? '550e8400-e29b-41d4-a716-446655440002' : listing.id,
        version: change === 'version' ? listing.version + 1 : listing.version,
        title: 'Current server title',
      };
      view.rerender(<EditListingForm listing={current} onSaved={newSaved} />);
      expect(oldSignal.aborted).toBe(true);
      expect(screen.getByLabelText('Title')).toHaveValue(current.title);
      fireEvent.change(screen.getByLabelText('Description'), {
        target: { value: 'Current draft' },
      });
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await act(async () => {
        if (outcome === 'success') oldRequest.resolve({ listing });
        else oldRequest.reject(new ApiError(409, 'LISTING_VERSION_CONFLICT', 'Version conflict'));
      });
      expect(oldSaved).not.toHaveBeenCalled();
      expect(newSaved).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Saving changes…' })).toBeDisabled();
      expect(readDraft(`listing:edit:${current.id}:${current.version}`)).toMatchObject({
        description: 'Current draft',
      });
      expect(update.mock.calls[1]![1]).toMatchObject({ expectedVersion: current.version });

      const saved = { ...current, description: 'Current draft', version: current.version + 1 };
      await act(async () => newRequest.resolve({ listing: saved }));
      expect(newSaved).toHaveBeenCalledExactlyOnceWith(saved);
      expect(readDraft(`listing:edit:${current.id}:${current.version}`)).toBeUndefined();
    },
  );
});
