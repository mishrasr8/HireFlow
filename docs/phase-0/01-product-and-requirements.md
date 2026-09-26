# HireFlow — Phase 0: Product & Requirements

> Status: **Approved for design. No application code written yet.**
> This document is the source of truth for *what* HireFlow is. Technical design lives in
> `02-domain-model.md`, `03-system-architecture.md`, `04-api-design-strategy.md`,
> `05-decisions-and-tradeoffs.md`.

---

## 1. Product overview

**HireFlow** is a multi-tenant, web-based Applicant Tracking System (ATS).

A company signs up, creates an **organization** (its workspace), invites its team, and
then runs a hiring pipeline end to end:

```
create job -> publish job -> candidate applies -> recruiter screens -> candidate
shortlisted -> interview scheduled -> feedback submitted -> stage transitions ->
offer / rejection -> hire
```

Every company on HireFlow is a **tenant**. Two companies must never see each other's
jobs, candidates, resumes, or applicants — not because the frontend hides the buttons,
but because the backend refuses to return the rows.

### 1.1 What problem an ATS actually solves

Recruiting without an ATS looks like this in practice:

- jobs posted on 6 different job boards
- resumes scattered across email inboxes and personal drives
- a spreadsheet that tracks "where each candidate is"
- interviewers who "definitely submitted feedback" (they did not)
- no record of *why* a candidate was rejected, so the same rejection is re-litigated next quarter
- zero visibility into funnel health: how many applicants, how many screened, how long

An ATS is therefore **not** a job board. It is a **workflow + record system** for a
business process. That framing drives every design decision that follows:

- The pipeline (state machine) is the heart of the product, not CRUD screens.
- Every state change is a *recorded business event*, so audit logging is core, not extra.
- Access control must be enforced on the server, because a hiring process contains
  PII (name, email, resume, salary expectations) that is legally sensitive.

### 1.2 Scope boundary for this project

HireFlow is a **portfolio-grade reference implementation**, not a commercial ATS.
Explicitly out of scope (documented so reviewers can see judgement, not gaps):

| Out of scope | Why |
| --- | --- |
| Job board scraping / syndication to Indeed, LinkedIn | Integration surface, not core value |
| Payroll, onboarding, e-signature | Separate products |
| Offer letter PDF generation & e-sign | Phase-14 stretch, legally sensitive |
| SSO / SAML / SCIM | Enterprise concern, needs a real IdP |
| Native mobile app | Web is enough to demonstrate the architecture |
| B2C "freelance marketplace" between candidates and companies | Different product, different trust model |

---

## 2. Problem statement

> **Problem.** Small and mid-sized companies hire through spreadsheets, inboxes and
> ad-hoc forms. This produces lost candidates, untracked interview stages, missing
> interviewer feedback, no funnel analytics, and no defensible record of hiring
> decisions. Building a real ATS requires modelling a hiring *workflow* with strict,
> role-based access to personally identifiable information — which most off-the-shelf
> tools either do too loosely or price out of reach.

> **Solution.** HireFlow provides a multi-tenant ATS that models the hiring workflow
> explicitly as a validated state machine, isolates data per tenant on the server,
> records every consequential action in an append-only audit log, and exposes hiring
> analytics via database aggregation rather than in-browser computation.

### 2.1 Non-goals (things we explicitly refuse to build)

1. **No client-side-only security.** Hiding a button is a UX affordance, not a control.
2. **No AI hiring decisions.** AI may *summarise* evidence. It must never be the decision.
3. **No unbounded collections.** Every list endpoint is paginated from day one.
4. **No premature microservices.** One deployable backend, modular internally.

---

## 3. User personas

### Persona 1 — Priya Sharma, Talent Acquisition Lead (`ADMIN`)

- Manages hiring for a 180-person SaaS company, 6 open roles, ~40 candidates/month.
- Also runs the weekly hiring sync, so she needs funnel numbers she can trust.
- Pain: cannot answer "how many candidates did we reject for lack of React experience
  last quarter, and who decided that?"
- Needs: org settings, member + role management, audit log, analytics.

### Persona 2 — Rahul Verma, Technical Recruiter (`RECRUITER`)

- Owns 4 job reqs end to end. Lives in the pipeline board all day.
- Pain: candidates go quiet and he does not know whether they were rejected or simply
  never looked at; he also needs to hand off context to interviewers.
