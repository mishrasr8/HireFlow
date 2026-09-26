# HireFlow — Phase 0: API Design Strategy

> Endpoints are **designed incrementally per feature** (per the brief). This document
> fixes the *strategy*: URL conventions, the response envelope, the error catalogue,
> pagination, status codes, idempotency, concurrency, versioning, and the planned
> endpoint surface per module. A route that is not in the planned surface does not get
> built "just in case".

---

## 1. Resource-oriented REST

### 1.1 Rules

1. **Plural nouns for collections, no verbs in URLs.** `/api/applications`, not
   `/api/createApplication` or `/api/application/apply`. The verb is the HTTP method.
2. **Hierarchy reflects containment, at most one level deep.**
   `/api/organizations/:organizationId/jobs`. A second level (`/jobs/:jobId/applications/:id/candidate`)
   is a sign you are describing a UI screen, not a resource.
3. **Actions that are genuinely not CRUD get a sub-resource.**
   - Pipeline move → `PATCH /api/applications/:id/status` (a *state* change, not a field edit)
   - Publish → `POST /api/jobs/:id/publish` (a state transition with side effects)
   - Withdraw → `POST /api/applications/:id/withdraw`
   This is a pragmatic, widely used compromise. Pure REST would model these as
   `PUT /api/applications/:id { status }`, which is worse here because it invites generic
   field updates that bypass the state machine. **A generic PATCH on a stateful field is a
   design smell in a workflow system.**
4. **Two nouns for two resources**, even if one nests in the other. `Application` and
   `Interview` are different things with different lifecycles; they are not
   `POST /api/applications/:id/interview`.
5. **No RPC-over-HTTP** (`/api/getJobs`). If you cannot describe the operation as a
   noun, the resource model is wrong.

### 1.2 The tenant in the URL vs in a header

`/api/organizations/:organizationId/jobs` — the org id is an **explicit path parameter**.

Rejected: `X-Organization-Id` header. Reason: a client-supplied tenant id is
attacker-controlled. Even if the server validates membership, it pushes a security check
onto every request and makes accidental cross-tenant bugs one typo away. Putting it in the
path makes the tenant visible in every log line, every test, and every CORS/debug view.

**Chosen hybrid for pragmatism:** because the frontend is a single-tenant-at-a-time SPA,
the client sends the *active* org in a header for ergonomics, but the server treats it as
a *hint*: it resolves the org id from the explicit param when present, else from the
header, and **always re-validates membership** before use. The URL remains the source of
truth in all public/candidate-facing routes.

### 1.3 Naming

| Concern | Convention | Example |
| --- | --- | --- |
| Case | camelCase JSON | `firstName`, `createdAt` |
| Timestamps | ISO 8601, UTC, `Z` | `2026-03-29T03:30:00.000Z` |
| IDs | opaque string in API, ObjectId internally | `"665f1c…"`. Never let the client know it is a Mongo id. |
| Enums | SCREAMING_SNAKE in JSON, `UPPER_SNAKE` union in TS | `"SHORTLISTED"` |
| Booleans | `isX` / `hasX` | `isPublished`, `hasResume` |
| Money | `{ amount, currency }` — never a bare number | `{ min: 800000, currency: "INR" }` |
| Bulk | plural segment, array body, atomic | `POST /api/jobs/bulk-archive` |
| Soft delete | `deletedAt` never in default responses; `?includeDeleted=1` for admins | |

---

## 2. Response envelope

### 2.1 Success

```json
{
  "success": true,
  "data": { "...": "resource or array" },
  "meta": { "page": 1, "limit": 20, "total": 137, "totalPages": 7, "hasNext": true }
}
```

`meta` is present **only** for paginated collections. Keeping the envelope uniform means
one client-side unwrap function and one error path, instead of every feature inventing a
response shape.

### 2.2 Single resource vs list vs nothing

| Case | Body |
| --- | --- |
| Single resource | `{ success: true, data: { ... } }` |
| Collection | `{ success: true, data: [ ... ], meta: { ... } }` |
| No content (delete, logout) | `204 No Content`, empty body |
| Accepted async work | `202 Accepted` + `{ success: true, data: { jobId, status: "QUEUED" } }` |

