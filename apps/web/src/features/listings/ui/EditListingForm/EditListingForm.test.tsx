import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateListing } from '@/features/listings/api/listings-api';
import { ownerReport } from '@/test/fixtures/listing-management';
import { ApiError } from '@/shared/api/client';
import { readDraft } from '@/shared/model/form-drafts';
import { EditListingForm } from './EditListingForm';

vi.mock('@/features/listings/api/listings-api');
const update = vi.mocked(updateListing);
const listing = ownerReport().listing;

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

  it('saves only trimmed editable fields including a changed date', async () => {
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
    expect(update).toHaveBeenCalledWith(listing.id, {
      title: 'Updated backpack',
      description: 'Updated description',
      location: 'Updated location',
      occurredOn: '2026-09-02',
    });
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
    const draftKey = `listing:edit:${listing.id}:${listing.updatedAt}`;
    const saved = { ...listing, title: 'Updated backpack', updatedAt: '2026-09-02T10:00:00.000Z' };
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
});