- Needs: create/edit/publish jobs, move candidates, schedule interviews, read feedback.

### Persona 3 — Ananya Nair, Engineering Manager (`INTERVIEWER`)

- 2 hours/week of interview time, across 3 reqs. Does not want to see the whole
  candidate database — only the candidates she is assessing.
- Needs: "my upcoming interviews" list, read-only candidate + resume context for
  assigned interviews only, a structured feedback form, ability to decline/reschedule.

### Persona 4 — Karthik Iyer, Final-year student (`CANDIDATE`)

- Applies to 30+ jobs, gets no clarity on status, and cannot remember who he spoke to.
- Needs: profile + resume, job discovery with filters, one-click apply, application
  tracker with stage + "who is reviewing", interview calendar, notifications.

### Persona 5 — Meera Joshi, Compliance & People Ops (secondary persona, drives `AuditLog`)

- Needs evidence for an internal or external inquiry: "show me who accessed this
  candidate's record and who changed this application's stage."
- Needs: append-only audit trail, filterable by actor / action / resource / time.

---

## 4. User stories

Format: *As a* `<persona>` *I want to* `<capability>` *so that* `<value>`.
Priority: **M** = Must (MVP, v1) · **S** = Should (v1.x) · **C** = Could (v2) · **W** = Won't (documented)

### 4.1 Authentication & account (`auth`)

| ID | User story | Pri |
| --- | --- | --- |
| US-AUTH-01 | As a visitor I want to register with email + password so I can create an account. | M |
| US-AUTH-02 | As a registered user I want to log in and receive a session so I am recognised. | M |
| US-AUTH-03 | As a logged-in user I want to log out so my session is destroyed server-side. | M |
| US-AUTH-04 | As a user with an expired access token I want to be silently refreshed so I am not logged out mid-task. | M |
| US-AUTH-05 | As a user I want my password hashed (never stored or logged in plain text) so a database leak does not expose me. | M |
| US-AUTH-06 | As a user I want to reset a forgotten password via emailed one-time link. | S |
| US-AUTH-07 | As a user I want to verify my email address before using the product seriously. | S |
| US-AUTH-08 | As a user I want to be shown precise validation errors so I can fix my input. | M |

### 4.2 Organization & access control (`organizations`)

| ID | User story | Pri |
| --- | --- | --- |
| US-ORG-01 | As a new user I want to create an organization and become its ADMIN. | M |
| US-ORG-02 | As an ADMIN I want to invite members by email with a role so I can build a team. | M |
| US-ORG-03 | As an ADMIN I want to change a member's role and remove them, so access stays current. | M |
| US-ORG-04 | As a member I want to see only my organization's data so tenants are isolated. | M |
| US-ORG-05 | As an ADMIN I want to configure org name, slug, timezone and default pipeline. | S |
| US-ORG-06 | As an ADMIN I want to suspend a member without deleting their history. | S |

### 4.3 Job management (`jobs`)

| ID | User story | Pri |
| --- | --- | --- |
| US-JOB-01 | As a RECRUITER I want to create a draft job so I can define a req without publishing. | M |
| US-JOB-02 | As a RECRUITER I want to publish/unpublish a job to control when it is visible. | M |
| US-JOB-03 | As a RECRUITER I want to edit job details and close a job when it is filled. | M |
| US-JOB-04 | As a candidate I want to browse published jobs with filters (title, location, type, date). | M |
| US-JOB-05 | As a candidate I want a public job detail page with a clear Apply action. | M |
| US-JOB-06 | As a RECRUITER I want to see per-job stats (applicants, in-pipeline, time-to-fill). | S |
| US-JOB-07 | As a RECRUITER I want to duplicate an existing job to reuse a template. | C |
| US-JOB-08 | As a RECRUITER I want to export applicants to CSV. | C |

### 4.4 Candidate & applications (`candidates`, `applications`)

