# HireFlow — Phase 0: System Architecture

Covers: high-level architecture · backend layering · authorization architecture ·
authentication architecture · frontend architecture · folder structure.

---

## 1. High-level architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                                  BROWSER                                   │
│  React 19 + TypeScript + Vite (SPA)                                       │
│  ┌────────────────┐ ┌──────────────┐ ┌───────────┐ ┌────────────────────┐ │
│  │ Routes/Pages   │ │ Features     │ │ TanStack  │ │ Zustand (client    │ │
│  │ (composition)  │ │ (domain UI+  │ │ Query     │ │ state only: session│ │
│  │                │ │  logic)      │ │ (server   │ │ snapshot, UI prefs)│ │
│  │                │ │              │ │  state)   │ │                    │ │
│  └───────┬────────┘ └──────┬───────┘ └─────┬─────┘ └────────────────────┘ │
│          └─────────────────┴───────────────┘                               │
│                            │  fetch + JSON                                │
│              ┌─────────────▼──────────────┐                                │
│              │   api client (single fetch  │  +access token from memory    │
│              │   wrapper, interceptors)    │  +withCredentials for cookie   │
│              └─────────────┬──────────────┘                                │
└────────────────────────────┼──────────────────────────────────────────────┘
                             │ HTTPS  (JSON, envelope responses)
┌────────────────────────────▼──────────────────────────────────────────────┐
│                        NODE.JS / EXPRESS  API                             │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ MIDDLEWARE PIPELINE (execution order is the design)                 │  │
│  │  requestId → helmet → cors → json(limit) → compression →           │  │
│  │  cookieParser → rateLimit → authenticate → resolveMembership →     │  │
│  │  authorize(permission) → tenantScope → validate(zod) →             │  │
│  │  [rateLimitStrict] → controller → service → model → MongoDB        │  │
│  │                    ↑                                          │     │  │
│  │              errorHandler (4-arg, last)  ←───────────────┘     │     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  modules/ : auth · users · organizations · jobs · candidates ·            │
│             applications · interviews · notifications · audit             │
└───────────────┬───────────────────────────────┬───────────────────────────┘
                │                               │
       ┌────────▼─────────┐          ┌──────────▼──────────┐
       │   MongoDB        │          │  Object storage    │
       │   (Mongoose)     │          │  (S3-compatible /  │
       │                  │          │   Cloudinary)       │
       │  + indexes       │          │  resumes, avatars  │
       │  + TTL cleanup   │          │  private bucket    │
       └──────────────────┘          └─────────────────────┘
                │
       ┌────────▼─────────┐
       │  Email provider  │  Resend (prod) · Nodemailer/ Ethereal (dev)
       │  (async, P9)     │
       └──────────────────┘
```

**Why one server, not microservices?** The seams are already there: every module is a
self-contained folder with one public router. If a module ever needed independent
scaling or a different release cadence, it can be extracted behind its router without
touching the others. Splitting into services *now* would add network failure modes,
distributed transactions and a deployment pipeline per service — and would teach you
nothing that the module boundary does not already teach. **Draw the boundary correctly
first; the topology is a deployment decision, not an architectural one.**

### 1.1 Request lifecycle — the map you must be able to draw from memory

```
Request
  1. requestId        attach/reuse correlation id            (observability)
  2. helmet           security headers, hide express banner    (security)
  3. cors             explicit origin allowlist + credentials  (security)
  4. body parsers     json/urlencoded with a size cap         (security: DoS)
  5. compression      gzip responses > 1 KB                   (perf)
  6. cookieParser     read the refresh cookie                  (auth)
  7. rateLimit        global IP-based                         (abuse)
  8. authenticate     verify JWT, load User → req.user        (authentication)
  9. resolveMembership
                      read orgId from route/param/body,
                      verify OrganizationMember(ACTIVE)        (authorization)
 10. authorize        requirePermission('job:create')          (authorization)
 11. tenantScope      orgId is now immutable on req.tenant     (isolation)
 12. validate         zod parse body/query/params → typed DTO  (correctness)
 13. rateLimitStrict  per-user write throttle                 (abuse)
 14. controller       HTTP in/out only. Zero business logic.  (layering)
 15. service          business rules, transactions, invariants  ← the real work
 16. model            Mongoose query                          (data access)
 17. MongoDB
 ── response transforms back up the stack ──
 18. serializer/DTO   strip tenant-only & sensitive fields
 19. errorHandler    ONLY on error: map to { success:false, error:{code,message} }
