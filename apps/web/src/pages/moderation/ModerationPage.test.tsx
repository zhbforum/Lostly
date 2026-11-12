import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { TestSession } from '@/test/session';
import { profileUser } from '@/test/fixtures/profile';
import * as api from '@/features/moderation/api';
import { ModerationPage } from './ModerationPage';

vi.mock('@/features/moderation/api');
const pageInfo = { endCursor: null, hasNextPage: false };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getMyCases).mockResolvedValue({ items: [], pageInfo });
  vi.mocked(api.getModerationNotifications).mockResolvedValue({
    notifications: {
      items: [
        {
          id: 'notice',
          eventId: 'event',
          targetId: 'user',
          targetType: 'user',
          title: 'Account restricted',
          message: 'Repeated harassment.',
          canAppeal: true,
          readAt: null,
          createdAt: '2026-10-24T10:00:00Z',
        },
      ],
      pageInfo,
    },
    unreadCount: 1,
  });
});
it('lets a restricted member read decisions, mark them read and submit an appeal', async () => {
  const actor = userEvent.setup();
  const record = {
    id: 'appeal',
    kind: 'appeal',
    targetType: 'user',
    targetId: 'user',
    reporterId: 'user',
    assigneeId: null,
    category: 'other',
    description: 'Please reconsider this restriction.',
    status: 'open',
    version: 1,
    parentEventId: 'event',
    publicResolution: null,
    createdAt: '2026-10-24T10:00:00Z',
    updatedAt: '2026-10-24T10:00:00Z',
  } as const;
  vi.mocked(api.appeal).mockResolvedValue({ case: record });
  vi.mocked(api.markRead).mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <TestSession
        auth={{
          user: { ...profileUser(), restriction: { reason: 'Repeated harassment.', until: null } },
        }}
      >
        <ModerationPage />
      </TestSession>
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole('heading', { name: 'Your account is restricted' }),
  ).toBeInTheDocument();
  await actor.click(await screen.findByRole('button', { name: 'Mark as read' }));
  expect(api.markRead).toHaveBeenCalledWith('notice');
  await actor.click(screen.getByRole('button', { name: 'Appeal decision' }));
  await actor.type(screen.getByRole('textbox'), record.description);
  await actor.click(screen.getByRole('button', { name: 'Submit appeal' }));
  expect(api.appeal).toHaveBeenCalledExactlyOnceWith('event', record.description);
  expect(await screen.findByText(record.description)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Appeal decision' })).not.toBeInTheDocument();
});