| ID | User story | Pri |
| --- | --- | --- |
| US-CAND-01 | As a candidate I want to maintain one profile that I can reuse across applications. | M |
| US-CAND-02 | As a candidate I want to upload a PDF resume so I do not retype it. | M |
| US-CAND-03 | As a candidate I want to apply to a job in one action. | M |
| US-CAND-04 | As a candidate I want to see all my applications with current stage and next step. | M |
| US-CAND-05 | As a candidate I want to be told I already applied, rather than creating a duplicate. | M |
| US-CAND-06 | As a RECRUITER I want to see the candidate list for my org with search and pagination. | M |
| US-CAND-07 | As a RECRUITER I want to read a candidate's profile and resume from the pipeline. | M |
| US-CAND-08 | As a RECRUITER I want to add private notes about a candidate. | S |
| US-CAND-09 | As a candidate I want to withdraw an application. | S |
| US-CAND-10 | As a candidate I want saved searches / job alerts. | C |

### 4.5 Hiring pipeline (`applications`)

| ID | User story | Pri |
| --- | --- | --- |
| US-PIPE-01 | As a RECRUITER I want a board grouped by stage so I can see the whole pipeline. | M |
| US-PIPE-02 | As a RECRUITER I want to move a candidate between stages and have the move validated. | M |
| US-PIPE-03 | As a RECRUITER I want to see a candidate's stage history with who/when/why. | M |
| US-PIPE-04 | As a RECRUITER I want an illegal move (e.g. Hired → Applied) to be rejected with a clear reason. | M |
| US-PIPE-05 | As a RECRUITER I want a stage move to be blocked if a required step is missing (e.g. no interview before Hired). | S |
| US-PIPE-06 | As an ADMIN I want every stage change in the audit log. | M |
| US-PIPE-07 | As a RECRUITER I want to configure custom stages per organization. | C (design-ready only) |

### 4.6 Interviews (`interviews`)

| ID | User story | Pri |
| --- | --- | --- |
| US-INT-01 | As a RECRUITER I want to schedule an interview with interviewers, time, duration and meeting link. | M |
| US-INT-02 | As an INTERVIEWER I want a list of only my assigned interviews. | M |
| US-INT-03 | As an INTERVIEWER I want to see the candidate context needed to interview, and nothing more. | M |
| US-INT-04 | As an INTERVIEWER I want a structured feedback form (technical, problem solving, communication, role criteria, written notes). | M |
| US-INT-05 | As an INTERVIEWER I want to submit feedback once and be able to edit until the round is closed. | M |
| US-INT-06 | As a RECRUITER I want to reschedule or cancel an interview with a reason. | M |
| US-INT-07 | As a candidate I want to see my upcoming interviews with time zone shown correctly. | S |
| US-INT-08 | As a RECRUITER I want to see aggregated feedback for a candidate. | M |

### 4.7 Notifications, real-time, analytics, AI

| ID | User story | Pri |
| --- | --- | --- |
| US-NOT-01 | As a user I want an in-app notification when my application moves stage. | M (P9) |
| US-NOT-02 | As an INTERVIEWER I want to be notified when assigned an interview. | M (P9) |
| US-NOT-03 | As a user I want an email notification for consequential events (application received, interview scheduled). | S (P9) |
| US-NOT-04 | As a RECRUITER I want the pipeline board to update without manual refresh. | S (P9) |
| US-RT-01 | As a candidate I want to see my application status update live. | S (P9) |
| US-ANL-01 | As a RECRUITER/ADMIN I want a hiring funnel (count per stage) to see where candidates drop off. | M (P10) |
| US-ANL-02 | As a RECRUITER I want applications-over-time and time-in-stage to spot bottlenecks. | S (P10) |
| US-ANL-03 | As an ADMIN I want per-job and per-member hiring throughput. | S (P10) |
| US-AI-01 | As a RECRUITER I want an explainable resume ↔ job comparison to prioritise my review time. | S (P11) |
| US-AI-02 | As a RECRUITER I want AI output to be clearly labelled assistive, never a score that auto-decides. | M (P11) |

---

## 5. Functional requirements

Each requirement is **atomic** and **testable** — this is what lets us write the Phase 12
test suite directly from this table, and what lets an interviewer see traceability.

### 5.1 Authentication (FR-AUTH)

