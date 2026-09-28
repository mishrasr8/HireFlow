# Hireflow

> A production-oriented MERN recruitment platform built phase-by-phase
> as a learning and portfolio project.

## Project Goal

Hireflow is designed to demonstrate that a fresher can build,
understand, test, and deploy a realistic full-stack application.

The goal is not simply to produce a large codebase with AI.

The goal is to understand the engineering decisions behind the code and
be able to explain them in interviews.

## Core Stack

Language and framework choices were decided in Phase 0 (`D-012`: TypeScript).
Exact versions, tooling and the module system were Phase 1 decisions and are
recorded in [docs/architecture.md](docs/architecture.md).

### Frontend

-   React --- with React Router for navigation and TanStack Query for server
    state. No global client state library: there is no client-only state to
    hold yet.
-   TypeScript --- decided in Phase 0 (`D-012`)

### Backend

-   Node.js (>= 24)
-   Express.js
-   TypeScript --- decided in Phase 0 (`D-012`)
-   Mongoose for MongoDB access; Zod for runtime validation at every trust
    boundary

### Shared

-   `packages/contracts` --- TypeScript types and Zod schemas shared by both
    applications, so a change to the API contract breaks compilation on both
    sides.

### Database

-   MongoDB
-   Mongoose

### Tooling

-   npm workspaces (one lockfile)
-   TypeScript in strict mode, ESLint 10 flat config with type-aware rules,
    Prettier
-   Vitest, Supertest, Testing Library

### Development

-   Git
-   GitHub
-   OpenCode as the primary coding agent
-   ChatGPT as architecture/learning mentor
-   Gemini CLI as an optional second opinion/reviewer

### Deployment

The project will use appropriate free-tier services where practical.

------------------------------------------------------------------------

# Development Philosophy

Hireflow will be developed incrementally.

We will follow:

``` text
Understand
    ↓
Design
    ↓
Implement
    ↓
Test
    ↓
Review
    ↓
Explain
    ↓
Commit
```

The coding agent must not build the entire application in one pass.

The developer controls the phases.

OpenCode implements tasks within the current phase.

------------------------------------------------------------------------

# Planned Phases

## Phase 0 --- Product Requirements

Define:

-   problem statement
-   target users
-   user roles
-   core workflows
-   functional requirements
-   non-functional requirements
-   MVP scope
-   future scope

## Phase 1 --- Engineering Foundation

**Status: complete.** Phase 0 called this "Architecture" and Phase 2 "Project
Setup". Phase 1 covers both --- the architecture decisions are not useful
without a running project to demonstrate them, and a scaffold with no
architecture decisions is just directories. This is a deliberate change to the
Phase 0 plan, recorded here rather than applied silently.

Decide and build:

-   technology choices and versions
-   monorepo structure and dependency direction
-   TypeScript strictness and module system
-   shared API contract between frontend and backend
-   API conventions: envelope, error codes, status codes
-   centralized error handling
-   CORS and security headers
-   database connection lifecycle and graceful shutdown
-   environment variable strategy
-   linting, formatting, and testing
-   `GET /api/health`, consumed by the web app
-   development and verification commands

Deliberately **not** built: users, organizations, roles, jobs, candidates,
applications, interviews, feedback, notifications, email, résumé upload, AI,
websockets, queues, analytics, payments.

## Phase 2 --- Project Setup (merged into Phase 1)

Set up:

-   repository
-   frontend
-   backend
-   development scripts
-   environment variables
-   linting
-   formatting
-   initial Git workflow

All of the above were completed as part of Phase 1, so this phase no longer
exists as a separate step. The remaining phase numbers are unchanged from the
Phase 0 plan.

## Phase 3 --- Database Design

Design:

-   users
-   candidate profiles
-   recruiter profiles
-   companies
-   jobs
-   applications

Add indexes and constraints where justified.

## Phase 4 --- Authentication & Authorization

Implement:

-   registration
-   login
-   password hashing
-   authentication
-   protected routes
-   roles
-   authorization
-   logout/session strategy

## Phase 5 --- Candidate Module

Implement candidate profile and related workflows.

## Phase 6 --- Recruiter Module

Implement recruiter/company workflows.

## Phase 7 --- Job Management

Implement:

-   job creation
-   editing
-   publishing
-   closing
-   job details
-   recruiter ownership

