import { createApp } from '@/app';
import { startSessionCleanup } from '@/auth/session-cleanup';
import { objectStorage, readR2Config } from '@/storage/r2-storage';
import { startEvidenceCleanup } from '@/moderation/evidence-retention';

readR2Config();

const app = createApp(undefined, { authRateLimit: true });
let stopCleanup: (() => void) | undefined;
let stopEvidenceCleanup: (() => void) | undefined;
app
  .onStart(() => {
    stopCleanup = startSessionCleanup();
    stopEvidenceCleanup = startEvidenceCleanup(objectStorage);
  })
  .onStop(() => {
    stopCleanup?.();
    stopEvidenceCleanup?.();
  })
  .listen(3000);

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
