# Phase 1 Architecture

This document describes the architecture that **actually exists** after
Phase 1. It does not describe plans.

Everything here was verified by running it. Where something could not be
verified on this machine, that is stated explicitly rather than glossed
over.

---

## 1. What Phase 1 delivers

Phase 1 is the engineering foundation, not a product feature.

It delivers:

- a monorepo with one package manager and one lockfile
- TypeScript in strict mode everywhere, with shared compiler options
- an Express API that connects to MongoDB at startup and shuts down cleanly
- a `GET /api/health` endpoint
- a React app that calls that endpoint over HTTP and renders the result
- a shared package that both sides use to agree on the shape of that response
- linting, formatting, and tests, all runnable with one command
- a real environment-configuration story with no secrets in Git

It deliberately delivers **no** users, jobs, applications, authentication,
authorization, or file upload. Those belong to later phases.

---

## 2. Repository layout

```text
hireflow/
├── apps/
│   ├── api/                  Express + Mongoose REST API
│   └── web/                  React single-page application
├── packages/
│   └── contracts/            Shared, buildable API contract (types + Zod schemas)
├── docs/
│   ├── product-requirements.md
│   └── architecture.md       This document
├── .env.example              Committed. Contains no secrets.
├── eslint.config.js          One flat config for the whole monorepo
├── tsconfig.base.json        Shared compiler strictness
└── package.json              npm workspaces root
```

### Why `apps/` and `packages/` instead of `frontend/` and `backend/`

Phase 0 proposed `frontend/` + `backend/`. Phase 1 needed a third top-level
workspace, `contracts`, that both applications depend on. `apps/*` +
`packages/*` is the convention npm workspaces uses, it makes the dependency
direction obvious at a glance, and it scales when a fourth workspace appears.

The Phase 0 README explicitly allowed this: "The exact structure may evolve
after Phase 1 architecture decisions."

### Why there is no `services/` directory in `apps/api`

There are three workspaces: one deployable server, one deployable browser app,
and one library. A `services/` directory would imply more deployables than
exist, which is misleading.

---

## 3. Dependency direction

```text
packages/contracts  ──▶  apps/api
       ▲
       │
       └──▶  apps/web
```

`contracts` depends on nothing. Nothing depends on `apps/*`. This is a DAG, not
a web of cross-imports, and it is the reason a change to the API contract
breaks compilation on both sides simultaneously.

### Why `contracts` is a real build output, not just `.ts` sources

The API runs under Node with ESM. It cannot import raw `.ts` from another
package, so `contracts` compiles to `dist/` with `.d.ts` files and
`package.json` points at it.

The alternative --- `tsconfig` path aliases straight into `src/` --- works
under Vite but breaks under Node's ESM resolver. Choosing one mechanism that
both sides can consume removes a whole category of "works in dev, fails in the
build" bugs.

Build order is therefore explicit and sequential in the root `package.json`:

```text
contracts  ──▶  api  ──▶  web
```

Type checking is also sequential in the same order, and the root scripts
deliberately use `&&` chains rather than running workspaces in parallel.

---

## 4. TypeScript configuration

`tsconfig.base.json` holds the settings every workspace inherits.

The important ones, and the reason each is on:

| Setting                                 | Why it is on                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `strict: true`                          | The baseline. Without it, `strict` in a child config is opt-out.                                                                  |
| `noUncheckedIndexedAccess`              | `arr[0]` is `T \| undefined`, because it genuinely might not exist.                                                               |
| `noPropertyAccessFromIndexSignature`    | Environment variables are an untyped record. `env.SECRET` may be `undefined`; this makes the compiler say so instead of assuming. |
| `noImplicitOverride`                    | A method that overrides a base method must say `override`.                                                                        |
| `noFallthroughCasesInSwitch`            | A missing `break` in a state-transition map is a security bug.                                                                    |
| `verbatimModuleSyntax`                  | Import types as types, so nothing is silently erased.                                                                             |
| `isolatedModules`                       | Each file must be independently transpilable, which is what Vite and `tsx` do.                                                    |
| `noUnusedLocals` / `noUnusedParameters` | Dead code is a smell; unused _parameters_ in Express middleware are expected, so those are prefixed with `_`.                     |
| `target: ES2023`, `module: ESNext`      | Modern Node supports these natively. Down-compiling hides modern features behind helpers.                                         |