## Phase 8 --- Applications

Implement:

-   applying for jobs
-   application status
-   recruiter application management
-   candidate application tracking

## Phase 9 --- Search & Filtering

Implement useful:

-   search
-   filters
-   sorting
-   pagination

## Phase 10 --- Dashboards

Build candidate and recruiter dashboards.

## Phase 11 --- Notifications

Introduce notifications where they provide real product value. The MVP has one
narrow exception --- the pending-invitation list needed for invite-based company
joining (`D-015`) --- which is a list, not a notification feed, and must not grow
into one.

## Phase 12 --- Testing

Expand:

-   unit tests
-   integration tests
-   API tests
-   critical frontend tests

## Phase 13 --- Security & Performance

Review:

-   authentication
-   authorization
-   validation
-   headers
-   CORS
-   rate limiting
-   database queries
-   indexes
-   API payloads
-   frontend performance

## Phase 14 --- Docker

Containerize the application where useful.

## Phase 15 --- CI/CD

Set up automated:

-   linting
-   tests
-   builds
-   deployment workflow

## Phase 16 --- Deployment

Deploy the frontend, backend, and database using appropriate free-tier
services.

## Phase 17 --- Documentation & Portfolio

Improve:

-   README
-   architecture documentation
-   API documentation
-   screenshots
-   live demo
-   GitHub repository presentation

## Phase 18 --- Interview Preparation

Prepare:

-   project explanation
-   architecture explanation
-   database questions
-   API questions
-   authentication questions
-   security questions
-   deployment questions
-   system-design extensions
-   likely interviewer follow-ups

------------------------------------------------------------------------

# AI Development Workflow

## ChatGPT

Use ChatGPT for:

-   architecture discussions
-   learning concepts
-   comparing approaches
-   reviewing decisions
-   debugging explanations
-   interview preparation
-   planning each phase

## OpenCode

Use OpenCode for:

-   inspecting the repository
-   implementing agreed features
-   writing tests
-   running tests
-   debugging
-   refactoring
-   documentation updates
-   Git-aware development

OpenCode must follow `AGENTS.md`.

## Gemini CLI

Use optionally for:

-   second-opinion reviews
-   security reviews
-   alternative approaches
-   difficult debugging

------------------------------------------------------------------------

# Important Rule

AI is an engineering assistant.

The developer must understand the important parts of the implementation.

We do not move to the next phase simply because the agent says a phase
is complete.

------------------------------------------------------------------------

# Repository Rules

Never commit:

``` text
.env
.env.*
node_modules/
dist/
build/
coverage/
```

except for intentionally tracked example environment files such as:

``` text
.env.example
```

Never commit real secrets.

------------------------------------------------------------------------

# Documentation

| Document | What it covers |
| --- | --- |
| [Product Requirements](docs/product-requirements.md) | The Phase 0 product definition: problem statement, personas, user journeys, MVP / V1 / future scope, functional and non-functional requirements, risks, open questions and the Phase 0 decision log. |
| [Architecture](docs/architecture.md) | The Phase 1 engineering foundation: structure, dependency direction, TypeScript configuration, the API contract, request flow, environment strategy, testing approach, and the reasoning behind each decision. |
| [AGENTS.md](AGENTS.md) | The development rules the coding agent must follow. |

------------------------------------------------------------------------

# Repository Structure

``` text
hireflow/
├── apps/
│   ├── api/                     Express + Mongoose REST API
│   └── web/                     React single-page application
├── packages/
│   └── contracts/               Shared API contract: TypeScript types + Zod schemas
├── docs/
│   ├── product-requirements.md
│   └── architecture.md
├── .env.example                 Committed. Never contains a secret.
├── eslint.config.js             One type-aware flat config for the monorepo
├── tsconfig.base.json           Shared TypeScript strictness
├── package.json                 npm workspaces root
└── package-lock.json            The only lockfile
```

Phase 0 proposed `frontend/` + `backend/`. Phase 1 needed a third workspace,
`contracts`, that both applications depend on, so the structure became
`apps/*` + `packages/*` --- the convention npm workspaces uses. The Phase 0
plan explicitly permitted this: "The exact structure may evolve after Phase 1
architecture decisions."

Full reasoning is in [docs/architecture.md](docs/architecture.md).

------------------------------------------------------------------------

# Getting Started

## Requirements