```

Two things to notice, because they are the whole point of the diagram:

- **Steps 8–11 run before step 12.** If we validated the body first we would be doing
  work for unauthenticated, unauthorised callers. Authenticate → authorise → *then*
  trust anything the client sent.
- **Step 9 resolves the tenant from the *request*, and step 11 freezes it.** Every
  downstream service reads `req.tenant.organizationId`. No service ever takes an
  `organizationId` argument from a controller body. That is how a missing tenant filter
  becomes structurally impossible instead of merely discouraged.

---

## 2. Backend architecture

### 2.1 Layering rule

```
routes → middleware → controller → service → model → database
```

| Layer | May know about | Must NOT |
| --- | --- | --- |
| `*.routes.ts` | Express router, middleware names, controller handlers | business logic; Mongoose |
| `*.controller.ts` | `req`/`res`, DTOs, service calls, HTTP status codes | Mongoose; business rules; `try/catch` per route |
| `*.service.ts` | domain rules, transactions, models, other services | `req`/`res`; HTTP codes; Express types |
| `*.model.ts` | Mongoose schema, indexes, statics | business workflows (keeps models reusable) |
| `*.validation.ts` | Zod schemas + inferred TS types | database or HTTP details |
| `middleware/*` | cross-cutting concerns | any module's business rules |

**"Thin controller" means a controller is a translation function, and that is the whole
job.** A controller that looks like this is doing its job:

```ts
// applications.controller.ts
export const moveStage = asyncHandler(async (req: Request, res: Response) => {
  const { applicationId } = req.params as { applicationId: string };
  const dto = req.validated.body as MoveStageDto;

  const application = await applicationService.moveStage({
    applicationId,
    to: dto.status,
    reason: dto.reason,
    actor: req.user!,
    tenant: req.tenant,
  });

  res.status(200).json({ success: true, data: applicationMapper.toResponse(application) });
});
```

Note what is absent: no `Application.findById`, no permission check, no transition
validation, no audit write. All four belong in the service, which is the only layer that
can be tested without a fake `req`/`res`. **If a rule must be enforced, put it where a
test can call it directly with plain arguments.** That single sentence is the practical
justification for the entire service layer.

### 2.2 The `asyncHandler` pattern (and why it exists)

Express 4 does not catch errors from `async` handlers — a rejected promise becomes an
unhandled rejection and the request **hangs forever**. Fix with a tiny wrapper that
forwards to `next()`:

```ts
export const asyncHandler =
  <T>(fn: (req: Request, res: Response, next: NextFunction) => Promise<T>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
```

(Express 5 forwards rejected promises natively — we still use the wrapper so the code is
explicit and portable.)

### 2.3 Error architecture

```ts
// shared/errors/app-error.ts
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,      // machine-readable, part of the API contract
    message: string,
    public readonly details?: unknown,    // only for validation, never internals
  ) { super(message); this.name = new.target.name; Error.captureStackTrace(this, this.constructor); }
}

export class BadRequestError   extends AppError { /* 400 */ }
export class UnauthorizedError extends AppError { /* 401 */ }
export class ForbiddenError    extends AppError { /* 403 */ }
export class NotFoundError     extends AppError { /* 404 */ }
export class ConflictError     extends AppError { /* 409 */ }
export class ValidationError   extends AppError { /* 422 */ }
export class TooManyRequests   extends AppError { /* 429 */ }
```

Every **expected** failure is an `AppError` thrown by a service. The error middleware
(registered last, 4-argument signature) is the single place that turns anything into a
response:

| Thrown by | Mapped to |
| --- | --- |
| `AppError` | its own `statusCode` + `code` |
| `ZodError` | `422 VALIDATION_ERROR` + field details |
| Mongoose `ValidationError` | `400 VALIDATION_ERROR` |
| Mongoose `CastError` | `400 INVALID_IDENTIFIER` |
| Mongo `E11000` duplicate key | `409 DUPLICATE_RESOURCE` (translate per known index) |
| `jwt` errors | `401 UNAUTHORIZED` |
| `multer` file errors | `400 INVALID_FILE` |
| anything else | `500 INTERNAL_ERROR`, generic message, full stack logged with `requestId` |

**Teaching point.** The last row is the security control. Attacker-supplied input is
untrusted; a driver error may contain the raw query, a field path, or a connection
string fragment. We log it, we never send it.

### 2.4 A module's file layout

```
server/src/modules/jobs/
├── job.model.ts          Mongoose schema, indexes, typed statics
├── job.types.ts          interfaces/enums/union types owned by this module
├── job.validation.ts     Zod schemas + z.infer types
├── job.mapper.ts         Document -> API DTO (strips salary, internal fields)
├── job.service.ts        business rules, transactions, audit
├── job.controller.ts     HTTP translation only
├── job.routes.ts         router + middleware chain
├── index.ts              the module's public surface (re-exports router + services)
└── __tests__/
    ├── job.service.test.ts
    └── job.routes.test.ts
