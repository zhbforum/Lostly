import { expect, test } from 'bun:test';
import { CONVERSATION_SEND_RATE_LIMIT, createConversationSendRateLimiter } from './rate-limit';

test('bounds new sends per participant and conversation and resets at the window boundary', () => {
  const consume = createConversationSendRateLimiter();
  for (let i = 0; i < CONVERSATION_SEND_RATE_LIMIT.limit; i++) {
    expect(consume('room', 'user', 1000)).toBeNull();
  }
  expect(consume('room', 'user', 1000)).toBe(60);
  expect(consume('room', 'user', 2001)).toBe(59);
  expect(consume('room', 'user', 60999)).toBe(1);
  expect(consume('room', 'user', 61000)).toBeNull();
});

test('scopes quota to both identifiers and treats UUID casing as the same bucket', () => {
  const consume = createConversationSendRateLimiter(1);
  const room = crypto.randomUUID();
  const user = crypto.randomUUID();
  expect(consume(room, user, 0)).toBeNull();
  expect(consume(room.toUpperCase(), user.toUpperCase(), 0)).toBe(60);
  expect(consume(room, crypto.randomUUID(), 0)).toBeNull();
  expect(consume(crypto.randomUUID(), user, 0)).toBeNull();
});

test('bounds process-local bucket storage and reclaims expired keys', () => {
  const consume = createConversationSendRateLimiter(1, 1000, 2);
  expect(consume('a', 'user', 0)).toBeNull();
  expect(consume('b', 'user', 0)).toBeNull();
  expect(consume('c', 'user', 0)).toBe(1);
  expect(consume('c', 'user', 1000)).toBeNull();
  expect(consume('a', 'user', 1000)).toBeNull();
});
