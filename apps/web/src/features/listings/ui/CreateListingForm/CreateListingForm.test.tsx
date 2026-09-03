import type { Ref } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateListingForm } from '@/features/listings/ui/CreateListingForm/CreateListingForm';

const { createListingMock } = vi.hoisted(() => ({
  createListingMock: vi.fn(),
}));

vi.mock('@/features/listings/api/listings-api', () => ({
  createListing: createListingMock,
}));

vi.mock('./_parts/ListingDateField/ListingDateField', () => ({
  ListingDateField: ({
    id,
    name,
    label,
    value,
    disabled,
    focusRef,
    onChange,
  }: {
    id: string;
    name: string;
    label: string;
    value: string;
    disabled?: boolean;
    focusRef?: Ref<HTMLSpanElement>;
    onChange: (value: string) => void;
  }) => (
    <div>
      <label htmlFor={id}>{label}</label>

      <span ref={focusRef} role="spinbutton" aria-label={`month, ${label}`} tabIndex={0} />

      <input
        id={id}
        name={name}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  ),
}));

const createdListing = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  createdByUserId: '550e8400-e29b-41d4-a716-446655440001',
  kind: 'lost' as const,
  status: 'active' as const,
  title: 'Black backpack',
  description: 'Black backpack with a small front pocket.',
  location: 'TU Berlin',
  occurredOn: '2026-09-01',
  createdAt: '2026-09-02T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

async function fillValidForm() {
  const user = userEvent.setup();

  await user.click(
    screen.getByRole('radio', {
      name: /i lost something/i,
    }),
  );

  fireEvent.change(screen.getByLabelText('Title'), {
    target: {
      value: '  Black backpack  ',
    },
  });

  fireEvent.change(screen.getByLabelText('Description'), {
    target: {
      value: '  Black backpack with a small front pocket.  ',
    },
  });

  fireEvent.change(screen.getByLabelText('Location'), {
    target: {
      value: '  TU Berlin  ',
    },
  });

  fireEvent.change(screen.getByLabelText('Date'), {
    target: {
      value: '2026-09-01',
    },
  });

  return user;
}

describe('CreateListingForm', () => {
  beforeEach(() => {
    createListingMock.mockReset();
  });

  it('uses the initial listing kind when one is provided', () => {
    render(<CreateListingForm initialKind="found" onCreated={vi.fn()} />);

    expect(
      screen.getByRole('radio', {
        name: /i found something/i,
      }),
    ).toBeChecked();

    expect(
      screen.getByRole('radio', {
        name: /i lost something/i,
      }),
    ).not.toBeChecked();
  });

  it('shows validation errors and focuses the error summary', async () => {
    const user = userEvent.setup();

    render(<CreateListingForm onCreated={vi.fn()} />);

    await user.click(
      screen.getByRole('button', {
        name: 'Create report',
      }),
    );

    const summaryTitle = screen.getByRole('heading', {
      name: 'Check your report',
    });

    expect(summaryTitle.parentElement).toHaveFocus();
    expect(createListingMock).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('link', {
        name: 'Choose whether you lost or found the item.',
      }),
    );

    expect(
      screen.getByRole('radio', {
        name: /i lost something/i,
      }),
    ).toHaveFocus();
  });

  it('focuses the date field from the error summary', async () => {
    const user = userEvent.setup();

    render(<CreateListingForm initialKind="lost" onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Title'), {
      target: {
        value: 'Black backpack',
      },
    });

    fireEvent.change(screen.getByLabelText('Description'), {
      target: {
        value: 'Black backpack with a small front pocket.',
      },
    });

    fireEvent.change(screen.getByLabelText('Location'), {
      target: {
        value: 'TU Berlin',
      },
    });

    await user.click(
      screen.getByRole('button', {
        name: 'Create report',
      }),
    );

    await user.click(
      screen.getByRole('link', {
        name: 'Enter the date the item was lost or found.',
      }),
    );

    expect(
      screen.getByRole('spinbutton', {
        name: /month, date/i,
      }),
    ).toHaveFocus();

    expect(createListingMock).not.toHaveBeenCalled();
  });

  it('submits normalized listing data and returns the created listing', async () => {
    createListingMock.mockResolvedValue({
      listing: createdListing,
    });

    const onCreated = vi.fn();

    render(<CreateListingForm onCreated={onCreated} />);

    const user = await fillValidForm();

    await user.click(
      screen.getByRole('button', {
        name: 'Create report',
      }),
    );

    await waitFor(() => {
      expect(createListingMock).toHaveBeenCalledWith({
        kind: 'lost',
        title: 'Black backpack',
        description: 'Black backpack with a small front pocket.',
        location: 'TU Berlin',
        occurredOn: '2026-09-01',
      });
    });

    expect(onCreated).toHaveBeenCalledWith(createdListing);
  });

  it('disables submission while the request is in progress', async () => {
    let resolveRequest: ((value: { listing: typeof createdListing }) => void) | undefined;

    createListingMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const onCreated = vi.fn();

    render(<CreateListingForm onCreated={onCreated} />);

    const user = await fillValidForm();

    await user.click(
      screen.getByRole('button', {
        name: 'Create report',
      }),
    );

    expect(
      screen.getByRole('button', {
        name: 'Creating report…',
      }),
    ).toBeDisabled();

    resolveRequest?.({
      listing: createdListing,
    });

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(createdListing);
    });
  });

  it('shows a fallback message when creation fails', async () => {
    createListingMock.mockRejectedValue(new Error('request failed'));

    render(<CreateListingForm onCreated={vi.fn()} />);

    const user = await fillValidForm();

    await user.click(
      screen.getByRole('button', {
        name: 'Create report',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong while creating your report. Try again.',
    );
  });
});