```

`index.ts` is how other modules consume it. `job.routes` is imported once, by
`modules/index.ts`, to build the API router. Nothing ever deep-imports
`modules/jobs/job.model` from outside the module — that is what keeps modules
independent. Import cycles are the most common symptom of a badly-bounded module.

### 2.5 Backend folder structure

```
server/
├── src/
│   ├── config/
│   │   ├── env.ts            zod-validated process.env, fail fast on boot
│   │   ├── database.ts       mongoose connect, retry/backoff, graceful close
│   │   ├── logger.ts         structured JSON logger (pino)
│   │   └── constants.ts      roles, permissions, pipeline stages
│   ├── middleware/
│   │   ├── request-id.ts
│   │   ├── authenticate.ts
│   │   ├── resolve-membership.ts
│   │   ├── authorize.ts
│   │   ├── tenant-scope.ts
│   │   ├── validate.ts
│   │   ├── rate-limit.ts
│   │   ├── upload.ts         multer config, magic-byte validation
│   │   └── error-handler.ts  + not-found handler
│   ├── modules/              (the domain; see §2.4)
│   │   ├── auth/ users/ organizations/ jobs/
│   │   ├── candidates/ applications/ interviews/
│   │   ├── notifications/ audit/
│   │   └── index.ts
│   ├── shared/
│   │   ├── errors/           AppError + subclasses
│   │   ├── types/            express Request augmentation (req.user, req.tenant)
│   │   └── utils/            asyncHandler, pagination, slugify, crypto
│   ├── jobs/                 (future: scheduled/background tasks, P9+)
│   ├── app.ts                express app assembly — no listen()
│   └── server.ts             process lifecycle: listen, graceful shutdown
├── tests/
│   ├── setup/                global setup, mongodb-memory-server, factories
│   └── integration/
├── scripts/                  seed.ts
├── .env.example
├── package.json
├── tsconfig.json
├── eslint.config.js
└── Dockerfile                (Phase 13)
```

**Why `app.ts` and `server.ts` are separate files.** This one split is the difference
between a testable app and an untestable one. `app.ts` builds and exports a configured
Express instance and **never calls `listen`**. `server.ts` owns the process: connect to
Mongo, `listen`, install `SIGTERM`/`SIGINT` handlers. Therefore a test can do
`request(app).get('/api/health')` against the real app without binding a port or owning a
lifecycle. If these were one file, every integration test would need a real port and a
`beforeAll`/`afterAll` dance, and app construction would be impossible to isolate.

**Why `shared/` vs `utils/`:** `utils/` = generic helpers with no domain meaning
(`slugify`, `asyncHandler`, `parseCursor`). `shared/` = cross-module *domain* contracts
(errors, augmented Express types). `config/constants.ts` holds the **role→permission
map** so permissions are defined exactly once.

### 2.6 Dependency rule (enforceable later)

```
routes → controller → service → model
                ↘ shared/errors, shared/utils