### 2.3 What a DTO must do

Documents are never sent straight to the client. A **mapper** builds the response DTO:

```ts
// applications.mapper.ts — the reason this file exists
export const toResponse = (a: ApplicationDocument): ApplicationResponseDto => ({
  id: a._id.toString(),
  job: { id: a.jobId.toString(), title: a.snapshot.jobTitle },  // snapshot, not live job
  candidate: { id: a.candidateId.toString(), name: a.candidateName, headline: a.candidateHeadline },
  status: a.status,
  appliedAt: a.appliedAt,
  stageEnteredAt: a.stageEnteredAt,
  rejectionReason: a.rejectionReason ?? null,
  withdrawnAt: a.withdrawnAt ?? null,
  // deliberately absent: organizationId, __v, applicantCount internals, other tenants' ids
});
```

Why this matters: it is the **only** place where "what a client may see" is decided. When
someone later adds `salary` to a job document, forgetting the mapper does not leak it —
the DTO is an allow-list, not a deny-list. **Deny-lists leak. Allow-lists don't.**

### 2.4 Public vs member DTOs

Some resources have two shapes:
- `toPublicResponse(job)` — no `salary`, no `applicantCount`, no `createdBy.email`.
- `toMemberResponse(job, membership)` — full, including `salary` for recruiters.

Two functions, not one function with `if (isAdmin)`. A boolean flag in a serializer
invites the bug where you forget the check on a new field.

---

## 3. Error format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "path": "body.email", "message": "Must be a valid email address", "code": "invalid_string" }
    ],
    "requestId": "01HQ…"          // for support / log correlation
  }
}
```

`code` is the contract; `message` is for humans and may change. Clients branch on `code`,
never on `message`.

### 3.1 Error catalogue

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed request we cannot classify |
| 400 | `INVALID_IDENTIFIER` | Malformed ObjectId in a param |
| 400 | `INVALID_FILE` | Upload failed magic-byte/size/type validation |
| 401 | `MISSING_TOKEN` | No `Authorization` header |
| 401 | `INVALID_TOKEN` | Bad signature / malformed JWT |
| 401 | `TOKEN_EXPIRED` | `exp` passed (client should refresh) |
| 401 | `TOKEN_REVOKED` | `tokenVersion` mismatch |
| 401 | `INVALID_CREDENTIALS` | Login failed — **identical for unknown email and wrong password** |
| 401 | `USER_SUSPENDED` | Account disabled |
| 403 | `INSUFFICIENT_ROLE` | Role lacks the required permission |
| 403 | `FORBIDDEN` | Authenticated but not permitted (rare; prefer 404) |
| 404 | `ROUTE_NOT_FOUND` | Unknown path |
| 404 | `*_NOT_FOUND` | Resource absent **or** outside your tenant (deliberately merged) |
| 409 | `EMAIL_ALREADY_EXISTS` | Registration conflict |
| 409 | `APPLICATION_EXISTS` | Duplicate apply (unique index) |
| 409 | `INVALID_STAGE_TRANSITION` | Pipeline rule violation |
| 409 | `FEEDBACK_ALREADY_SUBMITTED` | Unique (interview, interviewer) |
| 409 | `RESOURCE_IN_USE` | Cannot delete (has applications) |
| 409 | `VERSION_CONFLICT` | Optimistic concurrency failed |
| 413 | `PAYLOAD_TOO_LARGE` | Body/upload over cap |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Wrong content type |
| 422 | `VALIDATION_ERROR` | Zod failed — the *request* was well-formed but semantically invalid |
| 429 | `RATE_LIMITED` | Throttled; `Retry-After` header set |
| 500 | `INTERNAL_ERROR` | Bug. Generic message; details only in logs via `requestId` |
| 503 | `SERVICE_UNAVAILABLE` | DB not connected (readiness probe) |

### 3.2 400 vs 422 — why we bother

- **400**: the request could not be parsed/understood — invalid ObjectId, malformed JSON.
- **422**: parsed fine, but the values are unacceptable — `email` not an email, `limit`
  above max, `startsAt` in the past.

The practical value: a client can distinguish "fix your syntax" from "fix your data", and
the frontend can attach field-level errors to inputs. Most teams collapse them to 400;
being able to justify 422 (and Zod's `issues → details` mapping) is a small,
credible signal of API maturity.

### 3.3 404 for not-found *and* for cross-tenant

Already argued in `03-system-architecture.md` §3.4. In short: `403` on a resource you do
not own confirms the resource exists, turning the API into a tenant-enumeration oracle.
`404` is uniformly safe and costs nothing.

---

## 4. Pagination

### 4.1 Contract

```
GET /api/applications?limit=20&cursor=eyJ...     → cursor pagination (high churn)
GET /api/organizations/:id/members?page=1&limit=25 → offset pagination (bounded, stable)
```

Cursor payload is base64url of `{ sortValue, id }`, opaque to the client, decoded and
validated server-side (a tampered cursor → `400 INVALID_CURSOR`).

### 4.2 Rules

| Rule | Value | Reason |
| --- | --- | --- |
| Default `limit` | 20 | Usable default; smaller round-trips |
| Max `limit` | 100 | Enforced in Zod. An unbounded `limit` is a DoS vector and a `skip`-amplifier |
| Sort | allow-list per endpoint | `?sort=-createdAt,status` from a **whitelist**; arbitrary sort keys are an index-availability and DoS risk |
| Deterministic order | always append `_id` as final tiebreaker | otherwise pagination duplicates/skips rows with equal sort values |
| `meta` | `limit`, `nextCursor`, `hasNext`, `total?` | `total` is expensive on big collections — cursor endpoints omit it |
| Hard cap on offset | `page * limit ≤ 500` | blocks `?page=100000` CPU burn |

### 4.3 Sort allow-list, concretely

```ts
const JOB_SORT = { newest: { publishedAt: -1, _id: -1 }, oldest: { publishedAt: 1, _id: 1 },
                   title: { title: 1, _id: 1 } } as const;