Module systems differ per workspace, on purpose:

- **`apps/api` and `packages/contracts`**: `module: NodeNext`. Import
  specifiers must include the `.js` extension, which is how Node's ESM resolver
  actually works. Writing `.js` while the file is `.ts` looks odd; it is not a
  mistake.
- **`apps/web`**: `moduleResolution: bundler`, `noEmit: true`. Vite resolves
  imports, not Node, so extensionless imports are correct there.

### ESLint

One root flat config, using `typescript-eslint`'s
`recommendedTypeChecked` set. Type-aware linting requires a `tsconfig`, which
is why the workspace projects exist.

Three rules are errors because each one has caught a real bug class:

- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/no-floating-promises`
- `@typescript-eslint/no-misused-promises`

`eslint-config-prettier` runs last and disables stylistic rules that conflict
with Prettier, so formatting is decided in exactly one place.

---

## 5. Compile-time safety is not runtime safety

**This is the single most important idea in Phase 1.**

TypeScript types are erased when the code runs. Nothing about
`healthDataSchema.parse()` being typed as `HealthData` protects a process
from receiving `{ service: 123 }` over the wire.

The two protections are separate and both are required:

| Threat                                                  | Caught by                                             |
| ------------------------------------------------------- | ----------------------------------------------------- |
| Frontend and backend disagree on a response shape       | The compiler, via the shared contract                 |
| A client, proxy, or old frontend sends a malformed body | Zod, at the network boundary                          |
| A user without permission calls an endpoint             | Server-side authorization --- **not yet implemented** |
| A `.env` variable is missing                            | Zod, at startup                                       |

Every place untrusted data enters the system is parsed with Zod:

- `apps/api/src/config/env.ts` parses the environment at startup, so a missing
  `MONGODB_URI` fails immediately with a readable message rather than producing
  a confusing error later.
- `packages/contracts` exports Zod schemas. The API **produces** responses that
  conform, and tests **verify** that.
- `apps/web/src/services/apiClient.ts` parses every response body before handing
  it to React. A backend that returns the wrong shape produces a clear error,
  not a `TypeError` inside a component three frames deep.

---

## 6. The API contract

### The envelope

Every response, success or failure, has the same outer shape.

Success:

```json
{
  "success": true,
  "data": {}
}
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found",
    "requestId": "0f1c...",
    "details": []
  }
}
```

The envelope exists so that a client has exactly one place to look when
deciding whether a call worked, and exactly one place to read a correlation id
from when it did not.

### Codes cannot drift from schemas

`ERROR_CODE_VALUES` is the single source of truth, and both the TypeScript type
and the Zod enum are derived from it:

```ts
export const ERROR_CODE_VALUES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODE_VALUES)[number];

// A compile error if a code is added to the tuple but not handled.
export const ERROR_CODES = Object.fromEntries(
  ERROR_CODE_VALUES.map((c) => [c, c]),
) satisfies Record<ErrorCode, ErrorCode>;
```

`satisfies` is the important word. Without it, `Object.fromEntries` returns
`Record<string, string>` and the connection between the tuple and the object is
lost. With it, the compiler rejects the file if the two ever disagree.

### `apiSuccessSchema` is a factory

```ts
export function apiSuccessSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({ success: z.literal(true), data });
}
```

This is what stops the success wrapper from being copy-pasted and subtly
differing between endpoints.

### What Phase 1 deliberately does **not** do

`packages/contracts/src/index.test.ts` asserts that the envelope's `data`
field is required when present and that the error's `requestId` is always a
string. It also asserts the runtime/schema agreement described above.

It does not yet export request schemas for endpoints that accept input, because
the only endpoint is a `GET`. Adding empty schema factories "for the future"
would be speculative code.

---

## 7. The API

### Request flow

```text
requestId  ──▶ noStore ──▶ helmet ──▶ cors ──▶ json parser
    ──▶ router (routes → controller → service)
    ──▶ notFoundHandler
    ──▶ errorHandler
