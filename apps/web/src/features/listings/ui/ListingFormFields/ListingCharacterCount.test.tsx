import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ListingCharacterCount } from './ListingCharacterCount';
import { CHARACTER_COUNT_THRESHOLD } from './character-count.constants';

it('stays hidden below the warning threshold and appears at the boundary', () => {
  const threshold = 100 * CHARACTER_COUNT_THRESHOLD;
  const view = render(
    <ListingCharacterCount id="title-count" currentLength={threshold - 1} maxLength={100} />,
  );
  expect(view.container).toBeEmptyDOMElement();
  view.rerender(
    <ListingCharacterCount id="title-count" currentLength={threshold} maxLength={100} />,
  );
  const counter = screen.getByText(`${100 - threshold} characters remaining`);
  expect(counter).toHaveAttribute('id', 'title-count');
  expect(counter).toHaveAttribute('aria-live', 'polite');
});

it.each([
  [99, '1 character remaining'],
  [100, '0 characters remaining'],
  [101, '1 character over the limit'],
  [102, '2 characters over the limit'],
])('announces the remaining or excess characters at length %s', (length, feedback) => {
  render(<ListingCharacterCount id="title-count" currentLength={length} maxLength={100} />);
  expect(screen.getByText(feedback)).toBeVisible();
});
