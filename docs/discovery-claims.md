# Discovery and claims

## HTTP API

All endpoints require the session cookie. Mutations also require the existing CSRF protection header.

| Endpoint                    | Purpose                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /listings`             | Active reports; optional `kind=lost                                                      | found`and`sort=newest | oldest | occurredOnDesc | occurredOnAsc` |
| `GET /listings/:id`         | Report, server-derived capabilities, and the current viewer's own claim                  |
| `POST /listings/:id/claims` | Submit private `verificationDetails` for an active found report                          |
| `GET /listings/:id/claims`  | Paginated claims with private proof; report owner only                                   |
| `PATCH /claims/:claimId`    | Owner decision: `rejected`, or `approved` with private `handoverDetails`                 |
| `GET /me/listings`          | Current user's reports, including resolved and archived; same filters/sorts as discovery |
| `GET /me/claims`            | Current user's claim summaries; `direction=outgoing` (default) or `incoming`             |

List endpoints accept an integer `limit` from 1 to 50 (default 20) and an opaque `cursor`.
Responses contain `pageInfo: { endCursor, hasNextPage }`; use `endCursor` for the next request.
An invalid cursor or one from another filter/order/user/report returns `400 INVALID_CURSOR`.
Changing filters must discard the cursor. Cursors from the previous implementation are intentionally invalid.

## Privacy and lifecycle

Verification details are visible only to their author and the report owner. Handover instructions
are visible only to the approved claimant and the report owner. Activity summaries never include either.
API responses are marked `private, no-store`; private content must not be logged or added to public selections.

The server obtains actor IDs from the authenticated session, not the request body. A user cannot claim
their own report, claim a lost/inactive report, or submit a second claim for the same report.
Only pending claims on an active report can be decided by its owner.

Approval atomically resolves the report and rejects the other pending claims. It requires 10–1000
characters of private collection instructions. Rejection leaves the report active. The current
`resolved` status means a claimant has been approved, not independently confirmed physical delivery.
A future two-party delivery confirmation should be a separate lifecycle transition.

Creation and decisions always lock the parent listing **before** locking/updating claims. Future
archive, reopen, transfer, and bulk-review operations must preserve this ordering and the same state
invariants. Database unique indexes enforce one claim per claimant/report and at most one approved
claim per report. Existing approved claims may have null instructions; the UI supports those legacy rows.

## Pagination and UI

Keyset pagination compares `(sort column, id)`. Timestamp cursor values are read as UTC text with
PostgreSQL microsecond precision and passed back as timestamp parameters without a JavaScript Date
round-trip. IDs break ties for all four sort orders. Matching indexes support the public feed,
per-report incoming claims, and each user's default activity order.

The browse page stores filters and cursors in the URL. Details links preserve the return URL and
feed pagination separately from incoming-claims pagination. `/activity` exposes My reports,
My claims, and Incoming claims even after a report disappears from the active feed.
Successful mutations refetch report details and claims together; errors permit retry/refresh.

## Verification and rollout

From the repository root:

```sh
bun run --cwd apps/api typecheck
bun run --cwd apps/api test
bun run --cwd apps/web test
bun run --cwd apps/web build
bun run lint
```

Apply all pending migrations with `bun run --cwd apps/api db:migrate` using the intended database
configuration before deploying the API. Deploy the updated web client and API together: approval
now requires `handoverDetails`, and incoming claims are paginated. Review existing data before
production rollout: the approved-claim unique index intentionally fails if multiple approved claims
already exist for one report; do not silently discard such records. Index creation may require a
maintenance window on a large database.

For integration tests, point `DATABASE_URL` at a **dedicated disposable** PostgreSQL 18 database
named `lostly_test`, apply migrations there, then run `bun run --cwd apps/api test:integration`.
These tests clear application tables; never point them at development/production data.
CI provisions this database and runs migrations, API integration tests, and web tests.
Regression coverage includes route compilation, malformed input, microsecond/tied ordering,
concurrent approval/submission, authorization, private handover, resolved history, and UI refresh/navigation.
