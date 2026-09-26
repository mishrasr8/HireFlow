# HireFlow — Phase 0: Technical Decisions, Alternatives, Risks, Roadmap

This is the file that gets you hired. Code proves you can build; **written trade-offs
prove you can think.** Every decision below states the options considered, what we chose,
why, what it costs, and when we would revisit it.

---

## 1. Decision record format

Decisions are recorded as ADRs in `docs/adr/NNNN-short-title.md`:

```
# ADR-0007 — Access tokens are held in memory, refresh tokens in an httpOnly cookie
Status: Accepted · Date: 2026-09-26 · Phase: 2
Context / Options (3) / Decision / Consequences / Revisit if
```

The "revisit if" line is the part most portfolios omit. **A decision without a
revisit condition is not a decision, it is a preference.** I will add ADRs as we go.

---

## 2. Database

### ADR-0001 — MongoDB via Mongoose, not SQL

| Option | Fit for an ATS |
| --- | --- |
| **MongoDB (Mongoose)** | ✅ Varying job attributes; fast "filter by 6 optional facets" queries; natural fit for nested stage history; horizontal scale via sharding on `organizationId` |
| PostgreSQL (Prisma) | ✅ Strongest correctness story; `enum` types, real FK cascades, `jsonb` for flexibility. Better if you value relational integrity above iteration speed |
| MySQL | same as Postgres, less expressive JSON |
| DynamoDB | ✅ Auto-scaling, but the query model and operational surface make it a poor learning vehicle |

**Decision: MongoDB + Mongoose.**

**Why it is genuinely defensible, not just fashionable:**
1. The heaviest query is "candidates in org X, with optional filters on skill, location,
   stage, experience, free text, sorted and paginated". That is exactly what B-tree and
   multikey indexes are good at, and it needs no joins — `candidateId` is on the
   application row.
2. A job's requirements differ by role family; documents absorb that without migrations.
3. Embedded stage history is a natural document, not a `jsonb` escape hatch.
4. The sharding key is already present on every document.

**The honest cost you must be able to state:** MongoDB gives no foreign keys and no
enforced cascade deletes. Referential integrity becomes *our* responsibility, verified by
a service and by tests. If an interviewer pushes, the correct answer is: "I would model
`Application.candidateId` as a hard application-level invariant, add a Phase 12
consistency test that no application points at a missing candidate, and use a transaction
for cascading delete — and I would consider Postgres if the team valued schema-level
integrity more than flexible job attributes." **Knowing when your choice is wrong is a
senior signal.**

### ADR-0002 — Shared collections with `organizationId` (not DB-per-tenant)

| Option | Isolation | Cost | Ops |
| --- | --- | --- | --- |
| **Shared collections + `organizationId`** | application-enforced | a forgotten filter = breach | 1 database |
| Database per tenant | physical | N databases, N connection pools, cross-tenant queries impossible | N ops burden |
| Schema per tenant (Postgres) | logical | migration fan-out | 1 DB, complex migrations |

**Decision: shared collections, mandatory `organizationId`, scoping enforced in the
repository/service layer and asserted by tests.**

Mitigations that make this safe:
- Tenant id resolved once in middleware, frozen on `req.tenant`, passed as an argument —
  never a body field (removes privilege escalation).
- Every query filters in the **query itself** (fails closed).
- Cross-tenant tests are mandatory per module, not optional.
- A phase-6 code-review rule: no `.find(` in a service without a tenant predicate.

**Revisit if** we ever onboard an enterprise customer demanding contractual physical
isolation, or exceed ~10 000 tenants where a single collection's index working set exceeds
RAM.

### ADR-0003 — Mongoose over the native driver

Mongoose gives schema validation, indexes, middleware, `populate`, and TypeScript via
`InferSchemaType`. The native driver is faster and more explicit. **Decision: Mongoose**,
with the rule that models stay *dumb* (no workflow logic) so a later swap to the raw
driver, Prisma, or Drizzle is a data-layer-only change. This is why the service layer
exists.

### ADR-0004 — Denormalise the tenant id onto child collections

