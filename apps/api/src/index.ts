import { app } from '@/app';
import { createAuthRateLimit } from '@/auth/rate-limit';
import { startSessionCleanup } from '@/auth/session-cleanup';
import { readR2Config } from '@/storage/r2-storage';

readR2Config();

let stopCleanup: (() => void) | undefined;
app
  .use(createAuthRateLimit())
  .onStart(() => {
    stopCleanup = startSessionCleanup();
  })
  .onStop(() => {
    stopCleanup?.();
  })
  .listen(3000);

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
