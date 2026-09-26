# HireFlow — Phase 0: Domain Model & Initial Database Design

> This is the *thinking* document for the database. No Mongoose schema is written in
> Phase 0. Every collection below has a stated **cardinality**, an **ownership rule**,
> a **referencing decision with justification**, and a **concrete index list**.

---

## 1. Entities

| Entity | Purpose | Owned by tenant? | Grows without bound? |
| --- | --- | --- | --- |
| `User` | Global login identity (auth principal) | No (global) | Slowly |
| `Organization` | A company / hiring workspace | Itself | No |
| `OrganizationMember` | Links a `User` to an `Organization` with a role | Yes | No |
| `Job` | An open role created by a recruiter | Yes | No |
| `CandidateProfile` | A person in a tenant's talent pool | Yes | Yes |
| `Application` | (Candidate × Job) — the pipeline aggregate | Yes | **Yes** |
| `Interview` | A scheduled conversation for an application | Yes | Slowly |
| `InterviewFeedback` | One reviewer's structured assessment of one interview | Yes | No |
| `Notification` | Per-user in-app message | Yes (via user) | **Yes** |
| `AuditLog` | Append-only record of consequential actions | Yes | **Yes** |

Deferred (documented, not created now): `JobStage`, `Resume`, `Email`, `SavedSearch`,
`CandidateNote`, `JobApplicationQuestion`, `ApplicationStageEvent`, `PasswordResetToken`.

### 1.1 Why `User` ≠ `CandidateProfile`

This is the single most commonly botched decision in a portfolio ATS, so here is the reasoning.

- A `User` answers *"who is logged in?"* It owns credentials, a password hash, token
  records. It is a **security principal**.
- A `CandidateProfile` answers *"who is this person in our talent pool, and what do we
  know about them?"* It owns a headline, skills, links, a resume. It is **business data**.

They are separated because their lifecycles, owners and privacy rules differ:

| Concern | `User` | `CandidateProfile` |
| --- | --- | --- |
| Deleted on account closure | Yes | No (business record must survive) |
| Contains PII visible to other tenants | Never | Never (tenant-scoped) |
| Queried by login email | Yes | No |
| Written by the system on every request | Session context | Rarely |
| Retention/legal hold | Account lifetime | Per org policy |

**Sub-case that forces the split:** a recruiter imports a candidate from a LinkedIn URL.
That person has never registered and has no `User`. They still need to exist as a
`CandidateProfile` so they can receive an application and be moved through a pipeline.
`CandidateProfile.email` therefore exists independently of `User`, and
`CandidateProfile.userId` is **optional**.

```ts
userId?: Types.ObjectId | null   // present once the person registers/claims the profile
email: string                    // always present, normalised
```

### 1.2 Why role lives on `OrganizationMember` and not on `User`

Consider: a person who is an `ADMIN` at company A and a `CANDIDATE` at company B. This
is not exotic — a founder of one company applying for a job at another, or a
contractor-turned-employee. A single `User.role: Role` field cannot represent it.

```
WRONG:  User { role: 'ADMIN' }                        // global role → cross-tenant privilege
RIGHT:  OrganizationMember { org: A, user: X, role: 'ADMIN' }
        OrganizationMember { org: B, user: Y, role: 'INTERVIEWER' }
```

Consequences of the right model:
- The authorization subject is a **triple**: `(userId, organizationId, role)`.
- The `organizationId` in that triple comes from *the request context*, resolved from
  the active membership — never from a client-supplied header. (A client-supplied
  `X-Org-Id` header would let a member of org A simply claim to be in org B. This is a
  real vulnerability class; see `05-decisions-and-tradeoffs.md` §7.)

### 1.3 Roles and how candidate access is decided

| Role | Where stored | Meaning |
| --- | --- | --- |
| `ADMIN` | `OrganizationMember.role` | Full control of the tenant |
| `RECRUITER` | `OrganizationMember.role` | Runs the pipeline for the tenant |
| `INTERVIEWER` | `OrganizationMember.role` | Sees only assigned interviews + their candidates |
| `CANDIDATE` | **not** an org membership | A `User` who owns `CandidateProfile`s |

Candidate permissions are therefore decided by **ownership**, not by a role comparison:

```
"may this actor read application X?"
  → actor is RECRUITER/ADMIN in X.organizationId            ⇒ yes (role check)
  → or actor owns X.candidateProfile.userId                 ⇒ yes (ownership check)
  → otherwise                                               ⇒ no
```