export const jobSortSchema = z.enum(Object.keys(JOB_SORT) as [string, ...string[]]);
```

The user sends `?sort=newest`; the server expands it to a trusted sort object. The client
can never cause a sort that no index supports.

---

## 5. Request semantics we care about

### 5.1 Idempotency

**`POST /api/applications` must be safe to retry.** A candidate on a slow connection
double-clicks Apply; a mobile client retries on timeout. Without protection you get two
applications, and with `{ jobId, candidateId }` unique you get a confusing `409` that
looks like a bug.

Two-layer solution:
1. Client sends `Idempotency-Key: <uuid>` (generated once per user intent).
2. Server stores `{ key, userId, responseHash }` for 24 h (TTL index). Replay with the
   same key returns the **original** response with `Idempotency-Replayed: true`.
3. The unique index on `(organizationId, jobId, candidateId)` remains the ultimate
   guarantee; the idempotency record only converts a conflict into a clean replay.

**Why not rely on the unique index alone?** Because it produces a *failure*, not the
correct answer. A retried `POST` should return the already-created application with
`200/201`, not `409`. This is a small piece of engineering that most tutorial projects skip
and most production APIs get right — worth mentioning in an interview.

### 5.2 Optimistic concurrency on stage moves

```
PATCH /api/applications/:id/status
{
  "status": "INTERVIEW",
  "reason": "Strong portfolio review",
  "expectedStatus": "SHORTLISTED"      // optional; enables conflict detection
}
```

If `expectedStatus` is supplied and the document has moved, respond
`409 VERSION_CONFLICT` with the current status so the UI can refetch. Cheap protection
against two open tabs or a double-click.

### 5.3 Partial vs full update

`PATCH` = partial. Every route declares which fields are updatable; a generic
`PATCH /api/applications/:id` that accepts `status` is **forbidden by design** — status
only moves through `PATCH /api/applications/:id/status`, which runs the state machine and
writes history + audit. Route design enforcing the invariant is better than a service
function everyone must remember to call.

### 5.4 Idempotent non-CRUD endpoints

`POST /api/jobs/:id/publish` when already published returns `200` with the unchanged
resource rather than `409`. A publish button clicked twice is a UI bug, not an attack.
Reserve `409` for genuine state conflicts (`INVALID_STAGE_TRANSITION`).

---

## 6. Status codes used consistently

| Code | Used for |
| --- | --- |
| 200 | Successful read, update, or idempotent action |
| 201 | Resource created; includes `Location` header for the new resource |
| 202 | Async accepted (Phase 9 email/bulk export) |
| 204 | Successful delete/logout; empty body |
| 400/401/403/404/409/413/415/422/429/500/503 | see error catalogue |

**`POST` that both creates and triggers side effects** (apply → notification + audit)
still returns `201`; side effects are internal, not the client's concern.

---

## 7. Versioning

`/api/v1/...` from day one.

Rationale: the version prefix costs one string, and retrofitting versioning after
clients exist is the painful path. We also generate an **OpenAPI 3.1 spec** from the Zod
schemas (via `zod-to-openapi`) so the spec cannot drift from the implementation — a
monorepo where the docs are generated from the validators is a real, demonstrable
engineering practice.

**Breaking vs non-breaking** (write this in the README):
- Breaking: remove/rename a field, narrow a type, add a required field, change an enum's
  meaning, change a status code.
- Non-breaking: add an optional field, add a new enum value *if* clients tolerate unknown
  values, relax validation, add a new endpoint.

That last clause has teeth: **adding a pipeline stage can break naive clients.** A mobile
client with a `switch` over known stages will break. Mitigation is either an unknown-value
fallback or a `/api/v1/meta/stages` endpoint clients poll. Worth raising in an interview.

---

## 8. Planned endpoint surface

Not built in Phase 0. Listed so the design is visible and so we can check, per phase,
that we are not inventing endpoints mid-implementation. Public routes are marked.

### `auth`
| Method | Path | Auth | Permission / rule | Phase |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | public | rate-limited; `EMAIL_ALREADY_EXISTS` on dupe | 2 |
| POST | `/api/v1/auth/login` | public | rate-limited; generic `INVALID_CREDENTIALS` | 2 |
| POST | `/api/v1/auth/refresh` | cookie | rotation + reuse detection | 2 |
| POST | `/api/v1/auth/logout` | cookie | revokes token | 2 |
| POST | `/api/v1/auth/logout-all` | bearer | bumps `tokenVersion` | 2 |
| GET | `/api/v1/auth/me` | bearer | current user + memberships | 2 |
| POST | `/api/v1/auth/forgot-password` | public | always 202 (no enumeration) | 2 |
| POST | `/api/v1/auth/reset-password` | public | single-use hashed token | 2 |
| POST | `/api/v1/auth/verify-email` | public | token → `emailVerified` | 2 |
| PATCH | `/api/v1/auth/me` | bearer | firstName/lastName/avatarUrl | 2 |

### `organizations`
| Method | Path | Auth | Permission / rule | Phase |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/organizations` | bearer | creator becomes ADMIN | 3 |
| GET | `/api/v1/organizations` | bearer | orgs where I am ACTIVE member | 3 |
| GET | `/api/v1/organizations/:organizationId` | member | `ORG_SETTINGS` or any member | 3 |
| PATCH | `/api/v1/organizations/:organizationId` | member | `ORG_SETTINGS` | 3 |
| GET | `/api/v1/organizations/:organizationId/members` | member | any member (Roster) | 3 |
| POST | `/api/v1/organizations/:organizationId/invitations` | member | `MEMBER_MANAGE` | 3 |
| PATCH | `/api/v1/organizations/:organizationId/members/:memberId` | member | `MEMBER_MANAGE`; cannot demote last ADMIN | 3 |
| DELETE | `/api/v1/organizations/:organizationId/members/:memberId` | member | `MEMBER_MANAGE`; last-ADMIN guard | 3 |
| POST | `/api/v1/invitations/:token/accept` | bearer | activates membership | 3 |

