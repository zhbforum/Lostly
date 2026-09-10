# Reliability and operations

## Errors and authentication

Request normalization checks runtime types before applying string operations; passwords are never trimmed.
Invalid fields return `422 VALIDATION_ERROR`, malformed JSON returns `400 INVALID_JSON`, and unexpected
failures return a generic `500 INTERNAL_ERROR`. Unexpected response-schema failures are server errors too.
Error responses never echo request bodies, SQL or exception text. Unexpected failures emit a structured
JSON event and an `X-Request-Id` correlation header; request bodies, cookies and private proof are not logged.
Auth DTOs and the error envelope are shared through `@lostly/contracts`.

The web API client publishes session expiry only for `401 UNAUTHENTICATED`, not incorrect login credentials.
Requests are associated with a session generation, so a delayed failure from an old session cannot clear
a newer login. Auth bootstrap is abortable and cannot overwrite a newer authentication operation.

Login/register preserve the internal destination, query, fragment and navigation state. External addresses,
protocol-relative addresses and authentication redirect loops are rejected. Report, claim and handover drafts
stay only in memory in the current tab during reauthentication. They are restored for the same account,
cleared on explicit logout/account switch, and discarded after successful submission. Passwords are never
stored as drafts. Reloading or closing the tab loses these drafts. Mutations are never automatically replayed.

Edit-report drafts are keyed by listing ID and server `version`. Reauthentication restores unsaved
fields only for the same report version; a refreshed server version starts a new form instance.
Successful saves discard that version's draft before navigation. The update confirmation is consumed
once from navigation state without dropping the URL query, fragment, or other state; it does not repeat
after reloading the details page.

## OpenAPI documentation

In non-production environments the API exposes interactive OpenAPI documentation at `/openapi` and the
generated OpenAPI 3.1 document at `/openapi/json`. When `NODE_ENV=production`, the application disables these endpoints.

The document is generated from the same Elysia request, parameter and response schemas used at runtime.
Route metadata adds operation summaries, feature tags and the browser security contract without introducing
a separate set of API DTOs.

Authenticated requests use the `lostly_session` HttpOnly cookie. Unsafe requests also require
`X-CSRF-Protection: 1`. OpenAPI models authenticated mutations as requiring both mechanisms, while
registration, login and idempotent logout require CSRF protection without requiring an existing session.

OpenAPI security requirements are declared explicitly per operation. They are not inherited from the
authentication macro because combining macro-level and route-level security arrays would represent
alternative OpenAPI requirements rather than the API's required session-and-CSRF combination.

## Build and test

`VITE_API_URL` must be an explicit absolute HTTP(S) URL without credentials, query or fragment.
Vite validates it during configuration loading, so a missing value fails before a broken bundle is produced.
Set it independently for each build environment; it is public build-time configuration, not a secret.
CI sets `http://localhost:3000` for its local test API.

```sh
bun run --cwd apps/api typecheck
bun run --cwd apps/api test
bun run --cwd apps/web test
bun run --cwd apps/web build
bun --bun run --cwd apps/admin test --watch=false
bun --bun run --cwd apps/admin build
bun run lint
bun run format:check
```

Admin CI uses the Bun runtime explicitly, avoiding a dependency on an unrelated globally installed Node
version. If running Angular under Node instead, use a version supported by the installed Angular CLI.

The browser test uses Chromium and the production web bundle, a real API and a dedicated PostgreSQL 18
database. It creates uniquely named fixture data only in `lostly_test`; it does not reuse a running API.
Set `DATABASE_URL` to this disposable database, apply migrations there, build web with
`VITE_API_URL=http://localhost:3000`, then run from `apps/web`:

```sh
bunx playwright install chromium
bun run test:e2e
```

Ports 3000 and 4173 must be free. The test covers login, return to the intended form, creation, editing,
resolution, disappearance from discovery, My reports, archiving, and reopening/reloading the archived
report with the session cookie. Reopening its page does not reactivate it. CI runs API integration tests,
both UI test suites and this browser test. Failure traces contain synthetic test data; avoid publishing
traces from real user sessions.

Owner controls require the listing-version migration. Apply pending API migrations before starting
the updated API so existing listings receive `version = 1`. Deploy API and web together so the client
receives the new edit/resolve/archive capabilities and sends `expectedVersion` for edits. All
listing/claim mutations use the same parent row lock; integration concurrency tests verify actual
PostgreSQL lock waiting in both orders. See
[owner controls and lifecycle rules](discovery-claims.md#listing-owner-controls-7).

## Runtime protection

The API entrypoint installs a bounded process-local limiter before auth handlers: 20 login attempts and
5 registrations per socket IP per minute, plus a global budget of 200 auth attempts per minute. Exhaustion
returns `429 RATE_LIMITED` with `Retry-After`. Arbitrary forwarded-IP headers are not trusted. Behind a reverse
proxy, its socket IP is shared; configure trusted client-IP handling at the gateway and a distributed limit
there or in Redis before scaling to multiple API processes. This limiter is a baseline, not DDoS protection.

The entrypoint also starts session cleanup immediately and every 15 minutes. It deletes only expired rows,
in batches of 1000 (up to ten batches per run), using `SKIP LOCKED`. Runs do not overlap in one process;
multiple processes can cooperate safely. The expiration index is included in migrations. Shutdown stops
scheduling new batches. Cleanup failures produce a sanitized structured log event and retry next interval.

## Deployment checklist

Infrastructure is environment-specific; this checklist does not provision a deployment or backup service.

1. Provision PostgreSQL 18, private networking and a least-privilege application role. Inject database
   credentials through your deployment secret store, never into Vite variables or Git.
2. Define backup retention, encryption, access controls and recovery objectives. Schedule logical backups
   with `pg_dump` or managed backups, and regularly restore a backup into a separate empty database.
   Verify row counts, migrations and application smoke tests there before relying on the backup process.
3. Take and verify a backup before migrations. Apply pending migrations using the intended database
   configuration; assess table/index locking and schedule a maintenance window when needed.
4. Build web with its environment's `VITE_API_URL`. Serve its assets over HTTPS with SPA fallback to
   `index.html`; set `WEB_ORIGIN` and `ADMIN_ORIGIN` to exact allowed origins on the API.
5. Run the API with `NODE_ENV=production` behind HTTPS, with restart/healthcheck supervision. Production
   cookies are secure; plain HTTP is unsuitable. Use same-site deployment or review cookie policy explicitly
   before choosing unrelated domains for web and API. `/health` checks database availability.
6. Collect structured error events, alert on sustained 5xx, cleanup failures and unhealthy instances, and
   enforce gateway request-size/rate limits. Do not log authorization cookies or private claim content.
7. Validate the browser smoke flow in staging. Roll back application releases only when compatible with
   the applied schema; do not automatically reverse migrations or overwrite live data during rollback.

References: [Elysia lifecycle and error handling](https://elysiajs.com/essential/life-cycle),
[Elysia OpenAPI](https://elysiajs.com/plugins/openapi),
[Vite environment configuration](https://vite.dev/guide/env-and-mode),
[Playwright CI setup](https://playwright.dev/docs/ci-intro).
