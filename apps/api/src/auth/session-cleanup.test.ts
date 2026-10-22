import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/lostly_test';
const cleanup = await import('./session-cleanup');

let purge: ReturnType<typeof spyOn<typeof cleanup, 'purgeExpiredSessions'>>;
let schedule: ReturnType<typeof spyOn<typeof globalThis, 'setInterval'>>;
let stop: (() => void) | undefined;

beforeEach(() => {
  purge = spyOn(cleanup, 'purgeExpiredSessions').mockResolvedValue(0);
  schedule = spyOn(globalThis, 'setInterval');
});

afterEach(() => {
  stop?.();
  stop = undefined;
  mock.restore();
});

function start() {
  stop = cleanup.startSessionCleanup();
  return schedule.mock.calls[0]![0];
}

// Let the full async batch loop settle, not just the first resolved purge promise.
const settleCleanup = () => new Promise<void>((resolve) => setImmediate(resolve));

test('runs immediately, schedules fifteen-minute intervals, and does not keep the process alive', async () => {
  const tick = start();

  expect(purge).toHaveBeenCalledTimes(1);
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(schedule.mock.calls[0]![1]).toBe(15 * 60_000);
  const timer = schedule.mock.results[0]!.value as ReturnType<typeof setInterval>;
  expect(timer.hasRef()).toBe(false);
  await settleCleanup();

  tick();
  await settleCleanup();

  expect(purge).toHaveBeenCalledTimes(2);
});

test('drains full batches until a partial batch and starts fresh on the next interval', async () => {
  purge.mockResolvedValueOnce(1000).mockResolvedValueOnce(1000).mockResolvedValueOnce(17);

  const tick = start();
  await settleCleanup();

  expect(purge).toHaveBeenCalledTimes(3);

  tick();
  await settleCleanup();

  expect(purge).toHaveBeenCalledTimes(4);
});

test('limits each run to ten full batches even while an expired-session backlog remains', async () => {
  purge.mockResolvedValue(1000);

  const tick = start();
  await settleCleanup();

  expect(purge).toHaveBeenCalledTimes(10);

  tick();
  await settleCleanup();

  expect(purge).toHaveBeenCalledTimes(20);
});

test('interval ticks cannot overlap a pending purge or its remaining batches', async () => {
  const pending = Promise.withResolvers<number>();
  purge.mockReturnValueOnce(pending.promise);
  const tick = start();

  try {
    tick();
    tick();
    expect(purge).toHaveBeenCalledTimes(1);

    pending.resolve(1000);
    await settleCleanup();

    expect(purge).toHaveBeenCalledTimes(2);

    tick();
    await settleCleanup();

    expect(purge).toHaveBeenCalledTimes(3);
  } finally {
    pending.resolve(0);
    await settleCleanup();
  }
});

test('a failed purge logs only a safe event and does not disable subsequent runs', async () => {
  const log = spyOn(console, 'error').mockImplementation(() => {});
  purge.mockRejectedValueOnce(new Error('private database connection and password'));

  const tick = start();
  await settleCleanup();

  expect(log.mock.calls).toEqual([
    [JSON.stringify({ level: 'error', event: 'session_cleanup_failed' })],
  ]);

  tick();
  await settleCleanup();

  expect(purge).toHaveBeenCalledTimes(2);
  expect(log).toHaveBeenCalledTimes(1);
});

test('stopping clears the interval and prevents queued ticks and further batches after an in-flight purge', async () => {
  const pending = Promise.withResolvers<number>();
  const clear = spyOn(globalThis, 'clearInterval');
  purge.mockReturnValueOnce(pending.promise);
  const tick = start();

  try {
    stop!();
    expect(clear).toHaveBeenCalledWith(schedule.mock.results[0]!.value);

    tick();
    expect(purge).toHaveBeenCalledTimes(1);

    // WHEN: the already-running query finishes with enough rows for another batch.
    pending.resolve(1000);
    await settleCleanup();
    tick();
    await settleCleanup();

    expect(purge).toHaveBeenCalledTimes(1);
  } finally {
    pending.resolve(0);
    await settleCleanup();
  }
});