| ID | Requirement |
| --- | --- |
| FR-AUTH-01 | Registration accepts email, password, firstName, lastName; normalises email to lowercase/trim. |
| FR-AUTH-02 | Registration rejects a duplicate email with `409 EMAIL_ALREADY_EXISTS` and a non-enumerating message policy (see NFR-SEC-04). |
| FR-AUTH-03 | Passwords are stored only as a salted adaptive hash (bcrypt/argon2), never reversibly. |
| FR-AUTH-04 | Login with correct credentials returns a short-lived access token + sets an httpOnly refresh cookie. |
| FR-AUTH-05 | Login with wrong password or unknown email returns the **same** `401 INVALID_CREDENTIALS`. |
| FR-AUTH-06 | Refresh rotates the refresh token and invalidates the presented one (reuse ⇒ revoke whole family). |
| FR-AUTH-07 | Logout revokes the presented refresh token server-side and clears the cookie. |
| FR-AUTH-08 | Protected routes reject requests with no/invalid/expired access token using `401`. |
| FR-AUTH-09 | Rate limiting is applied to `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/forgot-password`. |
| FR-AUTH-10 | Password reset tokens are single-use, short-lived, stored hashed, and invalidated on use. |

### 5.2 Tenancy & RBAC (FR-ORG)

| ID | Requirement |
| --- | --- |
| FR-ORG-01 | Any authenticated user may create an organization; the creator becomes `ADMIN`. |
| FR-ORG-02 | Every tenant-scoped collection carries `organizationId`; every read/write is scoped by it. |
| FR-ORG-03 | A member's role is stored per organization, not globally. |
| FR-ORG-04 | Invite creates an `OrganizationMember` with status `INVITED`; acceptance activates it. |
| FR-ORG-05 | Role updates and removals are restricted to `ADMIN`. |
| FR-ORG-06 | An `ADMIN` cannot remove or demote the **last** active `ADMIN` of an organization. |
| FR-ORG-07 | A non-member requesting an org-scoped resource receives `404` (not `403`) to avoid existence disclosure. |
| FR-ORG-08 | Every role-restricted endpoint declares its required permission in one central permission map. |

### 5.3 Jobs (FR-JOB)

| ID | Requirement |
| --- | --- |
| FR-JOB-01 | Create requires `RECRUITER` or `ADMIN`; creates a `DRAFT` job. |
| FR-JOB-02 | Publishing requires title, description, location, employmentType and at least one skill. |
| FR-JOB-03 | Only `DRAFT`/`PUBLISHED`/`CLOSED` transitions are permitted for `status`; publish sets `publishedAt`. |
| FR-JOB-04 | A member may update/delete only jobs of their own organization. |
| FR-JOB-05 | Public endpoints expose only `PUBLISHED` jobs and strip recruiter-only fields. |
| FR-JOB-06 | Public job listing supports `q`, `location`, `employmentType`, `skills`, `sort`, `page`, `limit`. |
| FR-JOB-07 | `DELETE` on a job with applications must either be refused or archive rather than hard-delete (default: refuse + `409`, archive is S). |
| FR-JOB-08 | Job detail includes aggregate counts (applicants, active pipeline) for members only. |

### 5.4 Candidates & applications (FR-CAND, FR-APP)

| ID | Requirement |
| --- | --- |
| FR-CAND-01 | A `User` may hold at most one `CandidateProfile` per organization. |
| FR-CAND-02 | Candidate profile owns headline, summary, location, links, skills, total experience years. |
| FR-CAND-03 | Resume upload accepts PDF only, ≤ 5 MB, verified by magic-byte sniffing, not by client MIME. |
| FR-CAND-04 | A stored resume is referenced by an object-storage key, never by a user-supplied path. |
| FR-CAND-05 | Applying requires an authenticated user, a `PUBLISHED` job, and no existing application for (job, candidate). |
| FR-CAND-06 | Duplicate application is rejected `409 APPLICATION_EXISTS` **and** is guaranteed by a unique compound index, not only application code. |
| FR-CAND-07 | Creating an application snapshots the job's title and the resume key at apply-time so later edits do not rewrite history. |
| FR-CAND-08 | A candidate may read/update only their own profile and applications. |
| FR-CAND-09 | A recruiter may read candidates only inside their own organization. |
| FR-CAND-10 | Application `status` is changed only through the pipeline transition service, never by a generic `PATCH`. |
| FR-CAND-11 | Every status change writes an immutable stage-history entry (from, to, actor, reason, timestamp). |
| FR-CAND-12 | Withdrawing an application sets `withdrawnAt` and terminal state `REJECTED`-equivalent (`WITHDRAWN` as a distinct flag, not a stage). |

