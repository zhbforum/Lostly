import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActivity, type ActivityResponse } from '@/features/activity/api/activity-api';
import { deferred } from '@/test/deferred';
import { ownerReport, reportId } from '@/test/fixtures/listing-management';
import { ActivityPage } from './ActivityPage';

vi.mock('@/features/activity/api/activity-api');
vi.mock('@/features/auth/model/auth-context', () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock('@/features/conversations/model/use-conversation-unread', () => ({
  useConversationUnread: () => ({ unreadConversationCount: 0, refreshUnread: () => {} }),
}));

beforeEach(() => vi.resetAllMocks());

function renderActivity(path = '/activity') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ActivityPage />
    </MemoryRouter>,
  );
}

function reportsPage(title = 'Blue backpack', nextCursor: string | null = null): ActivityResponse {
  return {
    kind: 'reports',
    listings: [{ ...ownerReport().listing, title, coverImage: null }],
    pageInfo: { hasNextPage: nextCursor !== null, endCursor: nextCursor },
  };
}

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

    renderActivity('/activity?tab=claims');

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

  it('falls back to My reports for an unknown tab and renders report links', async () => {
    vi.mocked(getActivity).mockResolvedValue(reportsPage());

    renderActivity('/activity?tab=unknown');

    expect(await screen.findByRole('link', { name: /Blue backpack/ })).toHaveAttribute(
      'href',
      `/listings/${reportId}`,
    );
    expect(screen.getByRole('link', { name: 'My reports' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(getActivity).toHaveBeenCalledExactlyOnceWith(
      'reports',
      undefined,
      expect.any(AbortSignal),
    );
  });

  it.each(['reports', 'claims'] as const)(
    'shows an empty state for %s without pagination',
    async (tab) => {
      vi.mocked(getActivity).mockResolvedValue({
        ...(tab === 'reports' ? { kind: 'reports', listings: [] } : { kind: 'claims', claims: [] }),
        pageInfo: { hasNextPage: false, endCursor: null },
      });

      renderActivity(`/activity?tab=${tab}`);

      expect(await screen.findByText(`No ${tab} on this page.`)).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Activity pages' })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(getActivity).toHaveBeenCalledExactlyOnceWith(tab, undefined, expect.any(AbortSignal));
    },
  );

  it('retries a failed request and refreshes the recovered list explicitly', async () => {
    const retry = deferred<ActivityResponse>();
    vi.mocked(getActivity)
      .mockRejectedValueOnce(new Error('Internal network details'))
      .mockReturnValueOnce(retry.promise)
      .mockResolvedValueOnce(reportsPage('Updated report'));
    const user = userEvent.setup();

    renderActivity();

    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent('Could not load your activity.');
    expect(alert).not.toHaveTextContent('Internal network details');
    expect(screen.queryByRole('button', { name: 'First page' })).not.toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(screen.getByRole('status')).toHaveTextContent('Loading activity…');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => retry.resolve(reportsPage()));

    expect(await screen.findByRole('link', { name: /Blue backpack/ })).toBeInTheDocument();
    expect(getActivity).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Refresh activity' }));

    expect(await screen.findByRole('link', { name: /Updated report/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Blue backpack/ })).not.toBeInTheDocument();
    expect(getActivity).toHaveBeenCalledTimes(3);
    expect(getActivity).toHaveBeenLastCalledWith('reports', undefined, expect.any(AbortSignal));
  });

  it('preserves report pagination and starts a different tab without the previous cursor', async () => {
    vi.mocked(getActivity).mockImplementation(async (tab, cursor) => {
      if (tab === 'claims')
        return { kind: 'claims', claims: [], pageInfo: { hasNextPage: false, endCursor: null } };
      return cursor
        ? reportsPage('Second page report')
        : reportsPage('First page report', 'next-page');
    });
    const user = userEvent.setup();

    renderActivity('/activity?tab=reports');

    await screen.findByRole('link', { name: /First page report/ });
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('link', { name: /Second page report/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /First page report/ })).not.toBeInTheDocument();
    expect(getActivity).toHaveBeenLastCalledWith('reports', 'next-page', expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous' }));

    expect(await screen.findByRole('link', { name: /First page report/ })).toBeInTheDocument();
    expect(getActivity).toHaveBeenLastCalledWith('reports', undefined, expect.any(AbortSignal));

    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByRole('link', { name: /Second page report/ });

    await user.click(screen.getByRole('link', { name: 'My claims' }));

    expect(await screen.findByText('No claims on this page.')).toBeInTheDocument();
    expect(getActivity).toHaveBeenLastCalledWith('claims', undefined, expect.any(AbortSignal));
    expect(screen.queryByRole('navigation', { name: 'Activity pages' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My claims' })).toHaveAttribute('aria-current', 'page');
  });

  it('can leave an invalid cursor and recover the first page without changing tabs', async () => {
    vi.mocked(getActivity)
      .mockRejectedValueOnce(new Error('Expired cursor'))
      .mockResolvedValueOnce({
        kind: 'claims',
        claims: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      });
    const user = userEvent.setup();

    renderActivity('/activity?tab=incoming&cursor=expired');

    const alert = await screen.findByRole('alert');

    expect(getActivity).toHaveBeenCalledExactlyOnceWith(
      'incoming',
      'expired',
      expect.any(AbortSignal),
    );

    await user.click(within(alert).getByRole('button', { name: 'First page' }));

    expect(await screen.findByText('No claims on this page.')).toBeInTheDocument();
    expect(getActivity).toHaveBeenLastCalledWith('incoming', undefined, expect.any(AbortSignal));
    expect(screen.getByRole('link', { name: 'Incoming claims' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'First page' })).not.toBeInTheDocument();
  });
});