**Teaching point — RBAC vs ABAC.** Recruiter capabilities are *role*-based (the same for
every recruiter in every org). Candidate capabilities are *relationship*-based (the same
candidate is privileged over their own record and nobody else's). Production systems mix
both. Calling it "RBAC" and then writing `if (req.user.role === 'RECRUITER')` everywhere
is the beginner mistake; the correct shape is a **permission map** (`role → permissions`)
plus a small number of explicit ownership guards. See `03-system-architecture.md` §5.

---

## 2. Relationships

```
erDiagram
    USER ||--o{ ORGANIZATION_MEMBER : "holds membership"
    ORGANIZATION ||--o{ ORGANIZATION_MEMBER : "has staff"
    ORGANIZATION ||--o{ JOB : "owns"
    ORGANIZATION ||--o{ CANDIDATE_PROFILE : "scopes talent pool"
    USER ||--o{ CANDIDATE_PROFILE : "may claim"
    JOB ||--o{ APPLICATION : "receives"
    CANDIDATE_PROFILE ||--o{ APPLICATION : "submits"
    APPLICATION ||--o{ INTERVIEW : "schedules"
    INTERVIEW ||--o{ INTERVIEW_FEEDBACK : "receives"
    USER ||--o{ INTERVIEW_FEEDBACK : "authors"
    USER ||--o{ NOTIFICATION : "receives"
    USER ||--o{ AUDIT_LOG : "acts"
    ORGANIZATION ||--o{ AUDIT_LOG : "records"
    INTERVIEW }o--o{ USER : "assigned interviewers (many-to-many, array of refs)"
```

Cardinality notes that matter:

- `USER 1—* ORGANIZATION_MEMBER`: a user may belong to several orgs (multi-tenancy by membership).
- `JOB 1—* APPLICATION` and `CANDIDATE_PROFILE 1—* APPLICATION`: the many-to-many **is**
  the `Application` entity. This is the answer to "a Candidate is different from an
  Application" — Rahul Sharma has three applications, one per job, each with its own
  stage, its own interviews, its own feedback. Collapsing them would make it impossible
  to say "Rohit was rejected for *this* job but is in final rounds for *that* job."
- `INTERVIEW *—* USER` (interviewers): modelled as an **array of ObjectId refs** on
  `Interview`, not a join collection. Justification in §4.3.
- `USER 1—* NOTIFICATION`: a notification belongs to exactly one recipient.

---

## 3. Field-level design

Legend: `*` required · `o` optional · `[]` array · `()` default.

### 3.1 `users`

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `email` | string, lowercase, trimmed, **unique** | the natural key for login; never returned for other users |
| `passwordHash` | string | argon2id/bcrypt; `select: false` so it cannot leak into an accidental `.find()` |
| `firstName` * / `lastName` * | string | |
| `avatarUrl` | string? | |
| `emailVerified` | bool (false) | |
| `status` | `ACTIVE` \| `SUSPENDED` | suspension is a moderation/audit lever, distinct from deletion |
| `lastLoginAt` | Date? | |
| `tokenVersion` | number (0) | bump to invalidate **all** of a user's tokens at once |
| `createdAt` / `updatedAt` | Date | |

Indexes: `{ email: 1 }` unique. (`{ email: 1 }` non-unique would let duplicate accounts
exist — the application-level check is not enough; see §6 on races.)

### 3.2 `organizations`

| Field | Type | Notes |
| --- | --- | --- |
| `name` * | string | displayed |
| `slug` * | string, unique, lowercase | URL-safe public identity: `/org/acme/jobs` |
| `logoUrl` | string? | |
| `settings` | embedded object | `timezone`, `defaultEmploymentType`, `pipelineVersion` |
| `plan` | `FREE` \| `PRO` | placeholder for a real billing boundary |
| `createdBy` | ref User | first ADMIN, for audit |
| `createdAt`/`updatedAt` | Date | |

`settings` is **embedded** because it is small, bounded, and always needed with the org
(read it or you cannot render the page). Embedding avoids a second query per request.

Indexes: `{ slug: 1 }` unique; `{ createdBy: 1 }`.

### 3.3 `organizationmembers`

| Field | Type | Notes |
| --- | --- | --- |
| `organizationId` * | ref Organization | index |
| `userId` * | ref User | index |
| `role` * | `ADMIN` \| `RECRUITER` \| `INTERVIEWER` | tenant-scoped |
| `status` * | `INVITED` \| `ACTIVE` \| `SUSPENDED` | |
| `invitedBy` | ref User? | |
| `invitedAt` / `joinedAt` | Date? | `joinedAt` set on first accepted login |
| `inviteTokenHash` | string? | `select: false`; single-use, TTL by timestamp |

Indexes:
- `{ organizationId: 1, userId: 1 }` **unique** ← one membership per user per org. This
  index is also the lookup path for every authenticated tenant request, so it is a
  *read* index as much as a *uniqueness* constraint.
- `{ userId: 1, status: 1 }` ← "list my organizations" on app boot.
- `{ organizationId: 1, role: 1, status: 1 }` ← admin member list + "who can interview".

### 3.4 `jobs`

| Field | Type | Notes |
| --- | --- | --- |
| `organizationId` * | ref Organization | |
| `title` * | string | |
| `slug` * | string | per org: `{ organizationId, slug }` unique |
| `description` * | string | rich text / markdown |
| `responsibilities` / `requirements` | [string] | structured so Phase 11 can compare against a resume |
| `skills` * | [string] (lowercased) | indexable; drives matching |
| `location` | `{ city, country, remote, type }` | `remote` + `type` are the filters candidates actually use |
| `employmentType` * | `FULL_TIME`\|`PART_TIME`\|`CONTRACT`\|`INTERNSHIP` | |
| `experienceLevel` | `ENTRY`\|`MID`\|`SENIOR`\|`LEAD` | |
| `salary` | `{ min, max, currency, period }`? | sensitive → recruiters only, never in public DTO |
| `status` * | `DRAFT`\|`PUBLISHED`\|`CLOSED`\|`ARCHIVED` (DRAFT) | separate from "isVisible" |
| `publishedAt` / `closedAt` | Date? | |
| `createdBy` * | ref User | |
| `applicantCount` | number (0) | denormalised counter — see §7 |

Indexes:
- `{ organizationId: 1, status: 1, createdAt: -1 }` — the recruiter job list (the hot query).
- `{ organizationId: 1, slug: 1 }` unique.
- `{ status: 1, publishedAt: -1, _id: 1 }` — the public board (cross-tenant, so
  `organizationId` is *not* leading here). Sort field after equality fields — see §5.
- `{ skills: 1 }` (multikey) and later a **text index** on `title`/`description` for `q`.
- `{ createdBy: 1 }`.

**Field-order lesson.** `{ status: 1, publishedAt: -1, _id: 1 }` not
`{ publishedAt: -1, status: 1 }`. MongoDB can use an index for a range/sort only *after*
the leading equality predicates. Put equality first, then the sort key, then anything
range-filtered. Putting `publishedAt` first makes the index useless for
`status = PUBLISHED ORDER BY publishedAt DESC`.

### 3.5 `candidateprofiles`

| Field | Type | Notes |
| --- | --- | --- |
| `organizationId` * | ref Organization | tenant scope — PII isolation boundary |
| `userId` | ref User? (`null` for imported leads) | |
| `email` * | string, lowercased | |
| `firstName` * / `lastName` * | string | |
| `phone` | string? | |
| `headline` | string? | e.g. "Frontend Engineer · React · 4 yrs" |
| `summary` | string? | |
| `location` | `{ city, country }` | |
| `links` | `{ github?, linkedin?, portfolio? }` | |
| `skills` | [string] | |
| `totalExperienceYears` | number (0) | |
| `currentCompany` / `currentTitle` | string? | |
| `resume` | embedded `ResumeRef` `{ storageKey, fileName, mimeType, sizeBytes, uploadedAt, version }` | see below |
| `source` | `DIRECT`\|`IMPORT`\|`REFERRAL` (DIRECT) | where the candidate came from |
| `tags` | [string] | recruiter-applied labels |
| `lastActivityAt` | Date | powers "active recently" filter |
| `createdAt`/`updatedAt` | Date | |

**Resume: embed a reference, not the file.** The file lives in S3-compatible object
storage; MongoDB stores only the metadata needed to fetch it and to prove *which*
version was attached to a given application. The metadata is small, bounded and always
read with the profile → embed it. The bytes stay outside the database → they scale
independently and never bloat a document or slow down a `find()`.

**Why tenant-scoped `CandidateProfile` rather than one global candidate table?** Real
systems (Greenhouse, Lever, Workable) keep candidate records per-company. Reasons:
1. **Legal isolation.** Two customers of an ATS generally have a contractual duty not to
   pool candidate PII. A shared global candidate table leaks across that boundary.
2. **Retention conflict.** Company A may be required to delete a candidate; a global row
   would delete it for company B too.
3. **Different data.** Company A stores salary expectations; company B stores notice period.

The cost is deduplication: the same human is N rows. That is the correct trade-off —
we optimise for *isolation*, not storage. Store the *same email* in both tenants and let
`userId` linking optionally unify the login later. This is a real trade-off and one of
the questions in `06-concepts-and-interview-questions.md`.

Indexes:
- `{ organizationId: 1, email: 1 }` unique — no duplicate candidate per tenant.
- `{ organizationId: 1, 'skills': 1 }` — skill filter.
- `{ organizationId: 1, 'location.city': 1 }` — location filter.
- `{ organizationId: 1, lastActivityAt: -1 }` — default sort.
- Text index `{ title: 'text', headline: 'text', summary: 'text' }`-equivalent on the
  name/headline/summary fields for Phase 8 `q` search. (Note: only one text index per
  collection in MongoDB — decide which fields matter, do not create four.)

### 3.6 `applications` — the pipeline aggregate root

| Field | Type | Notes |
| --- | --- | --- |
| `organizationId` * | ref Organization | denormalised from job; every read filters on it |
| `jobId` * | ref Job | |
| `candidateId` * | ref CandidateProfile | |
| `candidateUserId` | ref User | denormalised for the "my applications" query |
| `status` * | `APPLIED`\|`SCREENING`\|`SHORTLISTED`\|`INTERVIEW`\|`OFFER`\|`HIRED`\|`REJECTED` (APPLIED) | **derived from `stageId` in v2** |
| `stageEnteredAt` * | Date | powers "time in stage" analytics |
| `rejectionReason` | string? \| enum? | required to move to `REJECTED` |
| `withdrawnAt` | Date? | a **flag**, not a stage (see below) |
| `snapshot` | embedded `{ jobTitle, employmentType, location, resumeStorageKey, resumeFileName, appliedResumeVersion }` | history preservation |
| `history` | [embedded `StageEvent`] | `{ from, to, actorId, actorRole, reason, at, note? }` |
| `rating` | number? (1–5) | recruiter's own summary judgement, nullable |
| `source` | enum | reuse candidate source |
| `appliedAt` | Date | immutable; equals `createdAt` but named for clarity |
| `createdAt`/`updatedAt` | Date | |

**Snapshot — the most important row in this table.** At apply-time we copy the job title
and the attached resume key into the application. Consequence: if the recruiter later
renames the job to "Senior Frontend Engineer" or the candidate uploads resume v3, the
record of *what was applied for, and with which document* does not silently change.
Auditability of a hiring decision depends on it. This is a general principle:
**a decision record must be immutable evidence, not a live view of mutable data.**

**`withdrawnAt` is a flag, not a stage.** A candidate withdrawing is a different event
from a recruiter rejecting. Modelling it as a stage would force you to answer "can a
withdrawn application be reinstated, and who may reinstate it?" Modelling it as a flag
with a defined UI/status mapping keeps the pipeline clean.

**Why `history` is embedded and unbounded-looking is still OK here.** The bound is
*one entry per stage change*, and a single application realistically changes stage fewer
than 20 times. 20 small sub-documents ≈ 4 KB, far below the 16 MB document limit. The
alternative — a separate `applicationstageevents` collection — is *also* valid and is
what a system with a high event rate or a need to query "all events across all
applications by actor" would choose. **The rule:** embed when the child is read only
with its parent and never queried independently; reference when you need to query the
child on its own. Stage events are read with the application, so embed. Audit logs are
queried independently, so they are their own collection (§3.10).

Indexes:
- `{ organizationId: 1, jobId: 1, candidateId: 1 }` **unique** — the *database* enforces
  "one application per candidate per job" even under a race (§6).
- `{ organizationId: 1, status: 1, updatedAt: -1 }` — **the pipeline board query**: one
  group per stage, most recently touched first. This is the single most important index
  in the product.
- `{ candidateUserId: 1, createdAt: -1 }` — "my applications" (candidate view).
- `{ jobId: 1, status: 1 }` — per-job funnel count.
- `{ organizationId: 1, createdAt: -1 }` — applications-over-time analytics.

### 3.7 `interviews`

| Field | Type | Notes |
| --- | --- | --- |
| `organizationId` * | ref Organization | |
| `applicationId` * | ref Application | |
| `jobId` | ref Job | denormalised to avoid a join for "my interviews by job" |
| `candidateId` | ref CandidateProfile | denormalised for the same reason |
| `round` | number (1) | 1st, 2nd, 3rd… enables "round 2 of 3" UI |
| `type` * | `PHONE_SCREEN`\|`TECHNICAL`\|`HR`\|`FINAL`\|`PANEL` | |
| `title` * | string | e.g. "System design" |
| `status` * | `SCHEDULED`\|`COMPLETED`\|`CANCELLED`\|`NO_SHOW` (SCHEDULED) | |
| `startsAt` * | Date (**UTC**) | |
| `endsAt` * | Date | **server-derived** = startsAt + durationMins |
| `durationMins` * | number (60) | |
| `timezone` | string | IANA, e.g. `Asia/Kolkata`; snapshot at scheduling |
| `interviewerIds` * | [ref User] | org members with INTERVIEWER/RECRUITER role |
| `meetingUrl` | string? | external (Zoom/Meet), or generated link |
| `meetingProvider` | enum? | for future calendar integration |
| `instructions` | string? | visible to candidate |
| `rescheduleCount` | number (0) | a scheduling-friction metric recruiters genuinely use |
| `cancelledReason` | string? | |
| `feedbackLockedAt` | Date? | after this, feedback is read-only |
| `createdBy` * | ref User | |
| `createdAt`/`updatedAt` | Date | |

**Time handling is a classic bug source.** Store UTC instants only. Never store
"3:00 PM". The org's `settings.timezone` is a *rendering* concern applied in the
response/UI. "Interview at 09:00 IST" is ambiguous the day DST shifts; "2026-03-29T03:30:00Z"
plus `Asia/Kolkata` is not. And **the client must not be trusted to compute `endsAt`** —
`durationMins` is validated, `endsAt` is derived server-side, so nobody can schedule a
100-hour interview.

Indexes:
- `{ organizationId: 1, startsAt: 1 }` — org calendar.
- `{ interviewerIds: 1, startsAt: 1 }` (multikey) — "my assigned interviews". Multikey
  compound indexes work here because only *one* array field is present; a compound index
  with **two** array fields cannot be created. (Good interview detail.)
- `{ applicationId: 1 }` — all interviews for one application.
- `{ candidateId: 1 }` — candidate's interview list.

### 3.8 `interviewfeedbacks`

| Field | Type | Notes |
| --- | --- | --- |
| `organizationId` * | ref Organization | |
| `interviewId` * | ref Interview | |
| `applicationId` | ref Application | denormalised for "all feedback for a candidate" |
| `interviewerId` * | ref User | author |
| `ratings` | embedded `{ technical, problemSolving, communication, roleCriteria }` each 1–5 | separate axes beat one number |
| `recommendation` * | `STRONG_YES`\|`YES`\|`NO`\|`STRONG_NO` | |
| `strengths` | string | |
| `risks` / `concerns` | string | |
| `notes` | string | private to the org's staff |
| `submittedAt` | Date | |
| `updatedAt` | Date | |

**Separate collection, deliberately.** Three arguments:
1. **Independent query**: "all feedback across applications for this job" — impossible
   to do efficiently if nested in `Interview`.
2. **Write pattern**: many interviewers write concurrently for *different* interviews;
   separating them keeps document rewrite pressure off the `Interview` doc, which is
   also being read and rescheduled.
3. **Growth/lock**: feedback grows independently of interviews and is the data with the
   longest retention requirement.

Counter-argument you should be able to state: feedback is 1:1-ish with interview, small,
and almost always read with the interview — so embedding is defensible for a smaller
system. We chose the collection because org-level feedback search (a real recruiter
need: "show me every strong-no for React roles this quarter") is a first-class query here.

Index: `{ interviewId: 1, interviewerId: 1 }` **unique** — one submission per interviewer
per interview, enforced by the database. Plus `{ organizationId: 1, applicationId: 1 }`.

### 3.9 `notifications`

| Field | Type | Notes |
| --- | --- | --- |
| `userId` * | ref User | the single recipient |
| `organizationId` | ref Organization? | for grouping/filtering; may be null (system) |
| `type` * | enum, e.g. `APPLICATION_RECEIVED`, `STAGE_CHANGED`, `INTERVIEW_SCHEDULED` | the template + deep-link is chosen from `type` |
| `title` * / `body` * | string | rendered text stored so history stays readable if the template changes |
| `data` | object | `{ applicationId, interviewId, jobId, from, to }` for deep links |
| `readAt` | Date? | null = unread |
| `channel` | `IN_APP`\|`EMAIL`\|`BOTH` | |
| `emailStatus` | enum? | `PENDING`\|`SENT`\|`FAILED` — see Phase 9 |
| `createdAt` | Date | |

Indexes:
- `{ userId: 1, readAt: 1, createdAt: -1 }` — the notification bell query, perfectly
  ordered for "unread first, newest first".
- TTL index `{ createdAt: 1 }` with `expireAfterSeconds: 90 days` — auto-pruning. A
  bounded collection you never have to clean up by hand.

### 3.10 `auditlogs`

| Field | Type | Notes |
| --- | --- | --- |
| `organizationId` * | ref Organization | |
| `actorId` | ref User? | null for system actions (scheduled jobs, migrations) |
| `actorRole` | string? | role **at the time of the action** — roles change; audit must not lie |
| `actorName` | string | denormalised so the record survives account deletion |
| `action` * | enum: `JOB_CREATED`, `JOB_PUBLISHED`, `APPLICATION_STAGE_CHANGED`, `MEMBER_REMOVED`, `CANDIDATE_PROFILE_VIEWED`, `RESUME_DOWNLOADED`, … | the audit *vocabulary* |
| `resourceType` * | enum: `Job`, `Application`, `CandidateProfile`, `OrganizationMember`, `Interview`, … | |
| `resourceId` | string? | store as string, not ObjectId, so it can also hold a non-Mongo id |
| `before` / `after` | object? | **diff**, not full documents — a full doc snapshot per change would be huge and mostly noise |
| `metadata` | object? | e.g. `{ from: 'SCREENING', to: 'INTERVIEW', reason: '...' }` |
| `ip` | string? | |
| `userAgent` | string? | |
| `requestId` | string? | ties the audit row to the log lines for that request |
| `createdAt` * | Date | |

**Why audit logs are append-only and separate:**
- They are queried *across* resources ("everything Rahul did in July"), which is
  incompatible with embedding anywhere.
- They must not be mutable — deleting or editing one destroys their evidentiary value.
  There is no update API, and the DB user in production should lack update permission.
- They are the highest-volume, lowest-value-per-byte collection → TTL prune by policy.

Indexes: `{ organizationId: 1, createdAt: -1 }`, `{ actorId: 1, createdAt: -1 }`,
`{ resourceType: 1, resourceId: 1, createdAt: -1 }`, plus a TTL index if retention is
time-based.

---

## 4. Embedding vs referencing — the decision framework

Ask these four questions in order.

1. **Is the child read only with its parent, never alone?** → embed.
2. **Is the child bounded and small?** (embed, and it must stay under the 16 MB doc limit
   with a margin) → embed.
3. **Does the child need its own indexes for independent queries?** → reference.
4. **Can the parent be updated far more often than the child?** → separate collection
   (avoids rewriting a large parent doc on every child write).

Applied to HireFlow:

| Relationship | Decision | Justification (one line) |
| --- | --- | --- |
| `Organization.settings` | **embed** | tiny, unbounded-free, always read with org |
| `CandidateProfile.resume` metadata | **embed** | small + always read with the profile; the bytes live in object storage |
| `Application.snapshot` | **embed** | immutable evidence, read with the application |
| `Application.history[]` | **embed** | ~<20 tiny sub-docs, never queried alone |
| `OrganizationMember` | **reference** | needs its own indexes; a user has many orgs |
| `Job → Organization` | **reference** | 1—many; orgs have thousands of jobs |
| `Application → Job / CandidateProfile` | **reference** | both parents are queried/sorted independently; no duplication |
| `Application → Interview` | **reference** | one application has several interviews over time; they are listed by interviewer and date |
| `Interview → interviewerIds` | **reference array** | many-to-many that is always read as a whole; a join collection would be overkill (documented revisit point) |
| `Interview → InterviewFeedback` | **reference (own collection)** | independent org-wide feedback queries + concurrent writers (§3.8) |
| `Notification`, `AuditLog` | **own collections** | queried independently, unbounded, high write volume |

### 4.1 Denormalisation we chose *on purpose*

`Application.organizationId`, `Interview.jobId`, `Interview.candidateId`,
`Notification.title/body` are duplicated from elsewhere. This is deliberate:

- A tenant filter on *every* query is a security requirement, not an optimisation. Having
  `organizationId` locally means the scope check cannot be "forgotten" by forgetting a
  `.populate()`. **Security-driven denormalisation.**
- Sorting/filtering by `jobId` without a `$lookup` keeps the pipeline board at one query.
- Snapshotting notification text keeps history readable after copy changes.

The cost: a rename must be written to several places. Mitigation: renames happen through
one service method; **denormalised copies are never updated retroactively for records that
must stay historically accurate** (`snapshot`, `actorName`, `title`).

---

## 5. Index strategy

### 5.1 The rules

1. **Every** field you filter, sort or join on gets an index — after measuring.
2. Compound index field order = `equality` → `sort` → `range`.
3. Never index a field you never query; write amplification is not free.
4. One field per array in a compound index (multikey limitation).
5. Only one text index per collection — choose fields deliberately.
6. A unique index is a **business rule** first and a performance tool second.
7. Verify with `explain("executionStats")`, not by intuition.

### 5.2 The compound index order, worked through

Query: public job board, filtered by status, sorted by newest.

```js
db.jobs.find({ status: "PUBLISHED" }).sort({ publishedAt: -1 }).skip(0).limit(20)
```

- `{ status: 1 }` → narrows to published only. **Equality first.**
- `{ publishedAt: -1 }` → satisfies the sort without an in-memory sort stage.
- `{ _id: 1 }` → tiebreaker so pagination is stable and cursor pagination works
  (`publishedAt` alone can repeat within the same millisecond).

Result: `{ status: 1, publishedAt: -1, _id: 1 }`.
Reversing to `{ publishedAt: -1, status: 1 }` would force a scan of the newest N jobs
and filter — fine with 10 jobs, pathological with 100 000.

### 5.3 Pagination: offset vs cursor

| | Offset (`?page=3&limit=20`) | Cursor (`?cursor=<base64>`) |
| --- | --- | --- |
| Implementation | `skip((page-1)*limit).limit(limit)` | filter on `(sortField, _id) > cursor` + `limit(limit+1)` |
| Cost at deep pages | O(offset) — page 5000 reads and discards 100 000 docs | O(limit) |
| Consistency under inserts | duplicates/skipping when rows are inserted mid-scroll | stable |
| Jump to page N | trivial | not possible without scanning |
| Use for | admin tables, org settings (bounded, low churn) | pipeline board, notifications, audit log, candidate search (high churn) |

**Decision:** expose `?limit&cursor` for the high-churn reads, and *also* accept
`?page` for bounded admin lists, implemented on top of the same service. Note that even
offset pagination should be hard-capped (`max page × limit ≤ 500`) so a hostile
`?page=100000` cannot be used to burn server CPU.

### 5.4 The N+1 problem, and the rule that prevents it

The naive recruiter pipeline board:

```js
const applications = await Application.find({ organizationId }).limit(50);   // 1 query
for (const app of applications) {
  await app.populate("candidateId");       // 50 more queries
  await app.populate("jobId");             // 50 more queries
}
```
101 queries for one screen. On a 200 ms budget with 500 candidates, this is the single
most common performance failure in Mongo apps.

Rule: **batch-populate.**
```js
const apps = await Application.find({ organizationId }).limit(50);
const candidateIds = [...new Set(apps.map(a => a.candidateId))];
const candidates = await CandidateProfile.find({ _id: { $in: candidateIds } })
  .select("firstName lastName headline skills");
```
Two queries, constant. Or aggregate with a single `$lookup`. We will add a lint/code-review
rule against `await` inside a `for` loop over query results.

---

## 6. Concurrency & integrity: rules the application must not rely on itself for

**Problem.** Two recruiters click "Apply"/"Move to Interview" at the same time, or a
candidate double-clicks "Apply". Application code that says
`if (!exists) create()` is not atomic — both requests can pass the check.

**Rule 1 — enforce invariants in the database.**
`{ organizationId: 1, jobId: 1, candidateId: 1 }` unique on `applications` means the
second insert fails with `E11000`, which we translate to `409 APPLICATION_EXISTS`. The
application check remains, but only as a *fast, friendly* path. The database is the truth.

**Rule 2 — use a transaction when a write spans documents.**
Creating an application must write: the `Application`, increment `Job.applicantCount`, and
an `AuditLog` row. If the process dies after the first write, the system is inconsistent.
MongoDB multi-document transactions (replica set required) give all-or-nothing:

```ts
const session = await mongoose.startSession();
await session.withTransaction(async () => {
  await Application.create([payload], { session });
  await Job.updateOne({ _id: jobId }, { $inc: { applicantCount: 1 } }, { session });
  await AuditLog.create([entry], { session });
});
```

**Rule 3 — optimistic concurrency for state transitions.**
Moves carry a `version`/expected current `status`. A stale client (two tabs open) gets
`409 CONFLICT` instead of silently overwriting. This is the cheap alternative to row-level
locking, and it is what most web applications actually need.

**Rule 4 — `updateOne` with a filter, never read-then-write.**
```ts
// RACE:  read status, check, then write
const app = await Application.findById(id);
if (canTransition(app.status, next)) await Application.updateOne({ _id: id }, { status: next });

// ATOMIC: the check is part of the write
await Application.updateOne(
  { _id: id, status: { $in: allowedFrom } },
  { $set: { status: next, stageEnteredAt: new Date() } }
);
if (result.matchedCount === 0) throw new ConflictError('STAGE_CHANGED_CONCURRENTLY');
```

---

## 7. Scalability concerns, named honestly

| Concern | Phase-0 stance | When it actually bites | Standard fix |
| --- | --- | --- | --- |
| Unbounded `applications` per org | indexed + paginated | 100 k+ applications in one org | shard on `organizationId`, add read replicas |
| Unbounded `notifications` / `auditlogs` | TTL index | always, eventually | TTL + archive to S3; separate collection per year |
| Pipeline board: "all non-terminal applications" | `{ orgId, status, updatedAt }` | very large boards | cap "active" set; virtualise UI; cache per-user board with invalidation |
| Text search quality | Mongo text index is basic | recruiter expects relevance ranking | Atlas Search / OpenSearch / Elasticsearch |
| Denormalised counters drift | transactions keep them correct | high write contention on one job doc | move to aggregation pipeline at read time |
| `interviewerIds` array growth | fine for < 10 interviewers | panel interviews with 30 people | join collection |
| Cross-tenant queries (public job board) | single index over all orgs | millions of jobs | read replica + cache (Phase 9/14) |
| Single Mongo instance | fine for a portfolio demo | real HA | replica set, then Atlas |

**The honest answer for an interview:** at HireFlow's target scale (≈50 k candidates,
≈200 k applications across all tenants, low write rate) a single well-indexed MongoDB
replica set handles it comfortably. The design keeps `organizationId` on every document
precisely so that sharding on it later is a *configuration* change, not a rewrite. Being
able to state *which* problems you do **not** yet have, and why, is worth more than
claiming scale you cannot demonstrate.