### `jobs`
| Method | Path | Auth | Permission / rule | Phase |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/jobs` | member | list org jobs; `status`, `q`, `sort`, pagination | 4 |
| POST | `/api/v1/jobs` | member | `JOB_CREATE` → `DRAFT` | 4 |
| GET | `/api/v1/jobs/:jobId` | member | full DTO + counts | 4 |
| PATCH | `/api/v1/jobs/:jobId` | member | `JOB_UPDATE`; no `status` field | 4 |
| DELETE | `/api/v1/jobs/:jobId` | member | `JOB_DELETE`; `409 RESOURCE_IN_USE` if applications exist | 4 |
| POST | `/api/v1/jobs/:jobId/publish` | member | `JOB_PUBLISH`; validates required fields | 4 |
| POST | `/api/v1/jobs/:jobId/close` | member | `JOB_PUBLISH` | 4 |
| GET | **/api/v1/public/jobs** | public | `PUBLISHED` only; `q`, `location`, `employmentType`, `skills` | 4 |
| GET | **/api/v1/public/jobs/:slug** | public | public DTO | 4 |

### `candidates`
| Method | Path | Auth | Permission / rule | Phase |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/candidates` | member | `CANDIDATE_VIEW`; `q`, `skill`, `location`, `stage`, `jobId`, sort, pagination | 5/8 |
| POST | `/api/v1/candidates` | member | recruiter-added lead (`userId: null`) | 5 |
| GET | `/api/v1/candidates/:candidateId` | member | `CANDIDATE_VIEW` **or** owner **or** assigned interviewer | 5 |
| PATCH | `/api/v1/candidates/:candidateId` | owner / `CANDIDATE_VIEW` | field allow-list | 5 |
| GET | **/api/v1/me/candidate-profile** | bearer | candidate's own profile | 5 |
| PUT | **/api/v1/me/candidate-profile** | bearer | upsert own profile | 5 |
| POST | **/api/v1/me/resume** | bearer | PDF, ≤5 MB, magic bytes; returns version | 5 |
| GET | **/api/v1/me/resume** | bearer | owner or `CANDIDATE_VIEW`; audit `RESUME_DOWNLOADED` | 5 |
| DELETE | **/api/v1/me/resume** | bearer | owner only | 5 |