-   **Node.js >= 24.0.0** --- check with `node --version`
-   **npm** --- ships with Node, and is the only package manager this project
    uses. There is one lockfile, `package-lock.json`.
-   **MongoDB** --- running locally, or a reachable `MONGODB_URI`. The API fails
    to start with a clear message if it cannot connect; that is intentional.

## Setup

``` bash
npm install
cp .env.example .env
```

Edit `.env` if your database is not at the default address. Then:

``` bash
npm run dev
```

This starts three processes:

| Process           | What it does                                    |
| ----------------- | ----------------------------------------------- |
| `@hireflow/contracts` | Watches the shared contract and rebuilds it |
| `@hireflow/api`   | Express API on <http://localhost:4000>          |
| `@hireflow/web`   | Vite dev server on <http://localhost:5173>      |

Open <http://localhost:5173>. The page calls `GET /api/health` and shows the
live result --- service name, status, database state and uptime.

If the API cannot reach MongoDB it exits with an explanatory message instead of
starting in a broken state.

## Environment Variables

There is **one** `.env` and **one** `.env.example`, both at the repository root.

``` text
NODE_ENV            "development" | "production"
PORT                TCP port for the API (default 4000)
MONGODB_URI         MongoDB connection string
CORS_ORIGINS        Comma-separated browser origins allowed to call the API
VITE_API_BASE_URL   Base URL the browser uses to reach the API
```

That is the complete list. Every variable is used by running code today; there
are no placeholders for features that do not exist yet.

### `.env.example` versus `.env`

|                              | `.env.example`      | `.env`             | Production secret |
| ---------------------------- | ------------------- | ------------------ | ----------------- |
| Committed to Git?            | **Yes**             | **No**             | **Never**         |
| Contains real values?        | No                  | Yes, local only    | Yes               |
| Contains secrets?            | Never               | Not in Phase 1     | Yes               |
| What it is                   | Documentation       | Machine state      | Runtime injection |

`.env.example` is committed documentation of *which* variables exist.
`.env` is uncommitted machine state that makes this computer work. A production
secret is neither: it is injected at deploy time from a hosting platform's
secret store, so it is never in the repository at all.

Phase 1 has no secrets. `MONGODB_URI` becomes one as soon as a hosted database
with credentials is used --- which is why `.env.example` warns about that today.

The `VITE_` prefix is deliberate: Vite only exposes prefixed variables to
browser code. A future `SESSION_SECRET` can safely sit in the same file without
ever reaching the client bundle.

## Commands

| Command                          | What it does |
| -------------------------------- | ------------ |
| `npm run dev`                    | All three workspaces together |
| `npm run dev:api`                | API only, with reload |
| `npm run dev:web`                | Web only |
| `npm run verify`                 | **typecheck → lint → format:check → test → build** |
| `npm test`                       | All tests in all workspaces |
| `npm run typecheck`              | All workspaces, in dependency order |
| `npm run lint` / `lint:fix`      | Type-aware ESLint across the monorepo |
| `npm run format` / `format:check`| Prettier |
| `npm run build`                  | contracts → api → web |
| `npm run start -w @hireflow/api` | Run the compiled API |

`npm run verify` is the command that must pass before any commit. It runs the
checks in the order where a failure is cheapest to diagnose.

## Testing

55 tests, none of which needs a running service.

| Workspace            | Tests | Coverage focus |
| -------------------- | ----- | -------------- |
| `packages/contracts` | 8     | Envelope shape, error-code/schema coupling, health payload parsing |
| `apps/api`           | 37    | Health endpoint, 404s, malformed bodies, CORS, security headers, cache policy, environment-uniform 500s, env validation, real socket drain |
| `apps/web`           | 10    | Loading, success, degraded, network failure, contract violation, 404 page |

The API tests drive the real Express app in-process with Supertest --- no mocked
framework, no mocked response objects --- and validate the results using the
shared contract, so a test fails if the API and the contract ever disagree.

Run one workspace:

``` bash
npm test -w @hireflow/api
npm test -w @hireflow/web
npm test -w @hireflow/contracts
```

------------------------------------------------------------------------

# Current Status

Phase: **1 --- Engineering Foundation**

Status: **Complete --- pending developer review**

The application runs. `npm install && npm run dev` starts the API on port 4000
and the web app on port 5173, and the web app displays the live result of
`GET /api/health`.