```

**The order is load-bearing**, because Express runs middleware in registration
order:

- `requestId` first, so _every_ later failure has a correlation id, including
  ones thrown by the security middleware.
- `noStore` before the routes, so the cache policy also applies to error
  responses and the 404 handler.
- `helmet` and `cors` before any route, so headers are present even on
  preflight and error responses.
- The body parser before the routers, so a route may rely on `req.body`.
- `notFoundHandler` and `errorHandler` **last**. Registered earlier, they would
  be unreachable for anything registered after them.

### `app.ts` versus `server.ts`

`createApp()` builds an Express application. It opens no socket and no database
connection. `server.ts` loads configuration, connects to MongoDB, listens on a
port, and handles signals.

That split is not stylistic. It is the reason the whole API test suite runs
in-process in milliseconds with no port and no database. `app.listen()` inside
module scope would force every test to manage real infrastructure.

### Dependency injection, minimally

`createApp` takes an `AppDependencies` object with two members: the validated
environment and a `getDatabaseStatus()` function.

That is the entire DI mechanism, and it exists for one concrete reason: the
test that asserts `status: "degraded"` when the database is down needs to
control the database status without a broken MongoDB. Injected as a plain
function rather than a full container, because a container would be
architecture for its own sake.

### Error handling

One error handler, four cases:

| Situation             | Result                                                                    |
| --------------------- | ------------------------------------------------------------------------- |
| A thrown `ApiError`   | Its status, code and message are used as-is                               |
| A thrown `ZodError`   | `400 VALIDATION_ERROR`, with field-level `details`                        |
| A body parser failure | `400 VALIDATION_ERROR`, "Request body is not valid JSON"                  |
| Anything else         | `500 INTERNAL_ERROR`, logged with the stack, **never sent to the client** |

#### The 500 response is identical in every environment

The tempting design is to attach the error message and stack trace in
development and omit them in production. It was **not** chosen, for two
reasons:

1. **The client contract would become environment-dependent.** The frontend
   would need error fields that only ever appear locally, and the shared
   `apiFailureSchema` would have to become conditional. A shape that changes
   with `NODE_ENV` is a shape that gets tested in one environment and shipped
   in another.
2. **A production-only bug would get no early warning.** If development never
   executes the code path that produces the real payload, the first time that
   path runs is in production.

So an unexpected 500 always returns exactly:

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred",
    "requestId": "..."
  }
}
```

and the full error --- message, stack, and the same `requestId` --- is written
to the server console. Debugging means reading the terminal, which in
development is one window away.

This was found by writing a test that assumed the opposite behaviour: the test
expected a stack in development and failed, which is how the mismatch between
an assumption and the code surfaced. `apps/api/src/app.test.ts` now asserts the
two environments are identical apart from the request id, so they cannot drift
apart without a test failing.

**Known limitation:** for a developer who cannot see the server console --- a
hosted staging environment, say --- a 500 gives only a request id. That is a
deliberate trade of debugging convenience for a response shape that is safe and
identical everywhere.

`details` is populated only for validation failures. Putting free-form detail
in other errors is how internal information leaks into logs that get shared.

### CORS

`cors` is configured with an **allowlist** read from `CORS_ORIGINS`, plus
`credentials: true`.

The wildcard is not used, and that is not caution for its own sake. Phase 0
decision `DC-011` requires this API to be called with a session cookie. The
CORS specification forbids combining `Access-Control-Allow-Origin: *` with
credentials, and browsers reject the combination outright. So a wildcard would
not even work here.

A request from an unlisted origin simply receives no CORS headers, and the
browser blocks the response. Methods and allowed headers are listed explicitly
rather than reflected, which limits what a hostile page can even attempt.

