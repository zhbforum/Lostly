# Lostly

**Helping lost belongings find their way home.**

Lostly is a lost-and-found platform that connects people with their missing belongings.
Users publish lost or found items, submit ownership claims for found items, and arrange
returns through private conversations. A separate admin console handles reports,
appeals, and moderation.

[![CI](https://github.com/zhbforum/Lostly/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/zhbforum/Lostly/actions/workflows/ci.yml)

![Bun](https://img.shields.io/badge/Bun-1.4.0-000000?style=flat-square&logo=bun&logoColor=white)
![Elysia](https://img.shields.io/badge/Elysia-1.4.x-7C3AED?style=flat-square)
![TypeScript API](https://img.shields.io/badge/TypeScript%20API-7.x-3178C6?style=flat-square&logo=typescript&logoColor=white)
![TypeScript Web/Admin](https://img.shields.io/badge/TypeScript%20Web%2FAdmin-6.x-3178C6?style=flat-square&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18.6-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Cloudflare R2](https://img.shields.io/badge/Cloudflare%20R2-object%20storage-F38020?style=flat-square&logo=cloudflare&logoColor=white)

![React](https://img.shields.io/badge/React-19.x-149ECA?style=flat-square&logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?style=flat-square&logo=vite&logoColor=white)
![Angular](https://img.shields.io/badge/Angular-22.x-DD0031?style=flat-square&logo=angular&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-4.x-6E9F18?style=flat-square&logo=vitest&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)

## Contents

- [Features](#features)
- [Stack and structure](#stack-and-structure)
  - [Repository map](#repository-map)
- [Architecture](#architecture)
  - [API boundaries and shared contracts](#api-boundaries-and-shared-contracts)
  - [Frontend organization](#frontend-organization)
  - [State changes and concurrency](#state-changes-and-concurrency)
  - [Conversations and data loading](#conversations-and-data-loading)
  - [Media storage and privacy](#media-storage-and-privacy)
  - [Authentication and moderation](#authentication-and-moderation)
- [Local development](#local-development)
- [Checks](#checks)
  - [Coverage](#coverage)
- [License](#license)

## Features

- **Listings:** lost and found posts with photos, filters, sorting, and active,
  resolved, or archived statuses.
- **Ownership claims:** private verification details, owner review, and handover
  instructions for an approved claim.
- **Conversations:** a private chat for each claim, with image attachments,
  message history, and unread counts.
- **Profiles:** usernames, avatars, public profiles, and personal listing and claim history.
- **Moderation:** report and appeal queues, case assignment, account restrictions,
  content review, workload tracking, and an audit trail.

## Stack and structure

A Bun Workspaces monorepo with three applications and a shared contracts package:

| Directory            | Purpose                                       | Technologies                          |
| -------------------- | --------------------------------------------- | ------------------------------------- |
| `apps/api`           | HTTP API and business logic                   | Bun, Elysia, PostgreSQL, Drizzle ORM  |
| `apps/web`           | User application                              | React, Vite, React Router, React Aria |
| `apps/admin`         | Moderation console                            | Angular, RxJS, SCSS                   |
| `packages/contracts` | Shared request/response types and constraints | TypeScript                            |

### Repository map

The main source directories, entry points, and configuration files:

<details>
<summary>Full repository tree</summary>

```text
.
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts            # Server startup and scheduled cleanup
│   │   │   ├── app.ts              # Elysia application factory and route composition
│   │   │   ├── openapi.ts          # API documentation and security schemes
│   │   │   ├── auth/              # Password/Google sign-in, sessions, cookies, rate limits
│   │   │   ├── listings/          # Listing feeds, editing, lifecycle, and row locks
│   │   │   ├── claims/            # Ownership claims, review, and handover details
│   │   │   ├── conversations/     # Chat access, messages, attachments, reads, and retries
│   │   │   ├── profile/           # Profiles, usernames, and avatar processing
│   │   │   ├── activity/          # The current user's listings and claims
│   │   │   ├── admin/             # Admin endpoints, record lookup, and moderation actions
│   │   │   ├── moderation/        # Cases, appeals, evidence, restrictions, and audit logic
│   │   │   ├── listing-images/    # Listing photo upload, ordering, and deletion
│   │   │   ├── image-upload/      # Shared upload limits, decoding, processing, and cleanup
│   │   │   ├── storage/           # Object storage interface and Cloudflare R2 adapter
│   │   │   ├── domain/            # Listing, claim, conversation, and user rules
│   │   │   ├── db/                # Database connection, tables, relations, and indexes
│   │   │   ├── http/              # CORS, CSRF, body limits, normalization, and errors
│   │   │   └── pagination/        # Cursor encoding, validation, and page queries
│   │   ├── tests/
│   │   │   ├── integration/       # PostgreSQL, HTTP, migration, and concurrency tests
│   │   │   └── support/           # Test server, image fixtures, and in-memory storage
│   │   ├── drizzle/               # Versioned SQL migrations and schema snapshots
│   │   └── drizzle.config.ts      # Schema locations and migration configuration
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── main.tsx       # React entry point
│   │   │   │   ├── router/        # Routes, access checks, and lazy page loading
│   │   │   │   ├── providers/     # Application-wide context composition
│   │   │   │   ├── navigation/    # Main application navigation
│   │   │   │   └── styles/        # Global styles
│   │   │   ├── pages/             # Route screens: auth, listings, messages, profile, etc.
│   │   │   ├── features/
│   │   │   │   ├── auth/          # Sign-in forms, session state, and account menu
│   │   │   │   ├── listings/      # Listing forms, feeds, galleries, and photo management
│   │   │   │   ├── claims/        # Claim submission, review controls, and status display
│   │   │   │   ├── conversations/
│   │   │   │   │   ├── api/       # Conversation and message HTTP calls
│   │   │   │   │   ├── model/     # Hooks, polling, drafts, read state, and send operations
│   │   │   │   │   └── ui/        # Inbox, message list, composer, and attachment views
│   │   │   │   ├── profile/       # Profile editing, avatars, and username availability
│   │   │   │   ├── moderation/    # User reports and moderation API calls
│   │   │   │   └── activity/      # Personal listing and claim history API calls
│   │   │   ├── shared/
│   │   │   │   ├── api/           # HTTP client, session events, and retry handling
│   │   │   │   ├── model/         # Shared resource hooks, polling, and form drafts
│   │   │   │   ├── navigation/    # Return URLs and profile/conversation links
│   │   │   │   ├── ui/            # Reusable avatar, brand, and pagination components
│   │   │   │   └── lib/           # Small framework-independent utilities
│   │   │   └── test/              # Test setup, fixtures, and browser API mocks
│   │   ├── config/                # Build-time environment validation
│   │   ├── e2e/                   # Playwright scenarios and browser-test helpers
│   │   ├── public/                # Static assets
│   │   ├── vite.config.ts         # Vite, React, Vitest, and coverage configuration
│   │   ├── playwright.config.ts   # Full browser flows against the test API
│   │   └── playwright.ui.config.ts # UI browser tests with mocked HTTP
│   └── admin/
│       ├── src/
│       │   ├── main.ts            # Angular bootstrap
│       │   ├── styles.scss        # Global admin styles
│       │   └── app/
│       │       ├── app.ts          # Application shell; app.html and app.scss sit beside it
│       │       ├── app.config.ts   # Angular providers
│       │       ├── app.routes.ts   # Routes and admin navigation guards
│       │       ├── api.ts          # HTTP service, session checks, and route guard
│       │       ├── login.ts        # Admin sign-in screen
│       │       ├── dashboard.ts    # Workload and case overview
│       │       ├── records.ts      # Record search and filters; template in records.html
│       │       ├── entity.ts       # Linked user, listing, and claim details
│       │       ├── case-queue.ts   # Report and appeal queue
│       │       ├── case-detail.ts  # Case review, assignment, evidence, and decisions
│       │       ├── audit.ts        # Global moderation audit history
│       │       ├── action.ts       # Reusable moderation action form
│       │       └── review.ts       # Photo review and moderation history
│       ├── e2e/                   # Playwright moderation workflows
│       ├── public/                # Static assets
│       ├── angular.json           # Angular build, development server, and test targets
│       └── proxy.conf.json        # Local /api forwarding to the backend
├── packages/
│   └── contracts/
│       └── src/                   # Shared types and constraints, grouped by domain
├── .github/workflows/ci.yml       # Formatting, linting, builds, and test pipeline
├── compose.yaml                   # Local PostgreSQL service and persistent volume
├── package.json                   # Bun workspaces and shared tooling commands
└── bun.lock                       # Workspace dependency lockfile
```

</details>

Within API domains, `routes.ts` defines HTTP endpoints, `model.ts` holds request and
response schemas, and `queries.ts` contains database reads. Business operations live
in `service.ts` or focused files such as `claims/create.ts` and `claims/decide.ts`.

Larger Web features use the same `api/`, `model/`, and `ui/` split illustrated by
`conversations/`. Components keep their CSS Modules nearby. API and Web unit tests
live beside the source as `*.test.ts` or `*.test.tsx`; Angular tests use `*.spec.ts`
beside the components. Each application keeps its package and TypeScript configuration
at its own root.

For example, a listing change usually involves `apps/web/src/features/listings/`
for the UI, `apps/api/src/listings/` for server behavior, and
`packages/contracts/src/listings.ts` for shared types. Table changes belong in
`apps/api/src/db/`, with their migrations in `apps/api/drizzle/`.

## Architecture

Lostly uses a **modular monolith**: one API owns the business rules and persistence,
while Web and Admin are separate applications. PostgreSQL stores application state;
Cloudflare R2 stores private media.

```mermaid
flowchart LR
  Web["Web / React"] -->|HTTP| API["API / Bun + Elysia"]
  Admin["Admin / Angular"] -->|HTTP| API
  API -->|Drizzle ORM| DB[(PostgreSQL)]
  API -->|Object storage| R2["Cloudflare R2"]
```

### API boundaries and shared contracts

The API is organized around authentication, profiles, listings, claims, conversations,
and moderation. HTTP routes validate input and enforce access rules; service functions
coordinate business operations and database transactions. Domain helpers define valid
state transitions, and Drizzle manages SQL queries, schemas, and migrations.

`@lostly/contracts` supplies request and response types, allowed states, and shared
constraints to all three applications. Elysia schemas validate requests at the HTTP
boundary. Both frontends rely on the API for authorization and workflow decisions.

The `createApp` factory accepts an object storage implementation, allowing tests to
exercise real HTTP routes with in-memory media storage.

### Frontend organization

Web follows an `app → pages → features → shared` structure. The application layer
composes routing and providers; pages assemble screens; features own domain-specific
UI, hooks, and API calls. Shared modules handle HTTP requests, session events,
form drafts, pagination, and reusable UI. Several routes are loaded lazily.

Admin is an Angular application with dedicated routes for the dashboard, records,
moderation cases, and audit history. Route guards control navigation, while every
admin endpoint also checks the user's role on the server. Its `/api` requests are
forwarded to the same backend through a development proxy or a production reverse proxy.

### State changes and concurrency

PostgreSQL transactions keep related changes atomic. Creating a claim also creates
its conversation and two participants in the same transaction. Approving a claim
resolves the listing and rejects its remaining pending claims together.

Listing and claim mutations lock the parent listing before dependent rows, giving
concurrent operations a consistent lock order. Version checks reject stale edits
and moderation actions. For example, an old browser tab cannot silently overwrite
a newer listing revision.

Visibility is separate from lifecycle status: hiding a listing preserves its
resolved or archived state, claims, and history. Restoring it does not reopen the
ownership workflow.

### Conversations and data loading

Conversations belong to claims, and access is checked against both membership and
the associated listing. Messages receive a sequence number within the conversation;
read positions use that sequence to track unread messages.

Sends carry a client operation ID. Retrying the same operation returns the existing
message, while reusing its ID with different content produces a conflict. Database
uniqueness constraints reinforce message ordering and duplicate protection.

The Web conversation UI refreshes through HTTP polling that pauses when the tab is
hidden and coordinates overlapping requests. Listing, inbox, and moderation feeds
use cursor pagination with stable ordering and tie-breakers.

### Media storage and privacy

Images are stored in a private R2 bucket; PostgreSQL holds their metadata and
relationships. The API checks access before issuing temporary signed URLs. Storage
credentials remain on the server.

Sharp validates and processes uploads. Listing and conversation images are resized,
re-encoded as WebP, and stripped of embedded metadata. Upload size, pixel count,
processing time, and concurrency are bounded to control resource use.

Hiding content prevents new ordinary signed URLs from being issued. URLs already
issued remain usable until they expire.

### Authentication and moderation

Passwords use Argon2id. Authentication uses opaque session tokens in HttpOnly cookies,
with token hashes stored in PostgreSQL. Production cookies are Secure, origins are
explicitly configured, and unsafe HTTP methods require the `X-CSRF-Protection` header.
Google sign-in is optional for the user application.

Administrators are provisioned by project owners through the database. Moderation
actions record reasons and validate the target's current version or state; audit
events and user notifications commit with the corresponding state change.

Private conversation and ownership evidence requires a concrete case and an
explicitly reasoned, audited reveal. Evidence snapshots preserve the content used
for a decision and expire after 90 days. Internal notes and public decision text
are kept separate. Administrators cannot approve ownership claims or impersonate users.

## Local development

Requirements: **Bun 1.4**, **Node.js 24** for Angular CLI, and **Docker Compose**.
Run commands from the repository root.

```sh
bun ci
docker compose up -d
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

In `apps/api/.env`, set the connection URL for the Compose database:

```dotenv
DATABASE_URL=postgresql://lostly:lostly_dev@localhost:5432/lostly
```

Configure `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`
for a private Cloudflare R2 bucket; the API requires all four to start.
`WEB_ORIGIN` and `ADMIN_ORIGIN` default to the local frontend addresses in the example.
Web reads its API address from `VITE_API_URL` in `apps/web/.env`.

To enable Google sign-in, provide all three settings: `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. Leave them empty to use password
authentication only.

Apply database migrations:

```sh
bun run --cwd apps/api db:migrate
```

Start the applications in three separate terminals:

```sh
bun run --cwd apps/api dev
bun run --cwd apps/web dev
bun run --cwd apps/admin start
```

| Service          | Local address                   |
| ---------------- | ------------------------------- |
| Web              | <http://localhost:5173>         |
| Admin            | <http://localhost:4200>         |
| API              | <http://localhost:3000>         |
| OpenAPI explorer | <http://localhost:3000/openapi> |
| Health check     | <http://localhost:3000/health>  |

The health endpoint checks PostgreSQL connectivity. The OpenAPI explorer is enabled
outside production.

Project owners assign the administrator role through the database;
there is no public admin registration.

## Checks

```sh
bun run lint
bun run format:check
bun run --cwd apps/api test
bun run --cwd apps/web test
bun run --cwd apps/admin test --watch=false
```

The API uses Bun Test, frontend tests use Vitest, and browser flows use Playwright.
Integration tests cover HTTP behavior, permissions, state transitions, migrations,
and concurrent operations against PostgreSQL. Browser test servers use in-memory
object storage and do not contact R2.

For integration tests, create a separate database:

```sh
docker compose exec postgres createdb -U lostly lostly_test
```

In your test shell, set `DATABASE_URL` to
`postgresql://lostly:lostly_dev@localhost:5432/lostly_test`, then run:

```sh
bun run --cwd apps/api tests/support/migrate.ts
bun run --cwd apps/api test:integration
```

These tests clear their database. With the same test environment, build Web,
install Playwright browsers, and run browser suites sequentially:

```sh
bun run --cwd apps/web build
bun run --cwd apps/web playwright install chromium firefox webkit
bun run --cwd apps/web test:e2e
bun run --cwd apps/web test:e2e:ui
bun run --cwd apps/admin test:e2e
```

The suites start their own servers; local development servers on ports 3000 and
4200 must be stopped first. The UI-only Web suite mocks HTTP and runs without a database.

CI runs formatting, linting, API type checking, both frontend builds, unit and
integration tests, and browser workflows.

### Coverage

All listed tests passed.

| Application | Tests passed | Statements | Branches | Functions | Lines  |
| ----------- | ------------ | ---------- | -------- | --------- | ------ |
| API         | 731          | —          | —        | 92.57%    | 96.23% |
| Web         | 741          | 95.76%     | 90.87%   | 97.03%    | 97.50% |
| Admin       | 19           | 73.61%     | 60.90%   | 36.36%    | 81.05% |

API coverage includes unit and PostgreSQL integration tests; Web and Admin use
Vitest with the V8 provider. Browser E2E coverage is not included.

API percentages use aggregate covered/total counts from the LCOV report; frontend
percentages use Vitest summary totals. Bun's console summary averages percentages
per file, so its API figures differ. Metrics reflect each runner's current scope;
`—` means the metric is not reported by Bun.

## License

Licensed under the [MIT License](https://github.com/zhbforum/Lostly/blob/main/LICENSE).