Delivered in Phase 1:

-   npm-workspaces monorepo: `apps/api`, `apps/web`, `packages/contracts`, with
    one lockfile and an explicit build order.
-   TypeScript `strict` everywhere, plus `noUncheckedIndexedAccess`,
    `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax` and
    `isolatedModules`. No `any`; ESLint makes it an error.
-   `@hireflow/contracts`: one success/failure envelope, a compile-time-coupled
    error-code list, and Zod schemas shared by both applications.
-   `GET /api/health` returning
    `{ success: true, data: { service, status, timestamp, uptimeSeconds, database } }`.
-   Mongoose connection at startup with a clear failure if the database is
    unavailable, and a graceful `SIGINT`/`SIGTERM` shutdown that drains
    connections before releasing the connection pool.
-   Centralized error handling: 404s, `ApiError`, `ZodError`, malformed JSON,
    and unexpected errors --- with a response that never varies by environment,
    so it can never leak a stack trace, and
    an `x-request-id` on every response.
-   Deliberate CORS with an explicit allowlist and credentials, never a
    wildcard.
-   `Cache-Control: no-store` on every API response, so the browser's HTTP cache
    cannot serve a stale health status.
-   React + Vite + Tailwind + React Router + TanStack Query, rendering the live
    health result and handling loading, success, degraded and failure states.
-   Zod validation of the environment at startup, of every incoming API
    response in the browser, and of the API's own responses in its tests.
-   One root `.env` / `.env.example`, tailored `.gitignore`, ESLint, Prettier.

Deliberately **not** built, because nothing in Phase 1 requires it: users,
organizations, roles, jobs, candidates, applications, interviews, feedback,
notifications, email, résumé upload, AI, websockets, queues, workers,
analytics, payments, rate limiting, and a global client state library.

Full reasoning for every decision: [docs/architecture.md](docs/architecture.md).

### Product decisions recorded so far

`D-001`---`D-012` were decided in Phase 0 and are now real code. `D-013`---`D-016`
were decided **after** Phase 1, are recorded in
[Product Requirements](docs/product-requirements.md) section 14, and are **not yet
implemented** --- they are the input to the next phases.

- Two **capabilities** only: **Candidate** and **Recruiter**. An Admin capability is
  future scope, and the authorization model must allow one to be added later
  without a redesign.
- **An account may hold both capabilities** (`D-013`). A user can apply to jobs
  and recruit for a company from one login. Accepting a company invitation adds
  the Recruiter capability without removing the Candidate capability or any of
  its data, and one email still means exactly one account --- never two accounts
  to represent two capabilities.
- **Capability is not company membership.** Holding the Recruiter capability
  grants no access to any company. Recruiter access is scoped to membership of
  the specific company, and authorization is decided in a fixed order:
  authenticated → holds the required capability → member of this company → does
  that membership permit this action. It is never a single `role === RECRUITER`
  test.
- Résumé upload is in the MVP: one current PDF per candidate, stored in
  **Cloudinary** with only a reference and metadata in the database. Hireflow
  authorizes first and then issues an authorized temporary delivery URL, so the
  URL is never itself the authorization decision (`D-016`).
- Application status is a controlled set of eight values --- `APPLIED`,
  `UNDER_REVIEW`, `SHORTLISTED`, `INTERVIEW`, `OFFERED`, `HIRED`, `REJECTED`,
  `WITHDRAWN` --- moving only through a **fixed transition map**: a strict
  forward funnel with no stage skipping and no backward moves, `REJECTED`
  reachable from every non-terminal status, `WITHDRAWN` reachable only from
  `APPLIED` and only by the candidate, and `HIRED` / `REJECTED` / `WITHDRAWN`
  terminal. Every successful transition appends an immutable history record of
  previous status, new status, actor and time.
- A recruiter belongs to exactly one company; a recruiter may only manage the
  jobs and applications of their own company. Joining a company is
  **invite-based**: the first recruiter creates it, an existing recruiter
  invites an already-registered user, and the invitee must accept before
  becoming a recruiter of that company. There is no self-serve join.
- Company invitations use **cryptographically random, single-use tokens stored
  hashed**, not in plaintext, with a `PENDING` → `ACCEPTED` / `DECLINED` /
  `EXPIRED` lifecycle. Expiry and the maximum number of pending invitations are
  company-configurable, and a re-invitation after a decline or expiry creates a
  **new** invitation rather than reviving a spent one (`D-014`).