---

## 8. Data retention & deletion

| Data | Policy | Mechanism |
| --- | --- | --- |
| `notifications` | 90 days | TTL index |
| `auditlogs` | 12 months (configurable) | TTL index |
| `users` (dormant, never logged in) | soft-delete then purge after 30 days | `status` + scheduled job |
| `candidateprofiles` | per-org; deleted on candidate request | admin action + cascading delete of applications |
| `resumes` (objects) | deleted with the profile | storage lifecycle policy |
| `interviewfeedbacks` | retained 12 months post-hire for compliance | policy, not TTL by default |

Cascade rule: deleting a `CandidateProfile` must also delete its `Application`s (and thus
their interviews, feedback, and stage history), and its resume object. Cascades are not
automatic in MongoDB — they must be executed explicitly in a service, and that is exactly
where a transaction earns its keep (NFR-COMP-01, NFR-REL-04).

---

## 9. Schema-change strategy (forward-looking, cheap now)

- Mongoose `timestamps` on every collection.
- **Never** mutate a field's type or meaning in place. Add the new field, backfill, dual
  write, migrate reads, drop the old field in a later release.
- Additive-only changes mean a rolling deploy is safe: old instances ignore new fields.
- Reserved words / renames: introduce `fieldV2`, deprecate, remove. Document deprecations.
- Record every migration in `server/src/migrations/` with an up function and a tested down
  function, even if the first three are hand-run. Interviewers ask about this.

---

## 10. Phase 0 deliverable checklist for the domain model

- [x] Entities defined with a one-line purpose each
- [x] `User` vs `CandidateProfile` split justified
- [x] `Candidate` vs `Application` split shown with the "3 applications" example
- [x] Role modelled per-organization, not globally, with the reason
- [x] Relationship diagram + cardinality
- [x] Field-level design for all 10 entities
- [x] Embedding vs referencing framework applied and justified
- [x] Index list with compound-order reasoning
- [x] Pagination strategy (offset vs cursor) and where each is used
- [x] N+1 rule and batch-populate pattern
- [x] Concurrency rules (unique index, transactions, optimistic concurrency, atomic filters)
- [x] Scalability concerns with honest thresholds
- [x] Retention/deletion policy
- [x] Schema-change strategy

**No Mongoose schema is written in Phase 0.** That is Phase 1 (connection + health) and
Phases 2–7 (one collection per feature, with tests written alongside).
