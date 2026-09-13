# Angular admin foundation (#9)

`apps/admin` is a small moderation console: session login, dashboard totals, paginated
listings/users/claims, listing details, and two confirmed moderation actions. It uses the
existing Angular router, forms, HttpClient, and shared TypeScript contracts. There is no
separate identity system or client token storage.

## Run locally

From the repository root, install with `bun install`. Configure `apps/api/.env` using its
example, then apply migrations to the intended development database:

```sh
bun run --cwd apps/api db:migrate
bun run --cwd apps/api dev
```

In another terminal:

```sh
bun --bun run --cwd apps/admin start
```

Open `http://localhost:4200`. The development proxy sends `/api/**` to
`http://localhost:3000`, stripping `/api`. Requests use the existing HttpOnly session
cookie and `X-CSRF-Protection: 1` for mutations.

Register an account through the web application first. A project operator can promote
that specific account in the intended database:

```sql
UPDATE users
SET role = 'admin', updated_at = now()
WHERE lower(email) = lower('your-admin@example.com')
RETURNING id, email, role;
```

Confirm exactly one intended account was returned. No default admin, shared password,
public promotion endpoint, or role editor is provided. Session resolution reads the
current database role on every protected request, including after role revocation.

## API and moderation behavior

Every `/admin/*` endpoint requires a session with `role = admin`. Missing sessions receive
401 and ordinary users receive 403. The client guard is for navigation; the API enforces
authorization independently. Responses retain the global `private, no-store` policy.

| Endpoint                           | Behavior                                                        |
| ---------------------------------- | --------------------------------------------------------------- |
| `GET /admin/overview`              | Total users/listings, active listings, pending claims           |
| `GET /admin/listings`              | All statuses, public report fields and owner identity           |
| `GET /admin/users`                 | Account ID, display name, email, role and creation date         |
| `GET /admin/claims`                | Claim status, listing summary and claimant identity             |
| `POST /admin/listings/:id/archive` | `{ expectedVersion, reason }`; archive and close pending claims |
| `POST /admin/claims/:id/reject`    | `{ reason }`; reject one pending claim on an active listing     |

List responses are `{ items, pageInfo }`. They accept `limit` (1–50, default 20) and
`cursor`, using the existing timestamp/UUID keyset pagination in newest-first order.
Cursors belong to a resource; invalid or cross-resource cursors receive 400. The UI
provides Previous/Next and Refresh. Counts are current totals, not analytics snapshots.

Moderation reasons are trimmed and must contain 3–500 characters. Successful actions
return 204. Missing targets return 404. A changed listing version, archived listing,
completed claim, or inactive parent receives 409 without modifying data. The UI refreshes
on a conflict; network failures preserve the reason for retry. Archive checks the version
shown to the moderator to avoid acting on a report edited since it was read.

Both actions lock the parent listing before reading mutable state or updating claims,
using the same lock ordering as owner edits, claim creation and owner decisions.
Archive reuses the owner workflow's closing operation, increments the listing version,
and rejects pending claims with the actual administrator's ID and matching timestamps.
Completed claims and handover history are preserved. Claim rejection leaves the listing
active and does not decide other claims.

Each successful action writes a `moderation_events` row in the same transaction:
actor ID, target ID, action, reason and timestamp. Failure rolls back both the action
and its audit event. Historical identifiers deliberately have no cascading foreign keys;
deleting a target or actor in a future workflow must not erase the moderation record.
The journal is currently inspected in the database; no journal management endpoint exists.

Ownership proof and handover instructions are omitted from admin summaries. Their
existing owner/claimant access rules remain unchanged. Archiving removes a report from
discovery; its detail page and history remain accessible. Archive is not content erasure.

## Deploy and verify

Apply the `moderation_events` migration before deploying the updated API. Build the
console with `bun --bun run --cwd apps/admin build` and serve `apps/admin/dist/admin/browser`.
Configure the production reverse proxy to forward `/api/*` to the API, removing `/api`,
before applying the SPA fallback to `index.html`. Use HTTPS and `NODE_ENV=production` on
the API for secure cookies. The Angular development proxy is not included in the build.

```sh
bun run --cwd apps/api typecheck
bun run --cwd apps/api test
bun --bun run --cwd apps/admin test --watch=false
bun --bun run --cwd apps/admin build
bun run lint
bun run format:check
```

For database and browser checks, set `DATABASE_URL` explicitly to a dedicated disposable
PostgreSQL 18 database named `lostly_test`, apply migrations there, then run:

```sh
bun run --cwd apps/api test:integration
bun run --cwd apps/admin test:e2e
```

Integration tests clear application tables. The browser test starts its own API on port
3000 and Angular server on port 4200, creates test accounts, and promotes its test admin
directly in the test database. Install Playwright Chromium if absent using
`bunx playwright install chromium` from `apps/admin`. CI runs both test suites.

The foundation deliberately keeps users read-only and omits account bans, role changes,
claim approval on behalf of owners, bulk actions, search/filter tooling and analytics.
Those need explicit product rules or demonstrated moderation volume before expansion.
