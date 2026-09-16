import { openapi } from '@elysia/openapi';

import { SESSION_COOKIE_NAME } from '@/auth/cookie';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@/http/csrf';

export const openApiSessionSecurity = [{ sessionCookie: [] }];

export const openApiCsrfSecurity = [{ csrfProtection: [] }];

export const openApiMutationSecurity = [
  {
    sessionCookie: [],
    csrfProtection: [],
  },
];

export const openApiPlugin = openapi({
  enabled: process.env.NODE_ENV !== 'production',
  path: '/openapi',
  scalar: { url: '/openapi/json' },
  documentation: {
    info: {
      title: 'Lostly API',
      version: '0.1.0',
      description:
        'HTTP API for Lostly. Authenticated endpoints use an HttpOnly session cookie. Unsafe requests require the CSRF protection header.',
    },
    tags: [
      {
        name: 'Listing images',
        description: 'Report photos, private storage and owner photo management.',
      },
      {
        name: 'System',
        description: 'API metadata and service health.',
      },
      {
        name: 'Authentication',
        description: 'Registration, login, session restoration, and logout.',
      },
      {
        name: 'Listings',
        description: 'Lost and found reports, discovery, and report details.',
      },
      {
        name: 'Claims',
        description: 'Ownership claims, review, and reunion workflow.',
      },
      {
        name: 'Activity',
        description: 'Authenticated user report and claim history.',
      },
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: SESSION_COOKIE_NAME,
          description:
            'HttpOnly session cookie issued by registration or login. Browser clients should use the cookie set by the API instead of handling the session token directly.',
        },
        csrfProtection: {
          type: 'apiKey',
          in: 'header',
          name: CSRF_HEADER_NAME,
          description: `Required with value "${CSRF_HEADER_VALUE}" for unsafe HTTP methods.`,
        },
      },
    },
  },
});
