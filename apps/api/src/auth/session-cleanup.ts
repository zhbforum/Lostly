import { sql } from 'drizzle-orm';
import { db } from '@/db';

export async function purgeExpiredSessions(): Promise<number> {
  const removed = await db.execute(sql`
    with expired as (
      select id from sessions where expires_at <= now()
      order by expires_at, id limit 1000 for update skip locked
    )
    delete from sessions using expired where sessions.id = expired.id returning sessions.id
  `);
  return removed.length;
}

export function startSessionCleanup() {
  let running = false;
  let stopped = false;
  async function run() {
    if (running || stopped) return;
    running = true;
    try {
      for (let batch = 0; batch < 10 && !stopped; batch++) {
        if ((await purgeExpiredSessions()) < 1000) break;
      }
    } catch {
      console.error(JSON.stringify({ level: 'error', event: 'session_cleanup_failed' }));
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => {
    void run();
  }, 15 * 60_000);
  timer.unref();
  void run();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