config  → everything
```
Services must not import controllers; models must not import services. If a module needs
another module, it imports from that module's `index.ts`. This is "clean architecture"
reduced to the three rules that actually matter in a code review.

---

## 3. Authentication architecture

### 3.1 The threat, stated first

The reason auth is not "check the password" is that **the token is the product**. Anyone
holding a valid token *is* the user. So the questions are: how is it issued, how is it
carried, how is it stored at rest in the browser, how is it revoked, and what happens
when it leaks?

### 3.2 The design

| Aspect | Choice | Why |
| --- | --- | --- |
| Password storage | argon2id (fallback bcrypt cost 12) | memory-hard; resists GPU cracking |
| Access token | JWT, RS256/HS256, **15 min** TTL | stateless verification = no DB hit per request |
| Access token transport | `Authorization: Bearer <token>`, held **in JS memory** | immune to XSS exfiltration from `localStorage` |
| Refresh token | opaque random string, **30 days**, **httpOnly + Secure + SameSite=Lax** cookie | JS cannot read it, so XSS cannot steal it |
| Refresh token at rest in DB | SHA-256 hash, with `familyId` + `usedAt` | theft of the DB alone cannot forge a token |
| Token rotation | every refresh issues a new token, invalidates the old | limits the value of a stolen token |
| Reuse detection | presenting an already-used refresh token revokes the whole family | catches a thief racing the real user |
| Global revocation | `user.tokenVersion` bumped on password change/logout-all | kills every outstanding token at once |
| Revocation on logout | delete the refresh token document server-side | logout must be server-side; clearing a cookie alone is not logout |

**Why access token in memory and not a cookie?** Both are defensible. Comparing:

| | Memory + `Authorization` header | httpOnly cookie for both |
| --- | --- | --- |
| XSS theft | token reachable from JS memory if XSS runs **while the app is open**; not readable from storage at rest | not readable by JS at all |
| CSRF | not applicable (custom header forces preflight) | **needs CSRF tokens or strict origin checks** |
| Multiple tabs / server-rendered | needs storage to share; can be re-fetched | naturally shared |
| Reload behaviour | access token gone → silent `/refresh` on boot | still valid |

We choose **memory + header**, because HireFlow is a pure SPA (no SSR, no third-party
cookie reliance) and the CSRF surface of a cookie-only design is a real source of
vulnerabilities. The trade-off we accept: an XSS that runs while the app is open can grab
the access token, which is why the CSP and input-safety work in Phase 12 matter, and why
the access token TTL is only 15 minutes. **Say this trade-off out loud in an interview —
that is what makes the choice sound considered rather than copied.**

### 3.3 Full flow

**A. Register**
```
POST /api/auth/register  { email, password, firstName, lastName }
client → rate limit → validate(Zod) → check existing(email) → hash password
       → User.create → audit(user.registered) → 201 { user, accessToken }
       + Set-Cookie: refresh=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/api/auth
```

**B. Login**
```
POST /api/auth/login  { email, password }
→ rate limit (5 / 15 min / IP)      ← credential stuffing defence
→ find user by email (passwordHash select:false → explicit .select('+passwordHash'))
→ argon2.verify — on failure: SAME generic 401 for "no such user" and "wrong password"
→ issue accessToken(15m) + create RefreshToken{ hash, familyId, expiresAt: 30d }
→ set refresh cookie → 200 { user, accessToken, expiresIn }
```

**C. Authenticated request**
```
GET /api/jobs  Authorization: Bearer <accessToken>
→ verify signature + exp + issuer + audience
→ load User (must be ACTIVE) → req.user
→ (tenant routes) resolve OrganizationMember(ACTIVE) for req.tenant.organizationId
→ authorize(required permission)
→ handler
```

**D. Silent refresh** (fires when the API returns 401 `TOKEN_EXPIRED`)
```
POST /api/auth/refresh   (cookie sent automatically; withCredentials: true)
→ read cookie → hash it → find RefreshToken{ hash, revokedAt: null, expiresAt > now }
→ if token.usedAt != null  → REUSE DETECTED → revoke entire family → 401
→ mark used → issue new access + new refresh in the same family → set cookie → 200
```

**E. Logout**
```
POST /api/auth/logout
→ revoke the presented refresh token in DB → clear cookie → 204
```

**F. Password change / "log out everywhere"**
```
→ bump user.tokenVersion → every previously issued access JWT now fails the
  tokenVersion check → all sessions effectively dead