### `Cache-Control: no-store`

Every response carries `Cache-Control: no-store`.

This was **not** designed in advance. It was found by making a real browser
request during Phase 1 verification: the browser sent `If-None-Match` to
`GET /api/health`, proving it had stored the response. A `304 Not Modified`
makes the browser replay the stored body, so the UI could have displayed
`status: "ok"` after the API had stopped being healthy.

The deeper issue is two caches that cannot see each other: the browser's HTTP
cache, which is below the Fetch API and invisible to JavaScript, and TanStack
Query's cache, which the application controls. Two independent caches of one
resource is a reliable source of impossible-to-reproduce staleness bugs.

The API owns its representation, so the API sets the policy. TanStack Query's
`staleTime` then becomes the single, visible source of truth.

### Startup

```text
1. loadEnv()          Zod-validated; a bad value fails here, not later
2. connectToDatabase() rejects within serverSelectionTimeoutMS on a bad URI
3. app.listen()      only after the database is usable
```

The database comes before the listener because the API cannot do anything
useful without MongoDB. Accepting traffic that will immediately fail produces
confusing downstream errors instead of one clear startup failure.

### Graceful shutdown

`SIGINT` (Ctrl+C) and `SIGTERM` (Docker, Kubernetes, systemd) both trigger the
same sequence. Handling only `SIGINT` is a classic production bug: the server
dies mid-request on every deploy.

```text
drainServer(server, disconnectFromDatabase)
  1. server.close()            stop accepting new connections
  2. server.closeIdleConnections()   release keep-alive sockets that are idle
  3. await closed              no new request can start
  4. closeDatabase()           now safe to give up the connection pool
```

Step 2 is why it does not appear to hang: browsers hold keep-alive sockets open
for seconds between requests, and `close()` waits for existing connections.
Only _idle_ sockets are closed, so a request already in flight still finishes.

The order in step 4 is the point. Releasing the pool while the server can still
accept requests means a request can arrive with no pool to serve it.

The drain sequence lives in `src/shutdown.ts`, separate from `server.ts`,
because `server.ts` calls `process.exit` and runs `main()` on import --- neither
of which a test can survive. The mechanics have no process side effects, so
`src/shutdown.test.ts` exercises them against a **real** `http.Server` on a real
ephemeral port.

---

## 8. The web app

### Layers

```text
components/  presentational React components
pages/       one component per route
services/    the only place that calls `fetch`
config/      environment access
test/        test-only helpers
```

No `hooks/` directory, because there are no shared hooks yet. No `context/`
directory, because there is no application-wide client state yet. Directories
are created when something real needs them.

### State

There is no global state library.

**Zustand was considered and rejected.** Phase 0 decision `DC-006` and the
server-state-first approach both point the same way: for a recruitment
platform, essentially all shared state lives on the server. The server cache
belongs to TanStack Query; authentication state arrives from `/api/me` in a
later phase. Adding a client store now would create a second source of truth
that must be manually kept in sync with the server.

This is the most likely decision to be revisited, and it is worth revisiting
only when a genuine client-only requirement appears.

### The fetch boundary

`services/apiClient.ts` is the only module that calls `fetch`. It:

- prefixes the base URL from `VITE_API_BASE_URL`
- attaches an `AbortSignal`
- distinguishes network failure from HTTP error from contract violation
- parses the response with the shared Zod schema
- throws `ApiRequestError` carrying the stable error `code`

The frontend tests stub `globalThis.fetch`, not this module. That choice
matters: stubbing the module would test that the component calls the function it
was written to call, while stubbing `fetch` covers request building, error
handling, and contract validation together.

### Caching

TanStack Query with a `staleTime` that is not zero, because the API now sends
`Cache-Control: no-store`. Without that header there would be two caches; with
it, there is one.

---

## 9. Environment configuration

**One `.env` and one `.env.example`, both at the repository root.**

```text
NODE_ENV
PORT
MONGODB_URI
CORS_ORIGINS
VITE_API_BASE_URL
```

