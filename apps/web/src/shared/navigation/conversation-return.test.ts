import { expect, it } from 'vitest';
import { advanceConversationReturn, getConversationReturn } from './conversation-return';

it('preserves the conversation target and counts only nested pushes', () => {
  const initial = { returnTo: '/messages/A', conversationReturnSteps: 1, returnPagination: [null] };
  expect(getConversationReturn(initial)).toEqual({ to: '/messages/A', steps: 1 });
  const afterPagination = advanceConversationReturn(initial);
  const afterEdit = advanceConversationReturn(afterPagination);
  expect(getConversationReturn(afterEdit)).toEqual({ to: '/messages/A', steps: 3 });
  expect(afterEdit.returnPagination).toEqual([null]);
  expect(initial.conversationReturnSteps).toBe(1);
});

it.each([
  null,
  { returnTo: '//evil.example', conversationReturnSteps: 1 },
  { returnTo: '/activity', conversationReturnSteps: 1 },
  { returnTo: '/messages/A', conversationReturnSteps: 0 },
  { returnTo: '/messages/A', conversationReturnSteps: -1 },
  { returnTo: '/messages/A', conversationReturnSteps: 1.5 },
  { returnTo: '/messages/A', conversationReturnSteps: '1' },
])('rejects an invalid conversation history marker: %j', (state) => {
  expect(getConversationReturn(state)).toBeNull();
});

it('does not alter normal feed return state', () => {
  const state = { returnTo: '/listings?kind=found', returnPagination: [null, 'page-2'] };
  expect(advanceConversationReturn(state)).toBe(state);
});
