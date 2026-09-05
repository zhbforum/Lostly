import { app } from '@/app';
import { createAuthRateLimit } from '@/auth/rate-limit';
import { startSessionCleanup } from '@/auth/session-cleanup';

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