That is the complete list, and it is the whole point: every variable in it is
used by running code today. There are no placeholders for `JWT_SECRET` or
`SESSION_SECRET`, because nothing signs or reads them yet.

### The three-way difference

This trips up almost everyone, so it is worth being precise.

|                       | `.env.example`                              | `.env`                            | real production secrets                      |
| --------------------- | ------------------------------------------- | --------------------------------- | -------------------------------------------- |
| Committed?            | **Yes**                                     | **No**                            | **Never**                                    |
| Contains real values? | No                                          | Yes, for local development        | Yes                                          |
| Contains secrets?     | Never                                       | Not in Phase 1 --- there are none | Yes                                          |
| Purpose               | Tells a new developer which variables exist | Makes this machine work           | Comes from a hosting platform's secret store |

`.env.example` is documentation. `.env` is machine state. A real secret is
neither, because it must not be in Git at all --- it is injected at deploy
time from a secret manager.

Phase 1 genuinely has no secrets. `MONGODB_URI` becomes one when a hosted
database with credentials is used, which is why the comment in
`.env.example` warns about it now.

### How the API finds the root `.env`

`apps/api/src/config/env.ts` walks up from its own directory looking for the
`package.json` that declares `workspaces`. That is the repository root.

The alternatives were rejected for concrete reasons:

- **Hardcoding `../../.env`** breaks the moment a workspace is nested deeper.
- **`process.cwd()`** depends on which directory `npm` was invoked from, which
  differs between local use and a process manager.
- **Requiring one `.env` per workspace** means three files to keep in sync for
  five variables, and no single place to look.

### How the web app finds it

Vite's `envDir: '../..'` points at the same root file.

The `VITE_` prefix is load-bearing: Vite only exposes prefixed variables to
client code. It is a deliberate boundary. Anything without that prefix is
never bundled into the browser, which is why a future `SESSION_SECRET` could
safely sit in the same file.

---

## 10. Testing

55 tests. All run offline; none needs a live service.