- Invitations are delivered **in-app**: the invitee logs in, sees the
  invitations addressed to their own account, and accepts or declines. No email
  provider is required for the MVP, and this is **not** a general notification
  system (`D-015`).
- No search engine, filtering, pagination UX or notifications in the MVP;
  those are V1. The single exception is the pending-invitation list above, which
  is the minimum needed to make invite-based joining usable.
- Authentication uses **server-side sessions**: login creates a session record on
  the server, the client holds only an opaque session identifier, logout
  invalidates that server-side state, and every protected request resolves the
  session on the server. No JWT access or refresh token in the MVP. The session
  store must be shared by all instances, never process memory, and **CSRF
  protection is mandatory** because the browser attaches the credential
  automatically.
- The codebase is **TypeScript** on both frontend and backend, with shared types
  for the API contract so a shape change breaks compilation on both sides.
  Crucially, **types are not a security control**: they are erased at runtime, so
  runtime validation and server-side authorization remain mandatory.

### Verified behaviour

Everything below was executed, not assumed:

``` bash
npm install      # 0 vulnerabilities, one hoisted Vite
npm run verify   # typecheck, lint, format, 55 tests, both builds --- all pass
```

-   Dev API connected to MongoDB and served
    `{"success":true,"data":{"service":"hireflow-api","status":"ok",...,"database":"connected"}}`.
-   The compiled API (`node dist/server.js`) served the same payload.
-   A **real browser** at <http://localhost:5173> made the cross-origin request
    and rendered `Service: hireflow-api`, `Status: ok`, `Database: connected`,
    with no console errors.
-   CORS live: an allowed origin received
    `access-control-allow-origin: http://localhost:5173`; a disallowed origin
    received no CORS headers; preflight returned 204 with `allow-methods: GET`.
-   `x-request-id` present, `x-powered-by` absent, `x-content-type-options:
    nosniff`, HSTS off outside production.
-   Unknown route → `404 NOT_FOUND`; malformed JSON → `400 VALIDATION_ERROR`.

**Not verified:** delivery of `SIGINT`/`SIGTERM` to the process. On Windows a
signal cannot be sent to another process --- `process.kill(pid, 'SIGINT')`
terminates the target without running its handler, confirmed with a control
experiment. The drain mechanics themselves are covered by tests against a real
socket; the signal delivery needs a Linux, macOS or container check.

### Next objective

Start **Phase 3 --- Database Design** on explicit instruction. Phase 1 work is
not committed. All Phase 0 blocking questions are now **resolved**; there are
none outstanding.

| Origin | Question | Resolution |
| --- | --- | --- |
| Phase 0 | `OQ-005` --- object storage provider and file delivery | **Resolved** by `D-016` --- Cloudinary, authorized in Hireflow first |
| Raised by invite-based joining | `OQ-021` --- can an existing candidate accept an invitation, given one role per account? | **Resolved** by `D-013` --- an account may hold both capabilities |
| Raised by invite-based joining | `OQ-022` --- invitation token mechanism and expiry | **Resolved** by `D-014` --- random, single-use, hashed, company-configurable expiry |
| Raised by invite-based joining | `OQ-023` --- how the invitee learns about the invitation | **Resolved** by `D-015` --- in-app, on the invitee's own account |

`OQ-001` (how a second recruiter joins a company) was **resolved** by the
invite-based joining decision, `OQ-002` (which status transitions are legal) by
the fixed transition map, `OQ-003` (authentication mechanism) by the choice of
server-side sessions, and `OQ-004` (language) by the choice of TypeScript.
Resolving `OQ-001` raised three new blocking questions; resolving `OQ-002`,
`OQ-003` and `OQ-004` each required none, so the net count went from five, up to
seven, back to four, and then to zero.

`OQ-012` and `OQ-014` were closed by `D-013` as well: `OQ-012` asked the same
question as `OQ-021` in account-model form, and `OQ-014` was reaffirmed --- one
email is still exactly one account, because holding two capabilities is not a
reason to create a second account.

Note that closing these questions **changed requirements**, not just gaps:
`FR-010` (one role per account) was superseded, so database design and
authorization must be built around a set of capabilities plus per-company
membership rather than a single role field.