### 5.5 Interviews (FR-INT)

| ID | Requirement |
| --- | --- |
| FR-INT-01 | Schedule requires an existing application in `SHORTLISTED` or `INTERVIEW` stage. |
| FR-INT-02 | `startsAt` is stored as UTC; the response includes the org timezone and a formatted local string. |
| FR-INT-03 | `endAt` is derived from `startsAt + durationMins` on the server (client value is ignored). |
| FR-INT-04 | At least one interviewer is required; interviewers must be org members with `INTERVIEWER` or `RECRUITER` role. |
| FR-INT-05 | An interviewer may read only interviews they are assigned to. |
| FR-INT-06 | Feedback is unique per (interview, interviewer) — a second submit conflicts `409`. |
| FR-INT-07 | Feedback is editable by its author only while the interview is not `COMPLETED`-locked. |
| FR-INT-08 | Rating fields are bounded integers (1–5) validated server-side. |
| FR-INT-09 | Reschedule increments `rescheduleCount` and notifies all assigned interviewers + the candidate. |
| FR-INT-10 | An interview's aggregated recommendation is derived from feedback, never from a single number, and is advisory only. |

### 5.6 Notifications, audit, search, analytics (FR-NOT, FR-AUD, FR-SEARCH, FR-ANL)

| ID | Requirement |
| --- | --- |
| FR-NOT-01 | Notification is created for: application received, stage change, interview scheduled/rescheduled/cancelled, feedback submitted, member invited. |
| FR-NOT-02 | A notification belongs to exactly one recipient user; read/unread tracked per user. |
| FR-NOT-03 | Email is dispatched **asynchronously** and never blocks the originating HTTP response. |
| FR-AUD-01 | Every consequential action writes an audit record: actor, action, resource type, resource id, org, timestamp, metadata, IP, user agent. |
| FR-AUD-02 | Audit records are append-only; no update or delete API exists. |
| FR-AUD-03 | Audit reads are `ADMIN`-only and paginated newest-first. |
| FR-SEARCH-01 | Candidate search filters: `q` (name/email/headline), `skill`, `location`, `stage`, `jobId`, `minExperience`. |
| FR-SEARCH-02 | All list endpoints are server-paginated with a hard `max limit`; the client never receives unbounded lists. |
| FR-SEARCH-03 | Search uses indexes, not full-collection scans; the query plan is verified with `explain()` in development. |
| FR-ANL-01 | Funnel analytics = count of applications grouped by current stage for a job or org. |
| FR-ANL-02 | Applications over time = count grouped by month from `createdAt`. |
| FR-ANL-03 | All analytics are computed in the database via aggregation, then returned as plain DTOs. |
| FR-ANL-04 | Analytics endpoints are restricted to `ADMIN`/`RECRUITER` and always scoped by `organizationId`. |

### 5.7 Cross-cutting (FR-SYS)

| ID | Requirement |
| --- | --- |
| FR-SYS-01 | All responses use the envelope `{ success, data, meta? }` / `{ success, error }`. |
| FR-SYS-02 | All failures carry a machine-readable `error.code` and a human-readable `message`. |
| FR-SYS-03 | Internal errors (stack traces, driver messages) are never sent to clients; they are logged with a correlation id. |
| FR-SYS-04 | Every request carries a `requestId` (accepted from `x-request-id` or generated) and it appears in every log line. |
| FR-SYS-05 | Every request body, query and param is schema-validated before reaching a service. |
| FR-SYS-06 | `GET /api/health` reports liveness without touching the DB; `GET /api/health/ready` reports DB connectivity. |
| FR-SYS-07 | The API is rate-limited globally and more strictly on auth and write endpoints. |
| FR-SYS-08 | Unknown routes return a structured `404 ROUTE_NOT_FOUND`. |

---

## 6. Non-functional requirements

Non-functional requirements must be **measurable** or they are decoration. Each row
below has a target we can actually test, and a phase where we address it.