`organizationId` is copied onto `applications`, `interviews`, `feedback`, `notifications`,
`auditlogs`. Costs a redundant field; saves a `$lookup` on the hot board query and makes
tenant scoping structurally unavoidable. **This is security-driven denormalisation**, and
it is a good thing to explain.

---

## 3. Backend

### ADR-0005 — Express 5 over Fastify/Nest

| Option | For | Against |
| --- | --- | --- |
| **Express 5** | Ubiquitous; every interview knows it; middleware model is transparent and teachable; native async error forwarding; tiny surface | Middleware-order footguns; must assemble your own validation/DI/logging |
| Fastify | Fastest, schema-first validation, plugin encapsulation | Smaller ecosystem share; less "expected" in interviews |
| NestJS | Built-in DI, decorators, modules, guards, pipes — near-Spring parity | Heavy, decorator magic, a lot of ceremony before one endpoint works; would hide the fundamentals you need to demonstrate |

**Decision: Express 5, typed, hand-assembled.** The reason is the second row: Nest would
*hide* the middleware/DI/guard mechanics that the interviewer is actually testing. We
build them explicitly, once, in ~5 small middleware files, and then we understand them.

### ADR-0006 — Three layers (route → controller → service → model), no repository layer

The brief suggested `Data Access / Model` as a fourth stop. We stop at Mongoose models.

**Why no repository layer:** Mongoose already *is* the data-access abstraction — a schema,
indexes and a query API behind a documented interface. A repository that forwards
`Application.findById` to the model is ceremony with a second place to change the query.

**What we do instead** for the cases where a repository *would* earn its place:
- a `paginate()` helper shared by every list endpoint,
- a `scopeToTenant()` query helper,
- `batchPopulate` helpers for the N+1 rule.

**Revisit if** we ever need a second data source (a search engine, a warehouse) behind
the same domain interface, or a `FakeRepository` to unit-test services without a database.

### ADR-0007 — Zod for validation on both sides, single source of truth

| Option | Note |
| --- | --- |
| **Zod** | Runtime validation *and* static types from one definition (`z.infer`); shared shape with the React client; excellent error paths for 422 details; generates OpenAPI |
| Joi | mature, no static type inference |
| class-validator | decorator-heavy, weaker inference |
| Ajv | fastest, JSON-Schema-first (then hand-write TS types — duplication) |
| Mongoose schema validation | **not** sufficient: it runs after your code has already touched the data, and its error shape is poor for a 422 response |

**Decision: Zod in a `validate` middleware, before the controller.** It parses *and*
replaces: `req.body` becomes the parsed, typed value, so a controller physically cannot
read an unvalidated field.

**Why validation is a middleware, not a controller call.** A controller-level
`schema.parse(req.body)` is easy to forget on one of 40 endpoints. Middleware makes
omission structurally impossible. **Same argument as tenant scoping** — prefer designs
where the mistake cannot be made.

### ADR-0008 — Access token in memory, refresh token in an httpOnly cookie

Full rationale in `03-system-architecture.md` §3.2. Summary: XSS cannot read the refresh
cookie; access tokens are short-lived and never touch `localStorage`; CSRF risk is
minimised by using a header + `SameSite=Lax`; single-flight refresh prevents the
token-reuse footgun.

**Revisit if** we add SSR or a native client (then httpOnly-only + explicit CSRF tokens
becomes better), or if XSS surface grows (then shorten the access TTL to 5 minutes).

### ADR-0009 — Enforce invariants in the database, not only in code

The `to`-`and`-`from` index set:
- unique `(organizationId, jobId, candidateId)` on `applications` — "apply once",
- unique `(interviewId, interviewerId)` on `interviewfeedbacks` — "one feedback each",
- unique `(organizationId, email)` on `candidateprofiles` and `(organizationId, slug)` on `jobs`.

**Reason:** application code is not atomic, and neither is a *read-then-write* check
across two requests. Uniqueness that matters to the business is enforced by the store;
the application-level check is a fast, friendly pre-check, not the guarantee.
Every interview answer about correctness should end at this point eventually.

### ADR-0010 — Pipeline as a pure state machine in one module

