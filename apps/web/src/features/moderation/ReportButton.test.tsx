import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { TestSession } from '@/test/session';
import { profileUser } from '@/test/fixtures/profile';
import { submitReport } from './api';
import { ApiError } from '@/shared/api/client';
import { ReportButton } from './ReportButton';

vi.mock('./api');
beforeEach(() => vi.resetAllMocks());
it('discards a private report draft when another member signs in on a public profile', async () => {
  const actor = userEvent.setup();
  const { rerender } = render(
    <TestSession>
      <ReportButton targetType="user" targetId="profile" />
    </TestSession>,
  );
  await actor.click(screen.getByRole('button', { name: 'Report a problem' }));
  await actor.type(
    screen.getByRole('textbox', { name: 'What happened?' }),
    'Private explanation belonging to the first member.',
  );
  rerender(
    <TestSession auth={{ user: null, status: 'unauthenticated' }}>
      <ReportButton targetType="user" targetId="profile" />
    </TestSession>,
  );
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  rerender(
    <TestSession auth={{ user: { ...profileUser(), id: 'another-member' } }}>
      <ReportButton targetType="user" targetId="profile" />
    </TestSession>,
  );
  await actor.click(screen.getByRole('button', { name: 'Report a problem' }));
  expect(screen.getByRole('textbox', { name: 'What happened?' })).toHaveValue('');
  expect(submitReport).not.toHaveBeenCalled();
});
it('does not offer reports to guests or restricted accounts', () => {
  const { rerender } = render(<ReportButton targetType="message" targetId="message" />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  rerender(
    <TestSession
      auth={{ user: { ...profileUser(), restriction: { reason: 'Restricted', until: null } } }}
    >
      <ReportButton targetType="message" targetId="message" />
    </TestSession>,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('submits only target identity and the trimmed user explanation', async () => {
  const actor = userEvent.setup();
  vi.mocked(submitReport).mockResolvedValue({ case: { id: 'case' } } as Awaited<
    ReturnType<typeof submitReport>
  >);
  render(
    <TestSession>
      <ReportButton targetType="message" targetId="reported-message" />
    </TestSession>,
  );
  await actor.click(screen.getByRole('button', { name: 'Report a problem' }));
  await actor.type(
    screen.getByRole('textbox', { name: 'What happened?' }),
    '  This message contains harassment.  ',
  );
  await actor.click(screen.getByRole('button', { name: 'Send report' }));
  expect(submitReport).toHaveBeenCalledExactlyOnceWith({
    targetType: 'message',
    targetId: 'reported-message',
    category: 'other',
    description: 'This message contains harassment.',
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Report sent');
});
it('keeps the explanation when the server rejects a duplicate report', async () => {
  const actor = userEvent.setup();
  vi.mocked(submitReport).mockRejectedValue(new ApiError(409, 'REPORT_EXISTS', 'Duplicate'));
  render(
    <TestSession>
      <ReportButton targetType="listing" targetId="listing" />
    </TestSession>,
  );
  await actor.click(screen.getByRole('button', { name: 'Report a problem' }));
  await actor.type(
    screen.getByRole('textbox', { name: 'What happened?' }),
    'Please review this content.',
  );
  await actor.click(screen.getByRole('button', { name: 'Send report' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already have an open report');
  expect(screen.getByRole('textbox', { name: 'What happened?' })).toHaveValue(
    'Please review this content.',
  );
});
