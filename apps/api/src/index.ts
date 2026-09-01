import { Elysia } from 'elysia';
import { sql } from 'drizzle-orm';

import { db } from '@/db';

const app = new Elysia()
  .get('/', () => ({
    name: 'Lostly API',
    status: 'ok',
  }))
  .get('/health', async ({ status }) => {
    try {
      await db.execute(sql`select 1`);

      return {
        status: 'ok',
        database: 'connected',
      };
    } catch {
      return status(503, {
        status: 'error',
        database: 'unavailable',
      });
    }
  })
  .listen(3000);

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