### `applications`
| Method | Path | Auth | Permission / rule | Phase |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/applications` | member | `APPLICATION_MOVE`; board view grouped by stage | 5/6 |
| GET | **/api/v1/me/applications** | bearer | candidate's own, with job snapshot + status | 5 |
| POST | **/api/v1/me/applications** | bearer | `{ jobId }`; `Idempotency-Key` honoured; job must be PUBLISHED | 5 |
| GET | `/api/v1/applications/:applicationId` | member | `APPLICATION_MOVE` or owner or assigned interviewer | 5 |
| PATCH | `/api/v1/applications/:applicationId/status` | member | `APPLICATION_MOVE`; state machine; `reason` required for REJECTED; writes history + audit; honours `expectedStatus` | 6 |
| POST | **/api/v1/me/applications/:id/withdraw** | owner | sets `withdrawnAt` | 5 |
| GET | `/api/v1/applications/:applicationId/history` | member | `APPLICATION_MOVE` or owner | 6 |
| GET | `/api/v1/jobs/:jobId/stats` | member | `JOB_VIEW_ALL`; funnel counts | 6/10 |

### `interviews`
| Method | Path | Auth | Permission / rule | Phase |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/interviews` | member | `INTERVIEW_*`; if role INTERVIEWER → filtered to self | 7 |
| GET | **/api/v1/me/interviews** | bearer | candidate's own upcoming + past | 7 |
| POST | `/api/v1/interviews` | member | `INTERVIEW_SCHEDULE`; app must be SHORTLISTED/INTERVIEW; `endsAt` derived | 7 |
| GET | `/api/v1/interviews/:interviewId` | member | assigned interviewer or `INTERVIEW_SCHEDULE` | 7 |
| PATCH | `/api/v1/interviews/:interviewId` | member | `INTERVIEW_SCHEDULE`; title/type/duration/instructions | 7 |
| POST | `/api/v1/interviews/:interviewId/reschedule` | member | `INTERVIEW_SCHEDULE`; bumps `rescheduleCount`; notifies | 7 |
| POST | `/api/v1/interviews/:interviewId/cancel` | member | `INTERVIEW_SCHEDULE`; `reason` required | 7 |
| POST | `/api/v1/interviews/:interviewId/feedback` | member | `FEEDBACK_SUBMIT`; **must be assigned**; unique per interviewer | 7 |
| GET | `/api/v1/interviews/:interviewId/feedback` | member | assigned interviewer (own before submit) / recruiter (all) | 7 |
| PATCH | `/api/v1/interviews/:interviewId/feedback/:feedbackId` | author | until `feedbackLockedAt` | 7 |

