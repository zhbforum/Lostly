import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ListingDateField } from './ListingDateField';

function renderDateField(overrides: Partial<React.ComponentProps<typeof ListingDateField>> = {}) {
  const onChange = vi.fn();

  render(
    <ListingDateField
      id="listing-occurred-on"
      name="occurredOn"
      label="Date"
      hint="Choose the closest date you remember."
      error={null}
      value=""
      onChange={onChange}
      {...overrides}
    />,
  );

  return { onChange };
}

describe('ListingDateField', () => {
  it('renders the field label and hint', () => {
    renderDateField();

    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('Choose the closest date you remember.')).toBeInTheDocument();
  });

  it('renders an existing date value', () => {
    renderDateField({
      value: '2026-09-05',
    });

    expect(
      screen.getByRole('spinbutton', {
        name: /month/i,
      }),
    ).toHaveTextContent('9');

    expect(
      screen.getByRole('spinbutton', {
        name: /day/i,
      }),
    ).toHaveTextContent('5');

    expect(
      screen.getByRole('spinbutton', {
        name: /year/i,
      }),
    ).toHaveTextContent('2026');
  });

  it('opens the calendar popover', async () => {
    const user = userEvent.setup();

    renderDateField({
      value: '2026-09-05',
    });

    await user.click(
      screen.getByRole('button', {
        name: /choose date/i,
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: /september 2026/i,
      }),
    ).toBeInTheDocument();

    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('returns an ISO date when a date is selected', async () => {
    const user = userEvent.setup();

    const { onChange } = renderDateField({
      value: '2026-09-05',
    });

    await user.click(
      screen.getByRole('button', {
        name: /choose date/i,
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: /september 2026/i,
      }),
    ).toBeInTheDocument();

    const calendar = screen.getByRole('grid');

    const septemberEightCell = within(calendar).getByRole('gridcell', {
      name: '8',
    });

    await user.click(within(septemberEightCell).getByRole('button'));

    expect(onChange).toHaveBeenCalledWith('2026-09-08');
  });

  it('shows an error message', () => {
    renderDateField({
      error: 'Enter the date the item was lost or found.',
    });

    expect(screen.getByText('Enter the date the item was lost or found.')).toBeInTheDocument();
  });

  it('disables the calendar trigger when the field is disabled', () => {
    renderDateField({
      disabled: true,
    });

    expect(
      screen.getByRole('button', {
        name: /choose date/i,
      }),
    ).toBeDisabled();
  });
});
