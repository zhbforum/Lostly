import { createApp } from '@/app';
import { startSessionCleanup } from '@/auth/session-cleanup';
import { readR2Config } from '@/storage/r2-storage';

readR2Config();

const app = createApp(undefined, { authRateLimit: true });
let stopCleanup: (() => void) | undefined;
app
  .onStart(() => {
    stopCleanup = startSessionCleanup();
  })
  .onStop(() => {
    stopCleanup?.();
  })
  .listen(3000);

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
