import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it } from 'vitest';
import { conversation, messagePreview } from '@/test/fixtures/conversations';
import { ConversationListItem } from './ConversationListItem';

afterEach(cleanup);

it.each([1, 4])('renders an attachment-only inbox preview for %i photos', (count) => {
  render(
    <MemoryRouter>
      <ul>
        <ConversationListItem
          selected={false}
          conversation={conversation('A', {
            lastMessage: messagePreview(1, { body: null, attachmentCount: count }),
          })}
        />
      </ul>
    </MemoryRouter>,
  );
  expect(screen.getByText(count === 1 ? 'Photo' : `${count} photos`)).toBeInTheDocument();
  expect(screen.queryByText('Claim submitted · No messages yet')).not.toBeInTheDocument();
});
