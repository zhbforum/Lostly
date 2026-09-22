# Lostly Admin

Minimal moderation console: listings, users and claim summaries; photo review;
search and filters; archive, hide/restore and claim rejection with recorded reasons.
Account roles are managed by the operator. Claim proof and handover details are never
included in admin responses.

## Local development

From the repository root, run `bun ci`. Start the API with its configured PostgreSQL
and private R2 bucket, then run `bun run --cwd apps/admin start` under Node.js 24.15.0.
The development server at `http://localhost:4200` forwards `/api/*` to port 3000.
Add that admin origin to the API's `ADMIN_ORIGIN` setting.

## Deployment

1. Back up the database and apply migrations with `bun run --cwd apps/api db:migrate`.
   The admin migrations add moderation events, listing visibility (existing reports
   remain visible), and the history index. Photo tables from main are preserved.
2. Build with `bun --bun run --cwd apps/admin build`. Serve
   `apps/admin/dist/admin/browser` from a dedicated HTTPS origin with an SPA fallback
   to `index.html` for application routes. Do not use the development server in production.
3. Reverse proxy `/api/*` to the API, stripping `/api`. Forward cookies and responses
   unchanged, including `Set-Cookie`, status codes and `Cache-Control`. Never cache
   `/api/*`, and do not apply the SPA fallback to API errors. Revalidate `index.html`;
   hashed JS/CSS assets may be cached immutably.
4. Set `NODE_ENV=production`, the exact `ADMIN_ORIGIN`, and all R2 settings on the API.
   Keep the bucket private. R2 credentials stay on the server. The admin build has no secrets.
5. Provision an administrator by promoting a verified existing account through the
   database. There are no default credentials or public role-assignment endpoints.

Before release, verify admin login and member rejection; direct URL reloads; session
expiry and return to the filtered page; photo review; hide/restore; history reasons;
and a stale moderation action returning a conflict. Check the API `/health` endpoint.
Use the same backup/restore procedure as the API deployment; do not drop moderation
history to roll back a frontend release.

## Visibility and storage

Hidden reports and their claims are excluded from ordinary API reads, including the
owner's activity. Photo uploads, upload retries, deletion and ordering are blocked
under the listing lock. Administrators can review retained photos and history through
admin endpoints. Restore preserves the existing lifecycle status and claim history.

Previously issued R2 signed URLs remain usable until their expiry (currently up to
one hour); hiding does not revoke those URLs or delete objects. Immediate revocation
requires an authorized image proxy or a separate object-rotation design. Review photos
are loaded on demand; use **Reload review** to refresh expired links or recover from
a storage/network failure. Unknown storage outcomes and orphan cleanup follow the
existing API operational process.

## Validation

Run `bun --bun run --cwd apps/admin test --watch=false` and
`bun --bun run --cwd apps/admin build`. For browser tests, set `DATABASE_URL` to a
disposable database named `lostly_test`, apply migrations, install Playwright Chromium,
and run `bun run --cwd apps/admin test:e2e`. The test API uses in-memory object storage;
it does not contact R2. CI also runs API unit/integration tests and the web browser flows.
