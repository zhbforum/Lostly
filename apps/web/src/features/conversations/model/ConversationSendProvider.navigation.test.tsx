import { type ReactNode, useEffect, useState } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link, Route, Routes, useParams } from 'react-router';
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext, useAuth } from '@/features/auth/model/auth-context';
import { AuthProvider } from '@/features/auth/model/AuthProvider';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import { clearDrafts } from '@/shared/model/form-drafts';
import { deferred } from '@/test/deferred';
import { message } from '@/test/fixtures/conversations';
import { sendConversationMessage } from '../api/conversations-api';
import { ConversationSendProvider } from './ConversationSendProvider';
import { useConversationSend } from './conversation-send-context';
import { useMessageComposer } from './use-message-composer';
import type { ClaimMessageResponse } from './types';
import type { SendResult } from './send-operations';

vi.mock('../api/conversations-api');
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  cleanup();
  clearDrafts();
  vi.unstubAllGlobals();
  advanceSessionGeneration();
});
const user = {
  id: 'user-1',
  email: 'alex@example.com',
  displayName: 'Alex',
  role: 'user' as const,
};
const auth = {
  user,
  status: 'authenticated' as const,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
};

// Use the production composer so navigation exercises draft/operation ownership.
function ConversationRoute() {
  const { id } = useParams();
  return <DraftAndSend key={id} id={id!} />;
}
function DraftAndSend({ id }: { id: string }) {
  const composer = useMessageComposer(id, true);
  const { subscribeToResults } = useConversationSend();
  const [confirmed, setConfirmed] = useState('');
  useEffect(
    () =>
      subscribeToResults((result) => {
        if (result.status === 'sent' && result.operation.conversationId === id)
          setConfirmed(result.message.id);
      }),
    [id, subscribeToResults],
  );
  return (
    <>
      <h1>Conversation {id}</h1>
      <label>
        Message
        <textarea
          value={composer.draft}
          onChange={(event) => composer.setDraft(event.target.value)}
        />
      </label>
      <button onClick={() => void composer.submit()}>Send</button>
      {composer.operations.map((operation) => (
        <div key={operation.operationId}>
          <span>
            {operation.body} · {operation.status}
          </span>
          <button onClick={() => void composer.retry(operation.operationId)}>Retry</button>
        </div>
      ))}
      <output>{confirmed}</output>
    </>
  );
}

it('preserves A operations and drafts through B, Activity, a listing and back to A', async () => {
  const committedButLost = deferred<ClaimMessageResponse>();
  vi.mocked(sendConversationMessage)
    .mockReturnValueOnce(committedButLost.promise)
    .mockResolvedValueOnce({ message: message(7) });
  const interaction = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/messages/A']}>
      <AuthContext.Provider value={auth}>
        <ConversationSendProvider>
          <nav>
            <Link to="/messages/A">A</Link>
            <Link to="/messages/B">B</Link>
            <Link to="/activity">Activity</Link>
            <Link to="/listings/123">Listing</Link>
          </nav>
          <Routes>
            <Route path="/messages/:id" element={<ConversationRoute />} />
            <Route path="/activity" element={<h1>Activity</h1>} />
            <Route path="/listings/:id" element={<h1>Listing</h1>} />
          </Routes>
        </ConversationSendProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  await interaction.type(screen.getByLabelText('Message'), 'Draft A');
  await interaction.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledOnce());
  const key = vi.mocked(sendConversationMessage).mock.calls[0][2];
  await interaction.click(screen.getByRole('link', { name: 'B' }));
  expect(screen.getByLabelText('Message')).toHaveValue('');
  expect(screen.queryByText(/Draft A/)).not.toBeInTheDocument();
  await interaction.type(screen.getByLabelText('Message'), 'Draft B');
  await act(async () => committedButLost.reject(new TypeError('Committed, response lost')));
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  await interaction.click(screen.getByRole('link', { name: 'Activity' }));
  await interaction.click(screen.getByRole('link', { name: 'Listing' }));
  await interaction.click(screen.getByRole('link', { name: 'A' }));
  expect(screen.getByLabelText('Message')).toHaveValue('');
  expect(screen.getByText('Draft A · uncertain')).toBeInTheDocument();
  await interaction.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('message-7');
  expect(vi.mocked(sendConversationMessage).mock.calls[1]).toEqual(['A', 'Draft A', key]);
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  await interaction.click(screen.getByRole('link', { name: 'B' }));
  expect(screen.getByLabelText('Message')).toHaveValue('Draft B');
  expect(screen.queryByText('message-7')).not.toBeInTheDocument();
});

it('clears sends at the beginning of real AuthProvider logout, before its HTTP request settles', async () => {
  const logoutResponse = deferred<Response>();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ user }))
      .mockReturnValueOnce(logoutResponse.promise),
  );
  const transport = deferred<ClaimMessageResponse>();
  vi.mocked(sendConversationMessage).mockReturnValueOnce(transport.promise);
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider>
        <ConversationSendProvider>{children}</ConversationSendProvider>
      </AuthProvider>
    );
  }
  const { result } = renderHook(() => ({ auth: useAuth(), sends: useConversationSend() }), {
    wrapper,
  });
  await waitFor(() => expect(result.current.auth.status).toBe('authenticated'));
  let send!: Promise<SendResult>;
  act(() => {
    const started = result.current.sends.sendMessage('A', 'Hello');
    assert(started.accepted);
    send = started.completion;
  });
  await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledOnce());
  let logout!: Promise<void>;
  act(() => {
    logout = result.current.auth.logout();
  });
  expect(result.current.sends.operations).toEqual({});
  expect(result.current.auth.status).toBe('authenticated');
  await act(async () => {
    transport.resolve({ message: message(1) });
    expect(await send).toEqual({ status: 'ignored' });
    logoutResponse.resolve(new Response(null, { status: 204 }));
    await logout;
  });
  expect(result.current.auth.status).toBe('unauthenticated');
});
