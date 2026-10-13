import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { getActivity } from '@/features/activity/api/activity-api';
import { ActivityPage } from './ActivityPage';

vi.mock('@/features/activity/api/activity-api');
vi.mock('@/features/auth/model/auth-context', () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock('@/features/conversations/model/use-conversation-unread', () => ({
  useConversationUnread: () => ({ unreadConversationCount: 0, refreshUnread: () => {} }),
}));

describe('activity history', () => {
  it('links an approved claim to its resolved report and switches to incoming claims', async () => {
    const mock = vi.mocked(getActivity);
    mock.mockResolvedValue({
      kind: 'claims',
      claims: [
        {
          id: 'claim-1',
          conversationId: 'conversation-1',
          status: 'approved',
          createdAt: '2026-09-01T10:00:00Z',
          listing: { id: 'report-1', title: 'Blue backpack', status: 'resolved' },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/activity?tab=claims']}>
        <ActivityPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: 'Blue backpack' })).toHaveAttribute(
      'href',
      '/listings/report-1',
    );
    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open conversation' })).toHaveAttribute(
      'href',
      '/messages/conversation-1',
    );
    await user.click(screen.getByRole('link', { name: 'Incoming claims' }));
    await screen.findByRole('link', { name: 'Blue backpack' });
    expect(screen.getByRole('link', { name: 'Open conversation' })).toHaveAttribute(
      'href',
      '/messages/conversation-1',
    );
    expect(mock).toHaveBeenLastCalledWith('incoming', undefined, expect.any(AbortSignal));
  });
});
