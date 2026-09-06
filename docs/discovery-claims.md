# Discovery and claims

## HTTP API

All endpoints require the session cookie. Mutations also require the existing CSRF protection header.

| Endpoint                     | Purpose                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /listings`              | Active reports with optional kind and sort filters                                       |
| `GET /listings/:id`          | Report, server-derived capabilities, and the current viewer's own claim                  |
| `PATCH /listings/:id`        | Owner edits all four editable fields of an active report                                 |
| `POST /listings/:id/resolve` | Owner manually completes an active report and closes pending claims                      |
| `POST /listings/:id/archive` | Owner archives an active or resolved report                                              |
| `POST /listings/:id/claims`  | Submit private `verificationDetails` for an active found report                          |
| `GET /listings/:id/claims`   | Paginated claims with private proof; report owner only                                   |
| `PATCH /claims/:claimId`     | Owner decision: `rejected`, or `approved` with private `handoverDetails`                 |
| `GET /me/listings`           | Current user's reports, including resolved and archived; same filters/sorts as discovery |
| `GET /me/claims`             | Current user's claim summaries; `direction=outgoing` (default) or `incoming`             |

List endpoints accept an integer `limit` from 1 to 50 (default 20) and an opaque `cursor`.
Report filters accept `kind=lost` or `kind=found`; sort accepts `newest`, `oldest`,
`occurredOnDesc`, or `occurredOnAsc`.
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
`resolved` status means the report workflow has been completed, either by approving a claim or by
manual owner resolution. It does not independently confirm physical delivery.
A future two-party delivery confirmation should be a separate lifecycle transition.

Claim creation, decisions, and all owner mutations (including edit) always lock the parent listing
**before** checking its state or locking/updating claims. Any future operations must preserve this ordering and the same state
invariants. Database unique indexes enforce one claim per claimant/report and at most one approved
claim per report. Existing approved claims may have null instructions; the UI supports those legacy rows.

## Listing owner controls (#7)

The owner can edit or manually resolve only an `active` report. Archiving permits `active → archived`
and `resolved → archived`. There is no reactivation or reopen transition. Repeating resolve or archive
returns a state conflict rather than a successful no-op.

PATCH requires the complete payload `{ title, description, location, occurredOn }`. Text fields are
trimmed and use the same length limits as creation; `occurredOn` is a real calendar date in `YYYY-MM-DD`
form. Unknown fields, including `kind`, `status`, `createdByUserId`, `id`, `createdAt`, and `updatedAt`,
return `422 VALIDATION_ERROR` without changing any part of the record. A route-local transform checks
keys before Elysia normalization. Global normalization and `POST /listings` behavior are unchanged.
The service also explicitly selects the four writable fields. Actor IDs always come from the session.

Each mutation runs in a transaction, acquires the shared `listings/locking.ts` `FOR UPDATE` lock,
checks ownership and the domain transition, and then writes. Its timestamp is created after the lock.
Closing an active report atomically rejects every pending claim with `reviewedByUserId` set to the
owner and `reviewedAt` / `updatedAt` equal to the listing's new `updatedAt`. Already approved/rejected
claims are untouched, including private handover instructions and previous audit fields. Archiving
a resolved report does not change claim history at all. Edit also uses the shared lock so it cannot
save changes after a competing operation closes the report.

Missing reports return `404 LISTING_NOT_FOUND`. Another user receives `403 LISTING_UPDATE_FORBIDDEN`,
`LISTING_RESOLVE_FORBIDDEN`, or `LISTING_ARCHIVE_FORBIDDEN`. State conflicts return `409` with
`LISTING_NOT_EDITABLE`, `LISTING_NOT_RESOLVABLE`, or `LISTING_ALREADY_ARCHIVED`. Valid unauthenticated
requests return `401 UNAUTHENTICATED`; malformed bodies/UUIDs can return `422` before authentication,
and missing CSRF protection returns `403 CSRF_VALIDATION_FAILED`, consistent with existing routes.

`canEdit`, `canResolve`, and `canArchive` combine ownership with the same domain policy functions used
by mutations. The web client uses these capabilities to display controls. `canReviewClaims` remains
true for the owner of a found report in every status so completed claim history stays accessible.
Rejected claims use neutral wording: their precise closure reason is not stored or inferred.

Archive removes a report from active discovery; **it is not a privacy mechanism**. Resolved and
archived reports remain in `GET /me/listings` and are still accessible to authenticated viewers by
`GET /listings/:id`. Existing privacy restrictions on proof and handover instructions remain in force.

Owner controls live on `/listings/:id`; `/listings/:id/edit` loads the report and requires `canEdit`.
Resolve/archive use accessible confirmation dialogs that warn about closing pending claims and
the absence of reactivation. Successful edits return to refreshed details. Closing a report refreshes
details and incoming claims together. A conflicting edit explains that the report's status changed,
preserves the entered text, disables saving, and offers navigation back to current details. A closing
action conflict refreshes the current status and capabilities. Network errors permit retry/refresh.

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

Owner management concurrency tests pause the real lock helper after the first transaction acquires
its row lock, then start the second mutation. They query PostgreSQL `pg_stat_activity` and
`pg_blocking_pids` to prove that the second connection is blocked on the listing's `FOR UPDATE`,
then release the first operation. Both acquisition orders are covered for edit, claim creation, and
claim approval against resolve and archive. Assertions include final listing/claims state, shared
audit timestamps and actor IDs, and preservation of completed claim data. These tests require real
PostgreSQL and must not be replaced with mocked database calls or simultaneous-request-only tests.

The browser flow covers sign-in, lost-report creation, editing, manual resolution, disappearance
from discovery, navigation through My reports, archiving, and reopening/reloading the archived
report's page. This final reopening does not change the archived status.
