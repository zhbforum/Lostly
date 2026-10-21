import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { ConversationUnreadContext } from '@/features/conversations/model/use-conversation-unread';
import { AppNavigation } from './AppNavigation';

vi.mock('@/features/auth/model/auth-context', () => ({
  useAuth: () => ({ user: null }),
}));

it('shows the conversation count, caps the visual badge and selects nested message routes', () => {
  render(
    <MemoryRouter initialEntries={['/messages/A']}>
      <ConversationUnreadContext.Provider
        value={{ unreadConversationCount: 123, refreshUnread: () => {} }}
      >
        <AppNavigation />
      </ConversationUnreadContext.Provider>
    </MemoryRouter>,
  );

  const messages = screen.getByRole('link', { name: 'Messages, 123 unread conversations' });

  expect(messages).toHaveAttribute('aria-current', 'page');
  expect(messages).toHaveAttribute('href', '/messages');
  expect(screen.getByText('99+')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByRole('link', { name: 'Browse' })).not.toHaveAttribute('aria-current');
  expect(screen.getByRole('link', { name: 'Lostly home' })).toHaveAttribute('href', '/');
});

it('does not show a zero badge and uses the same navigation for activity', () => {
  render(
    <MemoryRouter initialEntries={['/activity?tab=incoming']}>
      <ConversationUnreadContext.Provider
        value={{ unreadConversationCount: 0, refreshUnread: () => {} }}
      >
        <AppNavigation />
      </ConversationUnreadContext.Provider>
    </MemoryRouter>,
  );

  expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Messages' })).toHaveTextContent(/^Messages$/);
});
