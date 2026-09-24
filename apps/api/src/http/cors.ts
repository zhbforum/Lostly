import { cors } from '@elysia/cors';

const DEFAULT_WEB_ORIGIN = 'http://localhost:5173';
const DEFAULT_ADMIN_ORIGIN = 'http://localhost:4200';

export const corsPlugin = cors({
  origin: [
    process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN,
    process.env.ADMIN_ORIGIN ?? DEFAULT_ADMIN_ORIGIN,
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Protection', 'Idempotency-Key'],
  exposeHeaders: ['Retry-After'],
  credentials: true,
});
