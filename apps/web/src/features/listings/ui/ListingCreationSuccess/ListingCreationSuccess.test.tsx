import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { Listing } from '@/features/listings/model/types';
import { ListingCreationSuccess } from '@/features/listings/ui/ListingCreationSuccess/ListingCreationSuccess';

const listing = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  kind: 'found' as const,
  status: 'active' as const,
  version: 1,
  title: 'Black backpack',
  description: 'Black backpack with a small front pocket.',
  location: 'TU Berlin',
  occurredOn: '2026-09-01',
  createdAt: '2026-09-03T10:00:00.000Z',
  updatedAt: '2026-09-03T10:00:00.000Z',
} satisfies Listing;

function renderSuccess(onCreateAnother = vi.fn()) {
  render(
    <MemoryRouter>
      <ListingCreationSuccess listing={listing} onCreateAnother={onCreateAnother} />
    </MemoryRouter>,
  );

  return {
    onCreateAnother,
  };
}

describe('ListingCreationSuccess', () => {
  it('focuses the success heading after creation', () => {
    renderSuccess();

    expect(
      screen.getByRole('heading', {
        name: 'Your report was created.',
      }),
    ).toHaveFocus();
  });

  it('links to the created report', () => {
    renderSuccess();

    expect(
      screen.getByRole('link', {
        name: 'View report',
      }),
    ).toHaveAttribute('href', `/listings/${listing.id}`);

    expect(
      screen.getByRole('link', {
        name: 'Back to home',
      }),
    ).toHaveAttribute('href', '/');
  });

  it('allows creating another report', async () => {
    const user = userEvent.setup();
    const { onCreateAnother } = renderSuccess();

    await user.click(
      screen.getByRole('button', {
        name: 'Create another report',
      }),
    );

    expect(onCreateAnother).toHaveBeenCalledTimes(1);
  });
});