| ID | Category | Requirement | Target | Phase |
| --- | --- | --- | --- | --- |
| NFR-PERF-01 | Performance | Public job list p95 latency (warm) | < 200 ms | 8 |
| NFR-PERF-02 | Performance | Candidate pipeline board p95 (2 000 applications) | < 400 ms | 8 |
| NFR-PERF-03 | Performance | No list endpoint returns more than 100 records | hard limit enforced in validation | 1 |
| NFR-PERF-04 | Performance | Frontend route transition after first load | < 150 ms (cached) | 9 |
| NFR-PERF-05 | Performance | Support 50 000 candidate profiles in one org without full scans | verified via `explain()` | 8 |
| NFR-SEC-01 | Security | Passwords hashed with argon2id or bcrypt cost ≥ 12 | no plain text anywhere, incl. logs | 2 |
| NFR-SEC-02 | Security | No token in `localStorage`/`sessionStorage` | code review + lint check | 2 |
| NFR-SEC-03 | Security | Refresh token only in httpOnly + Secure + SameSite cookie | verified in response headers | 2 |
| NFR-SEC-04 | Security | Auth responses do not disclose account existence | identical error for unknown-email and bad-password | 2 |
| NFR-SEC-05 | Security | 100% of authorization checks server-side | integration test per protected route | 3+ |
| NFR-SEC-06 | Security | Helmet security headers, explicit CORS allowlist, request body size cap | headers asserted in tests | 1/12 |
| NFR-SEC-07 | Security | Rate limits on auth (5/15 min/IP) and writes (100/min/user) | 429 with `Retry-After` | 12 |
| NFR-SEC-08 | Security | No NoSQL operator injection (body/query objects rejected) | type-check schema validation | 3 |
| NFR-SEC-09 | Security | Resume uploads: PDF magic bytes, ≤ 5 MB, renamed random key, private bucket | tested | 5 |
| NFR-SEC-10 | Security | Secrets only in env; `.env` git-ignored; no defaults for prod | startup validation | 1 |
| NFR-SEC-11 | Security | Audit log records access to PII-bearing reads as well as writes | design review | 3 |
| NFR-REL-01 | Reliability | Restart-safe sessions: tokens survive API restart (refresh in DB) | restart test | 2 |
| NFR-REL-02 | Reliability | DB connection retry with backoff on boot | log + recover | 1 |
| NFR-REL-03 | Reliability | Graceful shutdown: stop accepting, drain in-flight, close DB | SIGTERM handler | 1 |
| NFR-REL-04 | Reliability | MongoDB transactions used where a write must be all-or-nothing | verify session usage | 3/6 |
| NFR-REL-05 | Reliability | Idempotent stage transitions (no double-advance on retry) | unique index + version check | 6 |
| NFR-OBS-01 | Observability | Structured JSON logs with `requestId`, `userId`, `orgId`, `durationMs` | searchable | 1 |
| NFR-OBS-02 | Observability | `/api/health` + `/api/health/ready` for container orchestration | 200/503 | 1 |
| NFR-OBS-03 | Observability | Unhandled errors logged with stack server-side, generic message to client | test | 1 |
| NFR-OBS-04 | Observability | Slow-query logging threshold configured | index review | 8 |
| NFR-MNT-01 | Maintainability | TypeScript `strict: true`, no `any` without documented exception | `npm run typecheck` in CI | 1 |
| NFR-MNT-02 | Maintainability | ESLint + Prettier enforced; CI fails on lint error | pipeline | 1/13 |
| NFR-MNT-03 | Maintainability | Controllers contain no business logic; services contain no HTTP concerns | review checklist | 1+ |
| NFR-MNT-04 | Maintainability | Every module owns its model/service/controller/routes/validation | folder rule | 1 |
| NFR-MNT-05 | Maintainability | No duplicated business rule; the pipeline state machine has exactly one implementation | unit test coverage | 6 |
| NFR-TEST-01 | Testing | Every FR with a security or state-machine flavour has an automated test | coverage report | 12 |
| NFR-TEST-02 | Testing | Business logic (services, state machine) unit tested with no DB | fast suite | 12 |
| NFR-TEST-03 | Testing | API contract + authorization tested with Supertest against a real ephemeral MongoDB | integration suite | 12 |
| NFR-TEST-04 | Testing | Frontend: critical flows + hooks tested with React Testing Library | CI green | 12 |
| NFR-TEST-05 | Testing | Target ≥ 80% line coverage on `server/src/modules/**/services` | CI gate | 12 |
| NFR-DX-01 | DX | `npm run dev` boots both apps with one command (or a documented 2-command equivalent) | new dev < 5 min | 1 |
| NFR-DX-02 | DX | `.env.example` documents every variable with purpose and safe default | readme | 1 |
| NFR-DX-03 | DX | Seed script produces a realistic demo org for screenshots/demo | documented | 4+ |
| NFR-UX-01 | UX | Keyboard-navigable, labelled forms; WCAG 2.1 AA colour contrast | manual + automated axe | 12 |
| NFR-UX-02 | UX | Every destructive action confirmable; every bulk action shows affected count | review | 4/6 |
| NFR-UX-03 | UX | Every list has a loading skeleton, empty state and error state | review | 8 |
| NFR-PERF-06 | Performance | Client bundle: route-level code splitting; initial JS budget < 200 KB gzip | bundle report | 13 |
| NFR-COMP-01 | Compliance | Candidates can request deletion of their data (right-to-delete) | documented + admin action | 12 |
| NFR-COMP-02 | Compliance | Audit retention policy configurable; TTL index for log pruning | config | 12 |
| NFR-SCAL-01 | Scalability | Stateless API instances (no in-process session/tenant state) so horizontal scaling is possible | code review | 2 |
| NFR-SCAL-02 | Scalability | Hot paths use cursor pagination where offset degrades | documented per endpoint | 8 |
| NFR-SCAL-03 | Scalability | Design allows sharding on `organizationId` without code change in the service layer | documented | 8 |