```

### 3.4 Middleware that makes this real

```ts
// authenticate.ts  — WHO are you?
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new UnauthorizedError("MISSING_TOKEN");
  const payload = verifyAccessToken(header.slice(7));       // throws → 401
  const user = await userService.findActiveById(payload.sub);
  if (!user) throw new UnauthorizedError("USER_INACTIVE");
  if (user.tokenVersion !== payload.ver) throw new UnauthorizedError("TOKEN_REVOKED");
  req.user = user;
  next();
});
```

```ts
// authorize.ts  — WHAT may you do?
export const authorize = (...required: Permission[]) => (req, _res, next) => {
  const role = req.membership?.role;
  if (!role) throw new ForbiddenError("NO_MEMBERSHIP");
  const granted = ROLE_PERMISSIONS[role];
  if (!required.every((p) => granted.includes(p))) throw new ForbiddenError("INSUFFICIENT_ROLE");
  next();
};
```

```ts
// resolve-membership.ts  — WHICH tenant, and are you really in it?
export const resolveMembership = asyncHandler(async (req, _res, next) => {
  const organizationId = req.params.organizationId ?? req.query.organizationId ?? req.body?.organizationId;
  if (!organizationId || !isValidObjectId(organizationId)) throw new BadRequestError("INVALID_ORG");
  const membership = await membershipService.findActive(organizationId, req.user!.id);
  if (!membership) throw new NotFoundError("RESOURCE_NOT_FOUND");   // 404 not 403: see below
  req.tenant = { organizationId, membership, role: membership.role };
  next();
});
```

**404 instead of 403 for a non-member** — an attacker probing `/api/organizations/<id>/jobs`
must not learn that the org exists. `403` confirms "this exists but is not yours", which
turns an endpoint into an org-enumeration oracle. Uniform `404` costs nothing and removes
the leak. This is a small decision with a real security argument; it is exactly the kind
of answer that impresses in an interview.

### 3.5 What is *not* in the auth module (scope discipline)

No organization permissions, no candidate data, no hiring logic. `auth` issues and
validates **identities**. If the auth module starts checking "is this user a recruiter",
it has become a second authorization system and the permission map is no longer the single
source of truth.

---

## 4. Frontend architecture

### 4.1 The four kinds of state (the single most useful frontend concept)

| Kind | Example | Owned by | Rule |
| --- | --- | --- | --- |
| **Server state** | jobs list, application, interviews | **TanStack Query** | never copy into a store; derive views from the cache |
| **Client state** | sidebar collapsed, active org, unsaved filter, command palette open | **Zustand** | small, synchronous, no persistence needed (or `persist` for prefs) |
| **URL state** | page, search query, filters, sort, tab | **React Router `searchParams`** | shareable, back-button-correct, survives refresh |
| **Form state** | field values, touched, errors | **react-hook-form** + zod | keep out of both stores; a form is a local object |

**Teaching point — the common bug.** Copying server data into Zustand ("so the navbar can
show the count") creates two sources of truth that drift. The fix is a *selector* over
the query cache, or a denormalised count endpoint — not a copy.

### 4.2 Structure

```
client/src/
├── app/
│   ├── router.tsx           route table (lazy-loaded)
│   ├── providers.tsx        QueryClientProvider, ThemeProvider, ErrorBoundary
│   └── routes/              route guards, path constants, role-based route config
├── components/
│   ├── ui/                  design-system primitives: Button, Input, Dialog, Table,
│   │                        Badge, Skeleton, EmptyState, Pagination, Toast
│   └── shared/              cross-feature composites: FileUpload, UserAvatar,
│                            StageBadge, ConfirmDialog, ErrorState
├── features/                ← the vertical slices that hold domain logic
│   ├── auth/       { api.ts, hooks.ts, components/, auth.store.ts, schemas.ts }
│   ├── jobs/       { api.ts, hooks.ts, components/, schemas.ts, job.types.ts }
│   ├── applications/ (api, hooks, pipeline/, board components)
│   ├── interviews/ (api, hooks, scheduling/, feedback forms)
│   ├── notifications/ (api, hooks, bell)
│   └── candidates/ (api, hooks, profile/, search/)
├── pages/                   route-level composition ONLY: gather hooks + components
├── layouts/                 AppShell (org switcher + nav), AuthLayout, PublicLayout
├── lib/
│   ├── api-client.ts        fetch wrapper, interceptors, single-flight refresh
│   ├── query-client.ts      defaults: staleTime, retry, refetchOnWindowFocus
│   └── socket.ts            (Phase 9) Socket.IO client + typed event map
├── store/                   zustand stores that are genuinely client state
├── types/                   shared types, API envelope types
└── utils/                   format.ts (dates, relative time), cn.ts, constants.ts
```

**Why `features/` and not a global `services/` + `api/`.** The original sketch had
`client/src/services/` and `client/src/api/`, which become dumping grounds: after ten
features you cannot tell which endpoints are candidate-related. Slicing **vertically by
feature** means `features/jobs/api.ts` contains the job endpoints, its hooks, and its
components together, and deleting the feature is a single directory delete. The only
global folders left are `lib/` (infrastructure: the HTTP client, query client, socket)
and `components/ui` (things with no domain). This is a deliberate, defensible deviation
from the initial sketch.

**What a `features/*` slice contains and why:** `api.ts` (pure request functions),
`hooks.ts` (TanStack Query wrappers: keys, fetcher, invalidations), `schemas.ts` (Zod
types shared between forms and runtime validation), `components/` (feature-only UI).
A page may use several features; a feature never imports a page.

### 4.3 API communication

One `api-client` for the whole app:

```ts
// lib/api-client.ts
const client = {
  async request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
    const res = await fetch(`${env.API_URL}${path}`, {
      ...init,
      credentials: "include",                     // sends the refresh cookie
      headers: {
        "Content-Type": "application/json",
        ...(init.auth !== false && accessToken
          ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
    if (res.status === 204) return undefined as T;
    const body = (await res.json()) as ApiResponse<T>;
    if (!res.ok) throw new ApiError(body.error.code, res.status, body.error.message, body.error.details);
    return body.data;
  },
};
```

Rules:
- `credentials: "include"` **always**, because the refresh token is a cookie. Without it
  the browser silently omits the cookie and refresh never works — a bug you will hit.
- The access token is injected from an in-memory module (populated at boot by
  `/auth/refresh`), never read from `localStorage`.
- A 401 interceptor triggers **one** refresh attempt with a *single-flight promise* shared
  by all queued requests, then replays them. Without single-flight, five parallel 401s
  cause five refreshes, four of which are token-reuse and will revoke the session. This
  is a real bug in most hand-rolled implementations.
- A second 401 after refresh → clear session, redirect to `/login`, preserve the intended
  URL for post-login redirect.

### 4.4 TanStack Query conventions

| Concern | Convention |
| --- | --- |
| Query key | `['org', orgId, 'jobs', { status, page, q }]` — org id in the key so switching orgs cannot show stale data |
| `staleTime` | 30 s for reference data (lists), `Infinity` for the session |
| Mutations | always invalidate the *narrowest* correct key set, and optimistically update where the UX needs it (stage move) |
| Optimistic update | pipeline move: apply locally, `onError` rollback + toast, `onSettled` invalidate |
| Errors | never render `error.message` blindly; map `code` → user-facing copy |
| Loading | skeletons, not spinners, for lists; spinners only for < 300 ms actions |

### 4.5 Rendering & performance decisions

- **Route-level code splitting** with `React.lazy` — the public job board must not ship
  the recruiter pipeline code.
- `React.memo` only where a measured re-render cost exists. Global memoisation is cargo
  cult; prefer stable `useCallback` keys and narrow context splits.
- **Virtualise** the candidate list and audit log (they can be 100+ rows) —
  `@tanstack/react-virtual`. Not needed for a 6-card Kanban.
- Zustand selectors with a narrow slice, never destructuring the whole store.
- Forms: `react-hook-form` + `@hookform/resolvers/zod` — the same Zod schema shape as
  the server, so client validation is a UX convenience, not the security boundary.

### 4.6 Route guards (convenience, not security)

```tsx
<RequireAuth>            → no session? redirect /login?next=...
<RequireMembership>     → active org membership? else pick/create an org
<RequirePermission p>    → role has permission? else 403 page
```

These exist to avoid flashing UI and to give a good 403 page. **The security boundary is
the API.** Any guard in the client is deletable by editing one line in devtools — which is
exactly the point the brief makes about `DELETE /api/jobs/:id`.

---

## 5. Authorization architecture

### 5.1 Authentication vs authorization

| | Question | Mechanism | Failure mode |
| --- | --- | --- | --- |
| **Authentication** | *Who is this?* | JWT verification, session, `req.user` | 401 |
| **Authorization** | *What may they do to **this** thing?* | role→permission map + ownership + tenant scope | 403/404 |

401 means "I don't know who you are". 403 means "I know exactly who you are and you may
not do this." Never return 403 for a missing token — it leaks that the resource is
restricted to authenticated users, and it makes the client retry behaviour wrong.

### 5.2 One permission map, one place

```ts
// config/constants.ts
export const PERMISSIONS = {
  JOB_CREATE: "job:create", JOB_UPDATE: "job:update", JOB_DELETE: "job:delete",
  JOB_PUBLISH: "job:publish", JOB_VIEW_ALL: "job:viewAll",
  CANDIDATE_VIEW: "candidate:view", CANDIDATE_UPDATE_OWN: "candidate:updateOwn",
  APPLICATION_CREATE: "application:create", APPLICATION_MOVE: "application:move",
  INTERVIEW_SCHEDULE: "interview:schedule", INTERVIEW_CANCEL: "interview:cancel",
  FEEDBACK_SUBMIT: "feedback:submit",
  MEMBER_MANAGE: "member:manage", ORG_SETTINGS: "org:settings",
  ANALYTICS_VIEW: "analytics:view", AUDIT_VIEW: "audit:view",
} as const;

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN:      Object.values(PERMISSIONS),
  RECRUITER:  [ /* everything job/candidate/application/interview/feedback, no member/org/audit management */ ],
  INTERVIEWER:[ FEEDBACK_SUBMIT ],   // + read access enforced by ownership, see below
};
```

**INTERVIEWER has only one permission but can still read candidates.** Read access for
an interviewer is *resource-scoped*: `interviews/:id` where
`interviewerIds.includes(req.user.id)`, and the candidate read that hangs off it. A pure
role check cannot express "this interviewer, this candidate, that interview" — it needs
an ownership predicate. So authorization in HireFlow is **two layers, both mandatory**:

```
Layer 1 (coarse, RBAC)  authorize(PERMISSIONS.X)         → is this kind of actor allowed to try?
Layer 2 (fine, ABAC)     resource.organizationId === req.tenant.organizationId
                       && resource.interviewerIds.includes(userId)  // ownership
                       && (resource.candidate.userId === userId)      // ownership
