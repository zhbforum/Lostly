import { SESSION_COOKIE_NAME } from '@/auth/cookie';
import { getSession } from '@/auth/service';
import { createRateLimiter } from '@/http/rate-limit';

export const IMAGE_UPLOAD_CONCURRENCY = { requests: 4, perUser: 1 } as const;

export type ImageUploadIngressResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'unauthenticated' | 'busy' | 'upload-aborted' };

export interface ImageUploadIngress {
  begin(request: Request, ip: string): Promise<ImageUploadIngressResult>;
  finish(request: Request): void;
}

// Reserve a bounded pre-auth slot, then bind it to a verified user before reading any bytes.
export function createImageUploadIngress(): ImageUploadIngress {
  const rateLimit = createRateLimiter(30, 60_000);
  const requests = new Map<Request, string | null>();
  const users = new Map<string, number>();

  function finish(request: Request) {
    const userId = requests.get(request);
    if (!requests.delete(request)) return;
    if (request.body && !request.body.locked) void request.body.cancel().catch(() => {});
    if (!userId) return;
    const remaining = (users.get(userId) ?? 1) - 1;
    if (remaining > 0) users.set(userId, remaining);
    else users.delete(userId);
  }

  async function begin(request: Request, ip: string): Promise<ImageUploadIngressResult> {
    let accepted = false;
    // Track before admission so even a limit rejection uses the same cleanup path.
    requests.set(request, null);
    try {
      if (requests.size > IMAGE_UPLOAD_CONCURRENCY.requests || rateLimit(ip) !== null)
        return { ok: false, reason: 'busy' };
      const token = new Bun.CookieMap(request.headers.get('cookie') ?? '').get(SESSION_COOKIE_NAME);
      const auth = token ? await getSession(token) : null;
      if (!auth) return { ok: false, reason: 'unauthenticated' };
      if (request.signal.aborted) return { ok: false, reason: 'upload-aborted' };
      const running = users.get(auth.user.id) ?? 0;
      if (running >= IMAGE_UPLOAD_CONCURRENCY.perUser) return { ok: false, reason: 'busy' };
      users.set(auth.user.id, running + 1);
      requests.set(request, auth.user.id);
      accepted = true;
      return { ok: true, userId: auth.user.id };
    } finally {
      // Early onRequest responses may skip route cleanup. Do not retain their body or slots.
      if (!accepted) finish(request);
    }
  }

  return { begin, finish };
}