| Workspace            | Tests | What is verified                                                                                                                           |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts` | 8     | Envelope shape, error-code/schema coupling, health payload parsing                                                                         |
| `apps/api`           | 37    | Health endpoint, 404s, malformed bodies, CORS, security headers, cache policy, environment-uniform 500s, env validation, real socket drain |
| `apps/web`           | 10    | Loading, success, degraded, network failure, contract violation, 404 page                                                                  |

### Three strategies, three reasons

**Contracts --- unit tests on the schemas.** Cheap, and a schema that rejects a
bad payload is the whole contract.

**API --- Supertest against the real app, in-process.** No mocked
`express()`, no mocked `next()`, no mocked `res`. The middleware chain,
`helmet`, `cors`, the body parser and the error handler all really run. The
responses are then parsed with the **shared** contract via `parseOrThrow`, so a
test fails if the API and the contract ever disagree.

A "database down" case is covered by injecting `getDatabaseStatus`, which is why
no test needs a running MongoDB.

**API shutdown --- a real socket, no mocks.** The properties under test
("the port stops accepting", "the database is released last") only exist at the
socket level. A mock would assert that the code called the functions it was
written to call, which restates the source rather than testing it.

**Frontend --- `fetch` stubbed, not the api client module.** See §8.

### What the tests do not cover

Stated plainly, because a test suite that hides its gaps is worse than no
suite:

- **Signal delivery.** `apps/api/src/shutdown.test.ts` verifies the drain
  mechanics. It cannot verify that `SIGINT` reaches the process, because on
  Windows a signal cannot be sent to another process --- `process.kill(pid,
'SIGINT')` terminates the target without running its handler. This was
  confirmed with a control experiment and is an operating-system limitation, not
  a code defect. **Verify this on Linux, macOS, or in a container.**
- **The browser's own HTTP cache.** Correctness of `no-store` was verified by
  observing that `If-None-Match` disappeared from a real request.
- **Cross-browser rendering.** The UI was verified in Chromium only.
- **Load and performance.** One endpoint, no meaningful measurement yet.
- **Authentication and authorization.** Not implemented; not tested.

---

## 11. Security decisions made in Phase 1

| Decision                               | Rationale                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| No secrets in Git                      | `.env` is gitignored; `.env.example` carries no secret                                           |
| CORS allowlist, never `*`              | Required for credentialed requests, and a real control                                           |
| `helmet` with HSTS only in production  | A header that cannot take effect is a placebo that looks like a control                          |
| `x-powered-by` disabled                | Free fingerprint reduction                                                                       |
| `Cache-Control: no-store`              | One cache, not two                                                                               |
| `no-store` before the routes           | So error responses are covered too                                                               |
| 100 kB JSON body limit                 | Cheapest defence against memory exhaustion; in force before the first body-carrying route exists |
| Explicit CORS methods and headers      | Limits what a hostile page can even attempt                                                      |
| Stack traces never sent in production  | Leaks paths, versions, occasionally data                                                         |
| Every response carries `requestId`     | A user can quote the exact request that failed                                                   |
| `zod` validation on all external input | Compile-time types are erased at runtime                                                         |
| `no-explicit-any` as a lint error      | `any` silently disables the type system                                                          |

### Not yet in place, by design

Rate limiting, CSRF tokens, cookie hardening, request logging, audit logging,
and dependency scanning beyond `npm audit`.

CSRF protection becomes **mandatory**, not optional, in the phase that adds
cookie-based sessions, per Phase 0 `DC-011`.

---

## 12. Deliberately excluded

Phase 0 and the Phase 1 brief both require that future features not be
speculated. Excluded on purpose:

- Users, organizations, RBAC
- Jobs, candidates, applications, interviews, feedback
- Notifications, email
- Résumé upload
- AI features
- Socket.IO, Redis, BullMQ, background workers
- Analytics, payments
- Rate limiting, compression, request logging middleware
- A global client state library
- Containerization, CI/CD, deployment

The rationale is uniform: each would be code with no current caller, no current
requirement, and no way to validate. Adding them would make the codebase look
more complete while making it harder to understand --- the opposite of the
project's goal.

---

## 13. Commands

```bash
npm install                   # installs all workspaces, one lockfile

npm run dev                   # contracts watch + API + web, together
npm run dev:api               # API only, tsx watch, on :4000
npm run dev:web               # web only, Vite, on :5173

npm run verify                # typecheck → lint → format:check → test → build
npm test                      # all workspaces
npm run typecheck             # all workspaces, in dependency order
npm run lint                  # ESLint, type-aware, whole monorepo
npm run format                # Prettier write

npm run build                 # contracts → api → web
npm run start -w @hireflow/api # run the compiled API
```

`npm run verify` is the single command that must pass before any commit. It
runs type checking, linting, formatting, tests and builds in the order in
which a failure is cheapest to diagnose.

---

## 14. Requirements

- **Node.js >= 24.0.0**
- **npm** (ships with Node; the only package manager)
- **MongoDB** reachable at `MONGODB_URI`, or a change to that variable

Setup:

```bash
npm install
cp .env.example .env
npm run dev
```

---

## 15. Open items carried forward

Phase 0 left four blocking questions unanswered. They concern later phases and
do not block Phase 1:

| Origin   | Question                                                                    |
| -------- | --------------------------------------------------------------------------- |
| `OQ-005` | Object storage provider and file delivery                                   |
| `OQ-021` | Can an existing candidate accept an invitation, given one role per account? |
| `OQ-022` | Invitation token mechanism and expiry                                       |
| `OQ-023` | How the invitee learns about the invitation, with no email in the MVP       |

Also unresolved, and worth deciding before the next phase starts:

- Is the `packages/contracts` build step worth its cost, or should the API
  switch to a bundler that consumes TypeScript sources directly?
- Should the API add request logging before the first real endpoint arrives,
  or wait until there is something to debug?
- Confirm the `SIGTERM` shutdown path on Linux or in a container, as noted in
  §10.