```
APPLIED ──▶ SCREENING ──▶ SHORTLISTED ──▶ INTERVIEW ──▶ OFFER ──▶ HIRED
   │            │             │             │
   └────────────┴─────────────┴─────────────┴──▶ REJECTED
```

```ts
// applications/pipeline.ts — pure, no DB, fully unit-testable
export const PIPELINE_TRANSITIONS: Readonly<Record<Stage, readonly Stage[]>> = { ... };
export const canTransition = (from: Stage, to: Stage): boolean => ...;
export const assertTransition = (from: Stage, to: Stage): void => { if (!canTransition(from,to)) throw new ConflictError("INVALID_STAGE_TRANSITION", ...) };
```

**Why pure and centralised:** (a) unit tests need no database and no HTTP; (b) a
scattering of `if (status === ...)` checks in controllers is the classic source of
invalid-state bugs; (c) **the transition table is the one thing a future
"configurable stages per org" feature will parameterise**, so the business rule is already
behind an interface. Only `services` may call `assertTransition`; a `PATCH` route for
`status` does not exist.

### ADR-0011 — Audit log written inside the same transaction as the change

An audit record that can fail independently of the change it describes is not evidence.
Both writes go in one `session.withTransaction`. Cost: the transaction is the latency
bound on writes. Acceptable at our write volume; documented as a known trade-off.

### ADR-0012 — Structured JSON logging with request correlation

`pino` with `requestId` / `userId` / `organizationId` / `durationMs` / `route`. Never log
request bodies wholesale (passwords and tokens) — log an allow-listed shape. Chosen over
`console.log` (unstructured, unfilterable) and over a full OTel stack (correct, but a lot
of Phase-14 ceremony for a portfolio project). Revisit at Phase 14.

### ADR-0013 — Rate limiting: in-memory now, Redis later

`express-rate-limit` with a memory store is correct for a **single** API instance and
documents itself as such. Behind 2+ instances, a memory store limits per instance — N
times the intended rate. So: the limiter's store is behind a one-method interface, so
Phase 13/14 can swap in a Redis store without touching route code. **This is the right
shape to have before scaling, and it is a five-line abstraction, not over-engineering.**

### ADR-0014 — S3-compatible object storage for resumes

MinIO locally (via Docker), S3/R2/Supabase in production. Chosen over storing PDFs as
MongoDB GridFS because: (a) MongoDB's 16 MB doc limit and working-set pressure; (b) CDN
and signed-URL delivery are a solved problem in object storage; (c) backup/restore
tooling is better. Rejected Cloudinary for documents — it is image-optimisation-first.

