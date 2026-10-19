import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { advanceSessionGeneration } from '@/shared/api/session-events';
import { deferred } from '@/test/deferred';
import { message } from '@/test/fixtures/conversations';
import { readConversation } from '../api/conversations-api';
import { createConversationReadController } from './conversation-read-controller';
import type { ReadConversationResponse } from './types';

vi.mock('../api/conversations-api');
beforeEach(() => vi.resetAllMocks());
afterEach(() => advanceSessionGeneration());
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup() {
  const callbacks = {
    onRead: vi.fn(),
    onUnavailable: vi.fn(),
    reconcile: vi.fn(async () => {}),
    onError: vi.fn(),
  };
  const controller = createConversationReadController('A', callbacks);
  controller.setActive(true);
  return { controller, ...callbacks };
}
it('coalesces visible incoming targets, serializes reads and uses the authoritative pointer/count', async () => {
  const first = deferred<ReadConversationResponse>();
  vi.mocked(readConversation)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue({ lastReadSequence: 9, unreadCount: 1 });
  const { controller, onRead } = setup();
  controller.observe([message(1), message(3)]);
  controller.observe([message(5)]);
  await tick();
  expect(readConversation).toHaveBeenCalledWith('A', 'message-5', expect.any(AbortSignal));
  controller.observe([message(9)]);
  await tick();
  expect(readConversation).toHaveBeenCalledTimes(1);
  first.resolve({ lastReadSequence: 7, unreadCount: 3 });
  await tick();
  expect(readConversation).toHaveBeenLastCalledWith('A', 'message-9', expect.any(AbortSignal));
  expect(onRead.mock.calls.map(([response]) => response)).toEqual([
    { lastReadSequence: 7, unreadCount: 3 },
    { lastReadSequence: 9, unreadCount: 1 },
  ]);
  controller.observe([message(8)]);
  await tick();
  expect(readConversation).toHaveBeenCalledTimes(2);
  controller.dispose();
});
it('never observes hidden content and ignores a delayed old-session completion', async () => {
  const response = deferred<ReadConversationResponse>();
  vi.mocked(readConversation).mockReturnValue(response.promise);
  const { controller, onRead } = setup();
  controller.setActive(false);
  controller.observe([message(9)]);
  await tick();
  expect(readConversation).not.toHaveBeenCalled();
  controller.setActive(true);
  await tick();
  expect(readConversation).not.toHaveBeenCalled();
  controller.observe([message(3)]);
  await tick();
  advanceSessionGeneration();
  response.resolve({ lastReadSequence: 3, unreadCount: 0 });
  await tick();
  expect(onRead).not.toHaveBeenCalled();
  controller.dispose();
});
it('MESSAGE_NOT_FOUND reconciles without disappearance or retrying the old target', async () => {
  vi.mocked(readConversation)
    .mockRejectedValueOnce(new ApiError(404, 'MESSAGE_NOT_FOUND', 'Missing'))
    .mockResolvedValue({ lastReadSequence: 6, unreadCount: 0 });
  const { controller, reconcile, onUnavailable } = setup();
  controller.observe([message(5)]);
  await tick();
  expect(reconcile).toHaveBeenCalledOnce();
  expect(onUnavailable).not.toHaveBeenCalled();
  controller.observe([message(5)]);
  await tick();
  expect(readConversation).toHaveBeenCalledTimes(1);
  controller.observe([message(6)]);
  await tick();
  expect(readConversation).toHaveBeenLastCalledWith('A', 'message-6', expect.any(AbortSignal));
  controller.dispose();
});
it('stops after confirmed unavailable and retries temporary errors only on request', async () => {
  vi.mocked(readConversation)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockRejectedValueOnce(new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Gone'));
  const { controller, onError, onUnavailable } = setup();
  controller.observe([message(5)]);
  await tick();
  expect(onError).toHaveBeenCalledWith('Could not update read status.');
  controller.observe([message(6)]);
  await tick();
  expect(readConversation).toHaveBeenCalledTimes(1);
  controller.retry();
  await tick();
  expect(onUnavailable).toHaveBeenCalledOnce();
  controller.observe([message(7)]);
  await tick();
  expect(readConversation).toHaveBeenCalledTimes(2);
  controller.dispose();
});

it('does not loop when a read response fails to advance and resumes only after explicit retry', async () => {
  const retried = deferred<ReadConversationResponse>();
  vi.mocked(readConversation)
    .mockResolvedValueOnce({ lastReadSequence: 4, unreadCount: 2 })
    .mockReturnValueOnce(retried.promise);
  const { controller, onRead } = setup();
  try {
    controller.observe([message(5)]);
    await tick();
    expect(onRead).toHaveBeenCalledExactlyOnceWith({ lastReadSequence: 4, unreadCount: 2 });
    controller.observe([message(6)]);
    await tick();
    expect(readConversation).toHaveBeenCalledOnce();
    controller.retry();
    await tick();
    expect(readConversation).toHaveBeenCalledTimes(2);
    expect(readConversation).toHaveBeenLastCalledWith('A', 'message-6', expect.any(AbortSignal));
    retried.resolve({ lastReadSequence: 6, unreadCount: 0 });
    await tick();
    controller.observe([message(6)]);
    await tick();
    expect(readConversation).toHaveBeenCalledTimes(2);
    expect(onRead).toHaveBeenLastCalledWith({ lastReadSequence: 6, unreadCount: 0 });
  } finally {
    controller.dispose();
  }
});