```

### 5.3 Ownership guard, reusable

```ts
// shared/utils/assert-ownership.ts
export const assertSameTenant = <T extends { organizationId: Types.ObjectId }>(
  resource: T, tenant: TenantContext,
): void => {
  if (!resource.organizationId.equals(tenant.organizationId)) {
    throw new NotFoundError("RESOURCE_NOT_FOUND");   // 404, never 403
  }
};

export const assertIsAssignedInterviewer = (interview: Interview, userId: string): void => {
  if (!interview.interviewerIds.some((id) => id.equals(userId))) {
    throw new NotFoundError("INTERVIEW_NOT_FOUND");
  }
};
```

**The recurring anti-pattern this prevents (IDOR / broken object-level authorization).**
The world's most common serious API vulnerability is:

```ts
// VULNERABLE — ownership assumed, never checked
const application = await Application.findById(req.params.id);
res.json({ data: application });            // any logged-in user reads any application
```

Correct form is always: load by **id + tenant scope in the same query** —

```ts
const application = await Application.findOne({
  _id: req.params.id,
  organizationId: req.tenant.organizationId,   // scope in the QUERY, not after
});
if (!application) throw new NotFoundError("APPLICATION_NOT_FOUND");
```

**Scoping in the query, not in a later `if`,** means a forgotten check fails closed.

### 5.4 The permission model applied to the four roles

| Action | ADMIN | RECRUITER | INTERVIEWER | CANDIDATE (owner) | other candidate |
| --- | :-: | :-: | :-: | :-: | :-: |
| Create / edit / delete job | ✅ | ✅ | ❌ | ❌ | ❌ |
| Publish job | ✅ | ✅ | ❌ | ❌ | ❌ |
| List org candidates | ✅ | ✅ | ❌ | ❌ | ❌ |
| Read candidate in own org | ✅ | ✅ | ⚠️ assigned interviews only | own ✅ | ❌ |
| Create application | ❌ | ❌ | ❌ | ✅ | ❌ |
| Move application stage | ✅ | ✅ | ❌ | ❌ | ❌ |
| Schedule / cancel interview | ✅ | ✅ | ❌ | ❌ | ❌ |
| Submit feedback | ✅ | ✅ | ✅ (own interview) | ❌ | ❌ |
| Manage members / roles | ✅ | ❌ | ❌ | ❌ | ❌ |
| Org settings | ✅ | ❌ | ❌ | ❌ | ❌ |
| Analytics | ✅ | ✅ | ❌ | ❌ | ❌ |
| Audit log | ✅ | ❌ | ❌ | ❌ | ❌ |

Note: **ADMIN intentionally cannot submit feedback on someone else's behalf** — feedback
must carry the interviewer's own judgement, or the audit trail is worthless. And
**CANDIDATE cannot create an application without being authenticated**, which is why
US-AUTH-01 precedes the application feature in the roadmap.

---

## 6. Folder structure — final

```
HireFlow/
├── docs/
│   ├── phase-0/            ← this folder
│   │   ├── 01-product-and-requirements.md
│   │   ├── 02-domain-model.md
│   │   ├── 03-system-architecture.md
│   │   ├── 04-api-design-strategy.md
│   │   ├── 05-decisions-and-tradeoffs.md
│   │   └── 06-concepts-and-interview-questions.md
│   ├── adr/                architecture decision records, one per major choice
│   ├── api/                OpenAPI spec (Phase 4+)
│   └── runbook/            deploy/ops notes (Phase 14)
├── server/                 (see §2.5)
├── client/                 (see §4.2)
├── docker-compose.yml      (Phase 13; dev Mongo from Phase 1 can be local or containerised)
├── .gitignore
├── .editorconfig
├── README.md
└── package.json            npm workspaces: `npm run dev` runs both
```

**Monorepo, npm workspaces.** One repo with two deployable apps and a shared root
`package.json`. The trade-off: independent repo-per-app is cleaner for large orgs with
separate teams; a single repo is better here because client and server change together
(during Phase 1 we will not use a shared `types/` package — each app owns its types to
avoid a build-order dependency; types are re-declared and the **API envelope is the
contract**). Being explicit about *not* sharing a types package is itself a decision worth
being able to defend: an early mistake in a portfolio project is spending more time on
monorepo build tooling than on the product.

---

## 7. Phase 0 architecture checklist

- [x] High-level diagram with trust boundaries
- [x] 19-step request lifecycle with the ordering rationale
- [x] Backend layering rules + why thin controllers matter
- [x] `asyncHandler` rationale (Express 4/5 behaviour)
- [x] Error architecture: `AppError` hierarchy + every mapping
- [x] Module file layout + `index.ts` public surface
- [x] `app.ts` vs `server.ts` rationale
- [x] Dependency rule
- [x] Auth architecture: token strategy, storage, rotation, revocation
- [x] Full auth flow A–F
- [x] `authenticate` / `authorize` / `resolveMembership` code sketches
- [x] 404-not-403 disclosure argument
- [x] 4-state frontend model + vertical feature slices
- [x] API client, single-flight refresh, query conventions
- [x] RBAC vs ABAC, one permission map, ownership guards, IDOR prevention
- [x] Full role × action permission matrix
- [x] Monorepo rationale and the no-shared-types decision