**Security posture:** private bucket, no public ACL, keys random (`resumes/<org>/<uuid>.pdf`,
never the client's filename), access only via short-lived signed URLs minted by an
authorised endpoint, upload validated by magic bytes and size, and every download audited.
Filenames are metadata, never a path.

---

## 4. Frontend

### ADR-0015 — TanStack Query for server state, Zustand only for client state

The alternative — putting API data in Redux/Zustand — was the default for years and is
still common in tutorials. It makes you hand-write: loading states, error states, stale
invalidation, request deduplication, retry, refetch-on-focus, and cache keys. TanStack
Query gives all of that declaratively and, crucially, gives **one place** that knows when
data is stale.

**The rule that prevents the classic bug:** server data is **never** copied into Zustand.
If a component needs derived server data (e.g. a navbar badge count), it selects from the
query cache or a dedicated count endpoint.

**Why Zustand at all, then?** For genuinely client-only state: current org selection,
sidebar/preferences, command palette, optimistic draft state, socket connection status.
Small, synchronous, no server round-trip. A full Redux Toolkit setup (slices, thunks,
selectors, 6 boilerplate files) would be a lot of ceremony for "keep the sidebar
collapsed".

### ADR-0016 — Feature-based (vertical slice) folders over type-based folders

Covered in `03-system-architecture.md` §4.2. Summary: `features/jobs/{api,hooks,components,schemas}`
keeps a domain in one directory and makes features deletable and greppable. A global
`api/` + `services/` becomes an unreviewable dumping ground by feature ten. Global
infrastructure still lives in `lib/` and `components/ui`.

### ADR-0017 — React 19 + Vite 7

- **Vite over CRA/Next:** CRA is dead; Next's SSR/routing model is not the point here
  (a recruiter dashboard is an authenticated app, not a public SEO surface). Vite's dev
  server is fast, its config is 20 lines, and its production build is esbuild+rollup.
  **If asked "why not Next.js?"**: for a public job board Next's SSR/SEO matters; for the
  authenticated app it adds a server runtime, a hydration model, and a second cache
  invalidation story to reason about. I chose the architecture I could fully explain.
- **TypeScript strict everywhere**, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
  where it does not fight third-party types. No `any` (an escape requires a comment
  saying why and what the safe alternative is).
- **Tailwind over a component library (MUI/AntD):** Tailwind gives no runtime CSS-in-JS
  cost and no "override the theme" battles. Cost: we build our own primitives in
  `components/ui` (Phase 1/4). That work is visible, which is good for a portfolio, and it
  keeps bundle size and design decisions under our control.

### ADR-0018 — react-hook-form + Zod resolver for forms

Forms have a lifecycle (dirty/touched/errors/submitting) that a state library handles
badly. RHF is uncontrolled-first (fewer re-renders), and the **same Zod schema** the server
uses powers client validation — so the two never disagree. The client check is explicitly
*not* a security control.

### ADR-0019 — No global state for "is the user an admin"

Role-derived UI comes from the session query (`/auth/me`) and the permission map, not
from a duplicated store. Duplicated role state is how a UI shows a button the API will
reject — bad for the user, worse for the demo.

### ADR-0020 — `fetch` wrapper over Axios

Axios is fine and popular; its `interceptors` are pleasant. But a 40-line `fetch` wrapper
with two interceptors and single-flight refresh is (a) one less dependency, (b) fully
visible, and (c) teaches what interceptors do. Since the interview asks *"how do you
handle token refresh?"*, having written it is worth more than the import.

*(If the wrapper grows past ~150 lines or needs upload progress/retry defaults, switching
to Axios is a 30-minute, single-file change. Stated up front so the choice is not
dogmatic.)*

---

## 5. Real-time, async, AI — deferred, with the trigger stated

### ADR-0021 — REST first; Socket.IO only where polling is provably insufficient

**When REST is enough:** anything the user does on a page they are looking at; anything
that needs a durable, replayable record; anything infrequent. Almost all of HireFlow.
**When real-time adds value:** a change that originates elsewhere and must appear on
*someone else's* open screen without them refreshing — a candidate's stage change landing
on the recruiter's pipeline board, an interviewer's feedback appearing in the recruiter's
view, an unread-notification badge.

**Plan (Phase 9):** Socket.IO with JWT handshake auth, one room per user, one per org,
server-originated events (`application.stageChanged`, `interview.feedbackSubmitted`,
`notification.created`). Emit **after** the DB write commits, from the service, via a
`realtime` module that is a no-op when no gateway is configured. **REST responses stay
authoritative**; sockets only invalidate queries. That design degrades gracefully (a
dropped socket means "refresh", not "broken") and it is the honest answer to "why not
WebSockets everywhere?".

**Revisit if** collaboration becomes a feature (two recruiters editing the same job
simultaneously) — that needs operational transforms or a CRDT library.

### ADR-0022 — Email asynchronously, without a queue, until volume demands one

The naive implementation `await sendEmail(...)` inside a request makes the user's latency
depend on a third party's uptime, and a 5-second SMTP timeout becomes a 5-second HTTP
response. Minimum acceptable design: fire-and-forget after the response is sent, wrapped
in try/catch, with a `notifications.emailStatus` column so a failure is visible.

**Then:** if emails become slow to fail silently, that is the signal for a real queue
(BullMQ + Redis) with retries and backoff. **We do not build a broker before it is
needed** — but the trigger condition is written down now so the decision is not improvised.

### ADR-0023 — AI behind an interface, assistive only, never a decision

```ts
// ai/resume-matcher.port.ts
export interface ResumeMatcher {
  match(input: { jobDescription: string; resumeText: string }): Promise<MatchSummary>;
}
```
One interface, one implementation (`openai.provider.ts`), injected at composition time.
Every other module depends on the *port*. Consequences: the provider can be swapped
(Azure OpenAI, a local model, a stub in tests) with one file changed; tests never call a
network; the UI never depends on a vendor's response shape.

Non-negotiable product rule: output is an **explainable** summary — matched skills, gaps,
years of relevant experience, areas to probe — and is labelled "AI-generated, assistive
only" with the recruiter's judgement untouched. **No composite score, no ranking of
candidates, no auto-reject.** Beyond being the right thing to do, it is the defensible
position to take in an interview about bias.

**Also:** never send a resume to a third-party model without an explicit, informed
consent step, and log every AI invocation (who, when, which model, which record) in the
audit log.

---

## 6. Testing strategy (introduced now, expanded in Phase 12)

| Level | Tool | What it protects | No mocks of |
| --- | --- | --- | --- |
| **Unit** | Jest/Vitest | Pure logic: `canTransition`, permission map, mappers, validators, slug/date utils | anything |
| **Service/integration** | Jest + `mongodb-memory-server` | Real Mongoose queries, indexes, transactions-ish behaviour, tenant isolation | the database |
| **API contract** | Supertest | Status codes, envelope, auth/permission matrix, error codes, validation | the network |
| **Component** | React Testing Library | User-visible behaviour, not implementation | — |
| **E2E (optional)** | Playwright | The 4 critical journeys | everything |

**Rules:**
- No mocks of Mongoose. A mocked ORM tests your assumptions, not your queries — and
  queries are where ATS bugs live (indexes, filters, tenant scope).
- `mongodb-memory-server` per test run: real index behaviour, unique-constraint behaviour,
  and no "works on my machine".
- Test names state the *rule*, not the function: `it("rejects a stage change from HIRED
  to APPLIED")` over `it("moveStage works")`.
- One test per permission per endpoint for the RBAC matrix (auto-generate the matrix from
  the permission map so a new role cannot skip coverage).
- Factory functions (`createOrg`, `createJob`, `createCandidate`) so tests do not repeat
  30 lines of setup and so the domain stays consistent.

**What each test type protects against — the sentence to say out loud:** unit tests catch
logic regressions, integration tests catch *data-access and isolation* regressions,
contract tests catch API-compatibility regressions, and component tests catch UI
regressions. The category of bug each catches is the justification for its cost.

---

## 7. Risks & common mistakes

### 7.1 Project risks (technical, with mitigations)

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| R1 | **Missing tenant filter** → cross-tenant data leak | Critical | Scope in the query; `req.tenant` only; cross-tenant tests per module; code-review checklist |
| R2 | **IDOR** (fetch by id, no ownership check) | Critical | Load by `id + tenantScope` in one query; ownership guards; explicit IDOR tests |
| R3 | **Indexes written but never created** in a fresh dev DB | High | `autoIndex` in dev, **explicit `createIndexes` in a migration script**; assert index existence in tests |
| R4 | N+1 `populate` in a loop | High | Batch-populate rule; `$lookup` aggregation for board+counts; review rule |
| R5 | Unbounded lists | High | Mandatory pagination + Zod `max` on `limit` |
| R6 | **Apply race** → duplicate applications | Medium | Unique index + idempotency key |
| R7 | Token reuse race destroys a valid session | Medium | Single-flight refresh |
| R8 | Resumed-session confusion: token in `localStorage` | High | Architecture decision + review rule + `rg "localStorage"` check |
| R9 | Timezone bugs on interviews | Medium | UTC storage, IANA zone for rendering, tests across a DST boundary |
| R10 | Npm dependency sprawl / abandoned packages | Medium | Add a dependency only with a written reason; prefer Node built-ins |
| R11 | Scope creep — the AI feature destabilises the core | High | AI is Phase 11, behind an interface, opt-in |
| R12 | Burnout / unfinishable project | High | Phase gate = the only way forward; nothing merges broken; one feature per commit |
| R13 | Secrets in the repo | Critical | `.gitignore` `.env*` except `.env.example`; startup validation fails on missing secrets |
| R14 | Secrets logged (bodies) | High | Allow-listed log fields; redact `password`, `token`, `cookie` |
| R15 | Infinite recursion in the module barrel (`index.ts`) | Medium | Barrels re-export only; no cross-module deep imports; test the app boots |

### 7.2 Mistakes almost every MERN portfolio makes (do not be that project)

1. **`User.role = 'ADMIN'` on the user document.** A global role cannot express
   multi-tenant membership. We model `OrganizationMember`.
2. **Candidate and Application as one document.** Then "Rahul applied to three jobs"
   becomes three near-duplicate candidate records, and per-job stage history is impossible.
3. **Role checks only in the frontend.** `if (user.role === 'ADMIN')` in React. Trivially
   bypassed, and the API becomes unauthenticated in practice.
4. **`findById` with no scope check** in every controller. The single most common serious
   vulnerability in real-world APIs (OWASP API1:2023 Broken Object Level Authorization).
5. **No pagination from day one.** Retrofitting it means rewriting every list endpoint and
   every client query.
6. **Unbounded embedded arrays.** `job.applications.push(...)` and `user.notifications.push(...)`.
   The 16 MB document limit is a production outage waiting to happen.
7. **Money as a number, dates as strings.** `{ salary: 80000 }` with no currency; `"March 5"`.
8. **Business logic in controllers.** Untestable without HTTP, and duplicated when the
   same rule is needed from a socket handler or a background job.
9. **`try { } catch { } catch (e) { console.log(e) }` everywhere** instead of one error
   middleware — and sending `err.message` to the client, which on a Mongoose error can
   contain the query.
10. **No validation library, trusting the client.** Every dev tool, curl and Postman can
    send anything.
11. **Refresh token in `localStorage`.** One XSS, full account takeover for a month.
12. **`ObjectId` strings leaking into the API as an assumed type.** Clients start
    constructing ids; the day you add UUIDs or a sharded scheme, they break.
13. **Indexes on everything "just in case."** Slower writes, bigger memory footprint, and
    the planner picks a *bad* index because one exists.
14. **`skip: 10000` for pagination.** Server does the work and throws it away.
15. **"Just add Redis."** Distributed caching before there is a measured problem, with no
    invalidation strategy, is a new class of bug.
16. **A seeded demo dataset so small it hides every performance problem** (5 candidates
    means any query is fast). Seed **thousands** of candidates — it is also a much better
    demo, and it forces the indexes to be real.
17. **Tests written after the fact, testing mocks.** Coverage without meaning.
18. **One giant commit per feature.** Unreviewable, and it makes `git bisect` useless.

---

## 8. Development roadmap

| Phase | Theme | Backend | Frontend | Tests added | Gate to pass before moving on |
| --- | --- | --- | --- | --- | --- |
| **0** | Product & architecture | — | — | — | *You* can explain the domain model and auth design |
| **1** | Project setup | Express+TS app factory, `env.ts` with Zod validation, Mongo connection with retry, `/api/health` + `/api/health/ready`, `requestId`, pino, helmet, cors, rate limit, error handler, `server.ts` graceful shutdown, ESLint+Prettier, tsconfig strict | Vite+React+TS, Tailwind, ESLint, router with a placeholder route, `lib/api-client.ts`, TanStack Query provider, an `AppShell` layout, a page that calls `/api/health` and renders the result | `/api/health` returns 200; `env.ts` throws on missing vars; error handler maps a thrown `AppError` to the envelope | You can trace one request end to end and explain every middleware |
| **2** | Authentication | `users` + `auth` modules: register, login, refresh (rotation + reuse detection), logout, `me`; argon2; `authenticate` middleware; Zod schemas; rate limits | Auth pages, session bootstrap, org-selection stub, protected route guard, api-client interceptors + single-flight refresh | register/dupe email, login ok/bad password, refresh rotates, reuse revokes family, protected route 401, rate limit 429 | You can narrate the full auth flow from memory and explain why storage is safe |
| **3** | Organizations & RBAC | `organizations` module: create, list, members, invite, role change, remove, last-ADMIN guard; `resolveMembership` + `authorize` + permission map; audit service + `audit` module | Org switcher, settings, member management UI, route guards by permission | RBAC matrix per endpoint; cross-tenant 404; last-ADMIN guard; invite flow | You can explain 401 vs 403, RBAC vs ABAC, and prove tenant isolation with a test |
| **4** | Job management | `jobs` module: CRUD, publish/close, public board with filters + pagination, stats, slug generation | Job list + Kanban-free table, job form with validation, public board + detail, public apply CTA (disabled) | CRUD per role; publish validation; public list excludes drafts; pagination caps; `RESOURCE_IN_USE` on delete | You can explain why `PATCH /jobs/:id` cannot change `status`, and how slug uniqueness works |
| **5** | Candidate & application | `candidates` + `applications` + `Resume` storage: profile CRUD, PDF upload (magic bytes), apply with idempotency key + unique index, snapshot, recruiter candidate list, candidate "my applications" | Candidate profile form, resume uploader with progress, public job page → apply, application tracker, recruiter candidate table | apply once (incl. concurrent attempt), upload rejects fake PDF/oversize, candidate cannot edit another's profile, snapshot immutability | You can explain candidate vs application, idempotency vs unique index, and why uploads are not trusted |
| **6** | Hiring pipeline | `pipeline.ts` state machine, `PATCH /applications/:id/status`, history, `GET /jobs/:jobId/stats`, audit on every move | Kanban board with drag-and-drop + optimistic update + rollback, history timeline, funnel bar | every legal transition, every illegal transition, transition to `REJECTED` needs a reason, concurrent move 409, audit row written | You can defend the state machine as a pure function and explain optimistic UI + rollback |
| **7** | Interviews | `interviews` module: schedule, reschedule, cancel, assignment, interviewer dashboard, feedback CRUD, timezone-safe dates, candidate interview list | Schedule form, interviewer "my interviews" list, feedback form with ratings, candidate calendar | interviewer sees only assigned; non-assigned gets 404; duplicate feedback 409; feedback only for SHORTLISTED/INTERVIEW apps; reschedule not increments | You can explain ownership-based authorization and the timezone decision |
| **8** | Search, filtering, pagination | Server-side search on candidates/jobs/applications, compound indexes verified with `explain()`, cursor pagination, sort allow-list, seed 5 000 candidates | Debounced search, facet filters in the URL, cursor "load more", virtualised list | `explain()` shows `IXSCAN` (not `COLLSCAN`); filter combinations; `max limit` rejection; stable pagination | You can read an `explain()` output and design an index for a new query |
| **9** | Notifications & real-time | `notifications` module, event bus → notifications, email dispatch (async, status column), Socket.IO gateway with JWT handshake, user/org rooms, emit-after-commit | Notification bell + list, socket provider, live pipeline updates, toast on event | Event → notification mapping; recipient isolation; no email for the wrong user; socket auth rejects invalid token | You can justify where you used real-time and where REST was enough |
| **10** | Analytics | Aggregation pipelines: funnel, applications over time, time-in-stage, per-job, per-member; cached with in-memory TTL | Recruiter dashboard, charts, date-range filters, CSV of a report | Aggregation correctness against known seed data; empty-range behaviour; tenant scoping | You can explain what you computed in the DB vs the client, and why |
| **11** | AI assistant | `ai` module: `ResumeMatcher` port + provider, JD extraction, resume text extraction, explainable summary endpoint, audit of AI use, consent gate | "Match to job" panel, labelled assistive, evidence list, no composite score | Port tested with a fake provider (zero network); timeout/failure degradation; prompt-injection resistance in JD text | You can explain the port/adapter pattern, cost control, and why there is no AI score |
| **12** | Testing & security | Full unit + integration suites; authz matrix generator; helmet/CSP tuning; rate limits; upload hardening; error leakage audit; input sanitisation; dependency audit | Component tests for the 4 critical journeys; a11y pass; error/empty/loading states | *The* coverage push; a documented "what each test prevents" table | Coverage target met; no open High/Critical findings; you can explain every test's purpose |
| **13** | Docker & CI/CD | Multi-stage Dockerfile, non-root user, healthcheck, compose (api, web, mongo, minio, optional redis), GitHub Actions: lint → typecheck → test → build | Dockerfile (nginx-served build), nginx config with SPA fallback + API proxy, compose service | Smoke test against the container; CI green on a clean clone | You can explain image layers, why non-root, and every CI step |
| **14** | Deployment | Deploy API + web; managed Mongo; S3-compatible storage; real env vars; secrets management; monitoring + error tracking; custom domain; HTTPS | CDN, asset caching, SPA fallback | Post-deploy smoke test script | It is live, and you can answer "how would you deploy this on AWS/Vercel/Railway?" |
| **15** | Interview prep | Documentation complete: architecture, ADRs, API, DB, security, scaling, trade-offs, limitations, future work | — | — | **You can defend it unprompted** |

### 8.1 Phase-gate rules (the workflow that keeps this honest)

1. **Do not start a phase until the previous gate passes.** "It compiles" is not a gate.
2. Every phase ends with: working feature + edge cases considered + tests + docs updated +
   a runnable verification command.
3. One logical change per commit, conventional-commit format, and a commit message body
   that says *why*. `feat(auth): add login with rotating refresh tokens` is a title; the
   body explains the security reasoning and lists the trade-offs accepted.
4. I present a phase → you read the code and answer the exercise → you say
   **"Start Phase N."** I never advance on my own.
5. Nothing is "done" while it is commented-out, `TODO`-stubbed, or failing tests.

---

## 9. Known limitations to state up front (interview honesty)

A reviewer who finds these *before* you say them looks far better than one who has to
discover them.

1. **Single-region, single-instance backend.** Stateless by design (NFR-SCAL-01) so it can
   be replicated, but rate limiting is in-memory, so a multi-instance deploy needs a Redis
   store (ADR-0013).
2. **In-memory email.** No queue, no retry backoff, no dead-letter. A provider outage loses
   that email; the `emailStatus` column makes it visible but not recoverable.
3. **No offline/interview-calendar sync.** No Google Calendar / CalDAV two-way sync;
   `meetingUrl` is stored, not managed.
4. **No real SSO, MFA, or CAPTCHA.** MFA is a TOTP field + a login challenge; CAPTCHA would
   be added at the edge if bots targeted `/auth/login` despite rate limiting.
5. **MongoDB text search is basic.** No typo tolerance, synonyms, skills taxonomy, or
   faceting. Real systems use Atlas Search / OpenSearch — and a skills taxonomy
   (synonym set, "ReactJS" ≡ "React.js") is a genuine data-modelling problem, not a
   search problem.
6. **No soft-delete/archival on every entity.** Only `jobs` have `ARCHIVED`; deleting a
   candidate is a real cascade today. Retrofitting soft delete across 10 collections
   changes every query — deliberately deferred.
7. **No file scanning (ClamAV) on uploads.** Magic-byte + size + content-type checks
   block the common cases but not a deliberately crafted PDF. Documented as a known gap
   with the standard fix (quarantine bucket + async AV scan).
8. **Audit log has no tamper-evidence.** Append-only by application convention, not by
   cryptographic hash chain or WORM storage. Stated as the production fix (hash chain +
   object-lock storage).
9. **Analytics are pre-aggregated at query time.** Fine to ~10⁵ applications; a real
   product would maintain rollup collections updated by a scheduled job.
10. **No i18n / currency normalisation / accessibility audit beyond basics.** A
    multi-region ATS needs all three and they are product decisions, not technical ones.

---

## 10. If you only remember five things from Phase 0

1. **Candidate ≠ Application.** The many-to-many *is* the entity. Everything about stage,
   interview and feedback hangs off the application, not the person.
2. **Role is per-organization; access is role + ownership + tenant.** Authorization is
   enforced in the query, and `404` beats `403` for anything you do not own.
3. **Auth is a token-storage problem, not a password problem.** 15-minute in-memory access
   token, rotated httpOnly refresh token, reuse detection, `tokenVersion` revocation.
4. **Enforce invariants in the database.** Unique indexes for "apply once", "one feedback
   per interviewer", "no duplicate candidate per tenant". Application checks are a
   convenience; the index is the guarantee.
5. **Pagination, tenant scope and validation belong in the middle of the request
   pipeline — not in the controller body.** Design that makes the mistake *impossible*
   beats a review checklist that catches it.