### `notifications` (Phase 9)
| Method | Path | Auth | Rule |
| --- | --- | --- | --- |
| GET | `/api/v1/notifications` | bearer | own only; `unreadOnly`, cursor pagination |
| POST | `/api/v1/notifications/:id/read` | bearer | own only |
| POST | `/api/v1/notifications/read-all` | bearer | own only |
| GET | `/api/v1/notifications/unread-count` | bearer | for the nav badge |
| — | `GET /api/v1/ws` (Socket.IO) | cookie+bearer | org/user rooms, typed events |

### `audit` (Phase 3+, admin UI Phase 10)
| Method | Path | Auth | Rule |
| --- | --- | --- | --- |
| GET | `/api/v1/audit-logs` | member | `AUDIT_VIEW` (ADMIN); `actorId`, `action`, `resourceType`, `from`, `to`, cursor |

### `system`
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | public | liveness; no DB touch |
| GET | `/api/health/ready` | public | readiness; `503` if DB down |
| GET | `/api/v1/meta/pipeline` | bearer | stage list + allowed transitions (client-side UI needs it) |

Note the two health routes are **outside `/api/v1`** on purpose: infrastructure probes
should not break when the API version changes.

---

## 9. Conventions every endpoint must document

For each endpoint we add to the OpenAPI spec, and each gets an entry in
`docs/api/` when built:

1. Method + path + purpose (one line).
2. Auth requirement (`public` / `bearer` / `cookie` / membership).
3. Required permission, or the ownership predicate used instead.
4. Request body schema (Zod) and query/param schema.
5. Success response shape (envelope + DTO).
6. Every possible error code with its trigger.
7. Side effects (audit event, notification, transaction scope).
8. Index used for the main query.
9. Test names that cover it.

Items 7–9 are what separate a production API from a tutorial one, and they are exactly
what an interviewer will ask about. Writing them per-endpoint also makes Phase 12's test
plan a by-product instead of a chore.

---

## 10. Anti-patterns we are explicitly avoiding

| Anti-pattern | Why it is wrong | What we do instead |
| --- | --- | --- |
| `POST /api/v1/getAllJobs` | RPC, breaks HTTP semantics, untestable with caches | `GET /api/v1/jobs` |
| Returning the Mongoose document | Leaks internals, `__v`, other tenants' ids | mapper → allow-list DTO |
| `PATCH /api/applications/:id { status }` | Bypasses the state machine | dedicated `/status` route |
| Client sends `role` or `organizationId` in the body for writes | Privilege escalation | server resolves both from session |
| Unbounded `GET /api/candidates` | Memory + latency blowup; DoS | mandatory pagination, `max limit` |
| `?sort=` straight from the client | Can force a non-indexed sort | allow-list expansion |
| Different envelope per feature | Client branching everywhere | one envelope, one unwrap function |
| 200 with `{ error: ... }` in the body | Breaks HTTP tooling, caches, monitoring | real status code + `success: false` |
| Stack traces in responses | Information disclosure | generic message + `requestId`, full detail in logs |
| `select: *` and log whole request bodies | Leaks passwords/tokens into logs | field allow-lists, redaction in the logger |