---

## 7. Feature prioritisation

**MoSCoW**, with a phase mapping and a one-line justification. The point of
prioritisation here is not speed — it is to prove that the *order* is reasoned, because
"why did you build X before Y?" is a standard interview question.

| Feature | Pri | Phase | Why this position |
| --- | --- | --- | --- |
| Repo + tooling + health checks | M | 1 | Nothing is verifiable without a runnable app. |
| Auth (register/login/refresh/logout) | M | 2 | Every later feature needs an identity to authorise. |
| Organization + roles + tenant isolation | M | 3 | Without tenancy this is a single-company toy; isolation is the product's core promise. |
| Job CRUD + publish lifecycle | M | 4 | Jobs are the anchor aggregate; applications must hang off something. |
| Candidate profile + resume + apply | M | 5 | First real many-to-many (candidate ↔ job). Proves the schema. |
| Pipeline + stage transitions + audit | M | 6 | The differentiating workflow. Audit is non-optional once state is mutable. |
| Interviews + feedback | M | 7 | Second major workflow; introduces role-scoped resource access (IDOR surface). |
| Search + pagination + indexes | M | 8 | Must precede any data volume. Cheap now, expensive later. |
| Notifications + real-time + email | S | 9 | Value-add, but not required for the core record. |
| Analytics | S | 10 | Requires meaningful data volume and stable stages. |
| AI resume assistant | C | 11 | Pure assistive layer; safe to add once the ATS is trustworthy. |
| Testing & security hardening | M | 12 | Tests are written alongside features; this phase hardens and fills gaps. |
| Docker + CI/CD | M | 13 | Makes the work reproducible and is expected by reviewers. |
| Deployment | M | 14 | Turns the repo into a demo URL. |
| Interview prep | M | 15 | The actual deliverable for your job search. |
| Real queues (BullMQ/Redis) | W→later | 14+ | Only if email volume or long jobs justify a broker. Documented, not built. |
| WebSockets at scale (Redis adapter) | C | 9+ | Single instance does not need it. |
| Custom stages per org | C | 6 design | Architecture must allow it; UI can ship later. |
| Saved searches, CSV export, candidate notes | C | 8+ | Nice-to-have; do not let them distort the core model. |

---

## 8. Success criteria for the project

The project is "done" (portfolio-wise) when:

1. A reviewer can clone the repo and run it in ≤ 5 commands with no manual patching.
2. Every phase's `README`/docs section explains the *why*, and the answer to
   "why did you choose this?" is written down somewhere.
3. The test suite covers all 4 roles' permissions and all pipeline transitions.
4. CI runs lint → typecheck → test → build and is green.
5. It is deployed and reachable at a public URL.
6. **You** can answer, unprompted and out loud, every question in
   `06-concepts-and-interview-questions.md`.

Criterion 6 is the real one. The rest is packaging.
