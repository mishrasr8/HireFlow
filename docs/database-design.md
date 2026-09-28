# Hireflow --- Database Design (Phase 3)

This document is the design for the MongoDB/Mongoose data model required by the
**current** requirements in `docs/product-requirements.md`, including decisions
`D-013`---`D-016` made after Phase 1. It is the source of truth for the schemas
in `apps/api/src/models/`, from the design intent down to the index strategy.

It describes the design **before** implementation worked most of it out, and
the implementation that now exists. Everything below was verified by tests
(`apps/api/src/models/models.test.ts`) and, where a property can only be proven
by MongoDB itself (index creation, uniqueness under concurrency, TTL),
verified manually against a real instance and reported as such.

What this phase deliberately does **not** provide: authentication,
authorization, invitation, job, application or résumé workflows, and no
Cloudinary integration. Those are later phases; the schema is their
foundation, not their replacement.

---

## 1. Design principles

1. **The requirements document is the authority.** Every collection, field,
   index and constraint below maps to a named requirement, decision or design
   constraint (`FR`, `D`, `DC`, `NFR`). If a rule appears in this document but
   not in the requirements, it is either a _persistence encoding_ of an
   existing rule (e.g. the `active` boolean that expresses `FR-057` as a
   partial index) or it is explicitly called out as an open/deferred item.

2. **Capability is not membership (`DC-012`).** The User holds a set of
   capabilities. Company access is granted by `CompanyMembership` and by
   nothing else. No schema anywhere stores `user.role`, and no recruiter-scoped
   query is reducible to a capability check.

3. **MongoDB enforces what MongoDB can prove; the service owns the rest.**
   Uniqueness, conditional single-use updates and TTL deletion are database
   properties. Transition legality, authorization, expiry interpretation and
   immutable-history discipline are service-layer concerns that the schema
   supports (enums, chain validators, documented write paths) but cannot own.
   See section 7 for the full split.

4. **Denormalize only where an index or a durability semantic demands it.**
   Two deliberate denormalizations exist: `Application.companyId` (so company
   scoping is inside every query, `DC-005`) and `Application.active` (so
   `FR-057` can be a partial unique index). Everything else is normalized by
   reference.

5. **Embedding is a decision, not a default.** A subdocument is embedded only
   when it is never queried independently and always read with its parent
   (status history, résumé reference, invitation settings). Status history is
   embedded because it is _bounded at 6 entries_ by the state machine (10.6.1)
   and must be atomic with the status change (`NFR-R-003`).

6. **No numeric bounds are invented.** `FR-098`/§13.3 leave the invitation
   expiry and pending-limit bounds to Phase 1 validation. The schema checks
   _shape_ (positive integer) and requires the values; it does not guess a
   product policy. Same for résumé size (`OQ-007`), salary policy (`OQ-008`)
   and the job status set (`OQ-009`).

7. **Closed sets are schema enums.** Statuses and capabilities are enum-valued
   (`DC-003`); arbitrary strings are rejected by the schema, not only by the
   service.

8. **TypeScript types are documentation, never enforcement (`NFR-M-009`).**
   The Mongoose interfaces describe shape; the schema validators and MongoDB
   constraints are what actually run.

---

## 2. Entity / relationship overview

```text
                        ┌────────────────────────────┐
                        │           User             │
                        │  email (unique, lowercase)│       holds capabilities: [CANDIDATE | RECRUITER]
                        │  passwordHash, name        │       (D-001, D-013) -- no role field anywhere
                        └──────────┬─────────────────┘
                                   │
             1:0..1                │ 1:N                1:N
  ┌────────────────┐               │          ┌────────────────────┐
  │ CandidateProfile│              │          │      Session        │
  │  userId (unique)│              └─────────▶│  tokenHash (unique) │
  │  experience[]   │                        │  expiresAt (TTL)    │
  │  education[]    │                        └─────────────────────┘
  │  resume (embed) │
  └───────┬─────────┘
          │ fingerprint of
          │ (duplicated on purpose: FR-056)
          ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                         Application                              │
  │  candidateUserId · jobId · companyId (denormalized, FR-068)      │
  │  status (enum) · active (denormalized for FR-057 partial index)  │
  │  resumeSnapshot (embedded, = profile resume shape)                │
  │  statusHistory [embed, cap 6] -- atomic with every status change  │
  └──────────────────────────────────────────────────────────────────┘
                                  ┌──────────────────────────────┐
                                  │            Job               │
                                  │ companyId · createdByUserId   │
                                  │ status DRAFT|PUBLISHED|CLOSED │
                                  └──────────────────────────────┘
                     ┌─────────────────────────────────────────────┐
                     │           CompanyMembership                  │
                     │  userId (UNIQUE -> exactly one company)      │
                     │  companyId · invitationId (provenance)       │
                     │  NO status field (pending lives on the       │
                     │  invitation; absent = no membership)         │
                     └─────────────────────────────────────────────┘

  Company ──1:N──> CompanyMembership      (this company's members)
  Company ──1:N──> Job                     (owns jobs)
  Company ──1:N──> Invitation              (issued, reviewed, settled)
  Invitation ──N:1── User (invited)        invitedUserId
  Invitation ──N:1── User (inviter)        invitedByUserId
```

Eight collections: `users`, `candidate_profiles`, `companies`,
`company_memberships`, `invitations`, `sessions`, `jobs`, `applications`.

Two concepts from the Phase 3 brief are **deliberately not collections**:

- **ApplicationStatusHistory** is embedded in `Application` (section 8).
- **Resume** is an embedded reference, both on the profile and snapshotted on
  the application (section 4.2, 4.8).

One concept from the old README Phase 3 list is deliberately **not modelled**:
**recruiter profiles** as a separate entity. Recruiting is about the company,
and the requirements give recruiters no professional profile of their own (in
contrast to `FR-016`). The recruiter relationship is `CompanyMembership`; if a
recruiter also has a candidate profile, that is because the account holds the
Candidate capability (`D-013`) and uses the _same_ `CandidateProfile`.

---

## 3. Collection responsibilities

| Collection            | Represents                                                        | Why it exists                                                                                                                         | Owns                                                                                  | Referenced by                                                                                                                                       | Independently queried?                                    | Embedded or separate, and why                                                                     |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `users`               | The account: one row per human.                                   | Identity + authentication + capabilities. Read on every authenticated request, so it stays small.                                     | email, passwordHash, name, `capabilities[]`                                           | CandidateProfile (1:1), Session (1:N), CompanyMembership (1:1), Invitation (invited/inviter), Job.creator, Application.candidate, history.changedBy | Yes -- always.                                            | Separate collection. A subdocument of nothing: it is the root of the graph.                       |
| `candidate_profiles`  | The candidate's professional data and current résumé reference.   | Large, editable, privacy-sensitive data (`R-03`) that would bloat the hot User document. Optional: a recruiter-only account has none. | headline, location, summary, skills, experience, education, `resume`                  | Application.resumeSnapshot (a _copy_ of resume at apply time)                                                                                       | Yes, by `userId`.                                         | Separate document: 1:1 optional, different update rate than User, clear PII boundary.             |
| `companies`           | A hiring organisation.                                            | Jobs, memberships and invitations all scope to a company.                                                                             | name, industry, location, website, description, `invitationSettings`                  | CompanyMembership, Job, Invitation                                                                                                                  | Yes (company profile views).                              | Own collection.                                                                                   |
| `company_memberships` | The **only** user→company relationship.                           | The database-level answer to `FR-097`/`DC-012`: membership grants company access, not capability.                                     | `userId` (unique), `companyId`, `invitationId`                                        | nothing (leaf)                                                                                                                                      | Yes -- this is the membership lookup itself.              | Separate and lean. No status field, no permissions, no roles (section 5).                         |
| `invitations`         | A company's offer to join, with lifecycle (`FR-098`).             | Invite-based joining (`D-009`, `D-014`): the invitation _is_ the state machine.                                                       | tokenHash, status, timestamps, snapshot expiry                                        | CompanyMembership.invitationId                                                                                                                      | Yes (list my invitations, per-company pending count).     | Separate; independent lifecycle and queries.                                                      |
| `sessions`            | One logged-in session.                                            | `D-011` server-side sessions, shared store (`DC-009`).                                                                                | tokenHash, userId, expiresAt, lastUsedAt                                              | nothing                                                                                                                                             | Yes -- resolution on every protected request.             | Separate; independently created/expired/revoked.                                                  |
| `jobs`                | A company's job posting.                                          | Job lifecycle and candidate discovery.                                                                                                | companyId, createdByUserId (provenance), posting fields, status, publishedAt/closedAt | Application.jobId                                                                                                                                   | Yes (browse, company lists).                              | Separate; owns its lifecycle.                                                                     |
| `applications`        | A candidate's application to a job, plus its full status history. | The core workflow object.                                                                                                             | status, active, resumeSnapshot (copy), `statusHistory[]` (embedded)                   | nothing                                                                                                                                             | Yes (candidate's list, recruiters' company-scoped views). | Separate document; its two attachments (history, résumé snapshot) are embedded (sections 4.8, 8). |

---

## 4. Field-level schemas

Notation: `required`, `unique` (index), `enum`, `default`, validators. All
collections use MongoDB `_id` (ObjectId) and, except `applications`, Mongoose
`timestamps` (`createdAt`, `updatedAt`).

### 4.1 `users`

| Field                    | Type     | Constraints                                                           | Notes and requirement links                                                                                                                                                                                                                                             |
| ------------------------ | -------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_id`                    | ObjectId |                                                                       |                                                                                                                                                                                                                                                                         |
| `email`                  | String   | required, `lowercase`, `trim`, ≤320, **unique index**                 | One account per email (`FR-004`, `OQ-014`). Stored lowercase so the unique index is case-insensitive by construction: `A@B.com` and `a@b.com` cannot coexist. Display casing is lost; the separate `name` field is what users and recruiters see (tradeoff, section 9). |
| `name`                   | String   | required, 1..100                                                      | Account display name; the single source of truth for the person's name (see CandidateProfile).                                                                                                                                                                          |
| `passwordHash`           | String   | required, 60..255                                                     | `FR-005`, `NFR-S-002`. The authentication phase produces the hash; a value shorter than bcrypt's 60 chars is a plaintext-or-bug smell. Never returned by any API.                                                                                                       |
| `capabilities`           | String[] | required, enum `CANDIDATE`/`RECRUITER`, ≥1 element, **no duplicates** | The capability model (`D-001` extended by `D-013`): an account may hold both. An array of enum values so a third capability (Admin) is one added value, not a migration (`DC-001`). `$addToSet` + schema validator keep it a set.                                       |
| `createdAt`, `updatedAt` | Date     | timestamps                                                            |                                                                                                                                                                                                                                                                         |

Deliberately absent: a `role` field (contradicts `D-013`), a `companyId`
(membership is its own collection), and an index on `capabilities` (the only
capability query is inside an `_id` lookup, which the `_id` index already
serves; "which users hold Recruiter?" is not an MVP query).

### 4.2 `candidate_profiles`

| Field        | Type                             | Constraints                                                                                                                                                                | Notes                                                                                                                     |
| ------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `_id`        | ObjectId                         |                                                                                                                                                                            |                                                                                                                           |
| `userId`     | ObjectId → User                  | required, **unique index**                                                                                                                                                 | The 1:1.                                                                                                                  |
| `headline`   | String                           | ≤200                                                                                                                                                                       | `FR-016`                                                                                                                  |
| `location`   | String                           | ≤100                                                                                                                                                                       |                                                                                                                           |
| `summary`    | String                           | ≤5000                                                                                                                                                                      |                                                                                                                           |
| `skills`     | String[]                         | each ≤50, trimmed                                                                                                                                                          | `FR-017`                                                                                                                  |
| `experience` | subdoc[]                         | subdoc: `role`, `organisation`, `startDate` required; `endDate` Date-or-null (null = current); `description` ≤2000. Validator: when both dates set, `endDate ≥ startDate`. | `FR-018`.                                                                                                                 |
| `education`  | subdoc[]                         | subdoc: `institution`, `qualification`, `startDate` required; `endDate` Date-or-null. Same ordering validator.                                                             | `FR-019`.                                                                                                                 |
| `resume`     | embedded resumeAsset or **null** | null = no current résumé                                                                                                                                                   | `FR-023`--`FR-030`. Replacement sets the whole path (FR-024); deletion sets null (FR-030). Bytes never stored (`DC-002`). |

`resumeAsset` (shared with Applications, `_id: false`):

| Field              | Type   | Constraints           | Notes                                                                                         |
| ------------------ | ------ | --------------------- | --------------------------------------------------------------------------------------------- |
| `assetId`          | String | required, ≤255        | The Cloudinary reference (`public_id`) used later to request a signed delivery URL (`D-016`). |
| `originalFilename` | String | required, ≤255        | `FR-029`.                                                                                     |
| `mimeType`         | String | required, ≤100        | `FR-029`. Content-based validation is `FR-027`/service.                                       |
| `sizeBytes`        | Number | required, ≥1, integer | `FR-029`; the _cap_ is `OQ-007`, not decided here.                                            |
| `uploadedAt`       | Date   | required              | `FR-029`.                                                                                     |

Deliberately absent here: the résumé **bytes** (`DC-002`) and any Cloudinary
**delivery URL** (a URL is a transient delivery mechanism, not authorization
state, `DC-011`).

No `name` on the profile: the person's name lives once on User (section 9).

### 4.3 `companies`

| Field                | Type     | Constraints      | Notes                                                                      |
| -------------------- | -------- | ---------------- | -------------------------------------------------------------------------- |
| `_id`                | ObjectId |                  |                                                                            |
| `name`               | String   | required, 1..120 | **No unique index** (`OQ-016` downgraded: nobody searches a name to join). |
| `industry`           | String   | ≤80              | `FR-038`                                                                   |
| `location`           | String   | ≤100             |                                                                            |
| `website`            | String   | ≤250             | URL _format_ validation belongs to the registration service.               |
| `description`        | String   | ≤5000            |                                                                            |
| `invitationSettings` | embedded | required         | See below.                                                                 |

`invitationSettings` (`_id: false`): the two company-configurable values of
`FR-098`/`D-014` -- `expiryHours` and `maxPendingInvitations`, both `required`
positive integers with **no default and no policy bounds**. Rationale: the
numeric bounds are explicitly undecided (§13.3); a required field forces the
choice to be made where the company is created, and the schema's positive-
integer check is data integrity, not product policy (section 7).

### 4.4 `company_memberships`

| Field                    | Type                  | Constraints                | Notes                                                    |
| ------------------------ | --------------------- | -------------------------- | -------------------------------------------------------- |
| `_id`                    | ObjectId              |                            |                                                          |
| `userId`                 | ObjectId → User       | required, **unique index** | `FR-037` at the database level: one membership per user. |
| `companyId`              | ObjectId → Company    | required, index            | "This company's members."                                |
| `invitationId`           | ObjectId → Invitation | required                   | Provenance: how the join happened.                       |
| `createdAt`, `updatedAt` | Date                  | timestamps                 | `createdAt` = joined date.                               |

No `status` field: pending lives on the Invitation, accepted is this row,
anything else is the absence of a row. `DC-008` is satisfied by that division,
which avoids two sources of truth (section 9). No role/permission fields:
`D-001`/`D-004` exclude company roles; the MVP needs none.

### 4.5 `invitations`

| Field                    | Type               | Constraints                                                       | Notes                                                                                                                                                                                                   |
| ------------------------ | ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_id`                    | ObjectId           |                                                                   |                                                                                                                                                                                                         |
| `companyId`              | ObjectId → Company | required                                                          | index (compound, below)                                                                                                                                                                                 |
| `invitedUserId`          | ObjectId → User    | required                                                          | The invitee's account (resolved from the email, `FR-080`).                                                                                                                                              |
| `invitedByUserId`        | ObjectId → User    | required                                                          | The inviter.                                                                                                                                                                                            |
| `invitedEmail`           | String             | required, lowercase, trim, ≤320                                   | Denormalized provenance: what was invited, as recorded (the email may later change). Tradeoff, section 9.                                                                                               |
| `tokenHash`              | String             | required, exactly 64 chars, `^[a-f0-9]{64}$`, **unique index**    | SHA-256 hex of the cryptographically random token (`FR-098`, `NFR-S-019`). The raw token is never stored. A hash of a high-entropy value needs no slow hashing (nothing to brute-force); see section 7. |
| `status`                 | String             | enum `PENDING`/`ACCEPTED`/`DECLINED`/`EXPIRED`, default `PENDING` | `FR-098`, `DC-008`.                                                                                                                                                                                     |
| `expiresAt`              | Date               | required                                                          | **Snapshotted from the company's setting at creation**, so later company-settings changes do not retroactively alter pending invites.                                                                   |
| `acceptedAt`             | Date or null       | default null                                                      | Validator: `status === 'ACCEPTED'` iff `acceptedAt` set (same for declined/expired) -- the status and its timestamp cannot disagree.                                                                    |
| `declinedAt`             | Date or null       | default null                                                      |                                                                                                                                                                                                         |
| `expiredAt`              | Date or null       | default null                                                      |                                                                                                                                                                                                         |
| `createdAt`, `updatedAt` | Date               | timestamps                                                        |                                                                                                                                                                                                         |

### 4.6 `sessions`

| Field                    | Type            | Constraints                                       | Notes                                                                                              |
| ------------------------ | --------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `_id`                    | ObjectId        |                                                   |                                                                                                    |
| `tokenHash`              | String          | required, 64-hex, **unique index**                | Hash of the opaque session identifier (`D-011`, `FR-089`). Same rationale as the invitation token. |
| `userId`                 | ObjectId → User | required, index                                   | "Revoke all sessions for this user" (`FR-093`, `FR-110`).                                          |
| `expiresAt`              | Date            | required, **TTL index** (`expireAfterSeconds: 0`) | Expired records are _deleted_, not retained (`NFR-S-016`).                                         |
| `lastUsedAt`             | Date            | required                                          | The field an idle-timeout policy (a §13.3 design task) will read; recorded on resolution.          |
| `createdAt`, `updatedAt` | Date            | timestamps                                        |                                                                                                    |

Deliberately absent: `revokedAt`. Logout _deletes_ the row immediately
(`FR-092`); a field that kept dead sessions around would contradict
`NFR-S-016`. No identity claims live in the session (`FR-091`, section 5).

### 4.7 `jobs`

| Field              | Type               | Constraints                                                                     | Notes                                                                                                                                                   |
| ------------------ | ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_id`              | ObjectId           |                                                                                 |                                                                                                                                                         |
| `companyId`        | ObjectId → Company | required, index (compound below)                                                | Direct ownership.                                                                                                                                       |
| `createdByUserId`  | ObjectId → User    | required                                                                        | **Provenance, not permission** (10.6.1): any member of the company may act.                                                                             |
| `title`            | String             | required, 1..120                                                                |                                                                                                                                                         |
| `description`      | String             | required, 1..20000                                                              |                                                                                                                                                         |
| `responsibilities` | String[]           | each ≤2000                                                                      | `FR-044`. May be empty; "a draft may be incomplete" vs "publish requires a minimum" is `FR-043`+`FR-051`, decided by the publish gate in a later phase. |
| `requirements`     | String[]           | each ≤2000                                                                      |                                                                                                                                                         |
| `location`         | String             | required, ≤120                                                                  |                                                                                                                                                         |
| `employmentType`   | String             | required, enum (provisional): `FULL_TIME`/`PART_TIME`/`CONTRACT`/`INTERNSHIP`   | `FR-044` requires the field but does **not enumerate values**; this set is a visible, flagged, easily-changed guess (section 10).                       |
| `salaryRange`      | embedded or null   | `min`/`max` Number ≥0, `currency` ≤3 chars; validator `max ≥ min` when both set | Optional per `OQ-008`.                                                                                                                                  |
| `skills`           | String[]           | each ≤50                                                                        | skill tags                                                                                                                                              |
| `status`           | String             | enum `DRAFT`/`PUBLISHED`/`CLOSED`, default `DRAFT`                              | The assumed set (`OQ-009`).                                                                                                                             |
| `publishedAt`      | Date or null       | default null                                                                    | Set by the service on publish.                                                                                                                          |
| `closedAt`         | Date or null       | default null                                                                    | Set by the service on close.                                                                                                                            |

### 4.8 `applications`

| Field             | Type                 | Constraints                                            | Notes                                                                                                                                                                                                                                                |
| ----------------- | -------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_id`             | ObjectId             |                                                        |                                                                                                                                                                                                                                                      |
| `candidateUserId` | ObjectId → User      | required                                               |                                                                                                                                                                                                                                                      |
| `jobId`           | ObjectId → Job       | required                                               |                                                                                                                                                                                                                                                      |
| `companyId`       | ObjectId → Company   | required, index (compound below)                       | **Denormalized from job → company** so every recruiter query is company-scoped inside the database (`DC-005`, `NFR-S-014`). Written once at creation, never edited. Tradeoff, section 9.                                                             |
| `status`          | String               | enum (8 values, `FR-059`), default `APPLIED`, required | Closed set (`DC-003`).                                                                                                                                                                                                                               |
| `active`          | Boolean              | required                                               | **Denormalized** from `status` (`active = status is non-terminal`) to power the partial unique index for `FR-057` (`partialFilterExpression` cannot test `$in`; section 6 and 9). Kept consistent by the CAS write and guarded by `pre('validate')`. |
| `resumeSnapshot`  | embedded resumeAsset | required                                               | Copy of the résumé reference at apply time (`FR-056`); later replacements do not rewrite history.                                                                                                                                                    |
| `statusHistory`   | embedded subdoc[]    | required; chain validator; cap 6                       | See section 8. Subdoc: `previousStatus` (enum-or-null, null only on the creation entry), `status` (enum), `changedByUserId` (→ User), `changedAt`.                                                                                                   |

`versionKey: false` (no `__v`): concurrency is **compare-and-set on status**
(`FR-087`), one mechanism, documented in the model; a second version number
would be redundant (section 9).

---

## 5. Relationships

### Capability vs membership (the question this whole phase answers)

```text
User.capabilities = ['CANDIDATE']            => may apply, manage profile/resume
User.capabilities = ['RECRUITER']            => may do recruiter-shaped things? NO --
                                                recruiter access also requires membership
User ──> CompanyMembership ──> Company        => the ONLY thing that grants company access
User.capabilities = ['CANDIDATE','RECRUITER'] + one membership => does both, for THAT company
```

Authorization is the four ordered checks of `FR-097`: authenticated, holds the
required capability, member of the specific company, and that membership
permits the action. The database makes step 3 a real query
(`CompanyMembership.findOne({ userId, companyId })`) backed by the
`userId`-unique and `companyId`-indexed rows. No design decision anywhere
collapses this to `user.role === 'RECRUITER'`.

### Accepted risks in the relationship graph

- **Membership identity is `userId`**, not `_id`: a unique index guarantees the
  exactly-one-company rule (`FR-037`). Cost: becoming many-to-many later
  (`DC-004`) means dropping that index; see section 9.
- **Snapshots are deliberate data duplication.** The résumé reference exists
  twice (live on the profile, snapshot on the application) because `FR-056`
  says so. The _schema shape_ is shared (`resumeAsset.ts`) so the two copies
  cannot drift in shape; the _values_ are expected to diverge over time.
- **Sessions point at users and carry nothing else**: identity, capabilities
  and membership are re-read per request (`FR-091`), so a capability change
  takes effect immediately and a stolen session still resolves to the _real_
  account at request time.

---

## 6. Indexes and uniqueness

Every index exists to serve a named query; none are "because indexes are good".

| Collection            | Index                                   | Unique | Partial / TTL                   | Serves                                                                                           | Why justified                                                                         |
| --------------------- | --------------------------------------- | ------ | ------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `users`               | `{ email: 1 }`                          | yes    |                                 | Login/registration lookup; one-account-per-email (`FR-004`)                                      | The core identity constraint. Case-insensitive by normalization (lowercase storage).  |
| `candidate_profiles`  | `{ userId: 1 }`                         | yes    |                                 | Profile lookup by user (`FR-015`, apply flow)                                                    | Enforces the 1:1.                                                                     |
| `company_memberships` | `{ userId: 1 }`                         | yes    |                                 | Membership lookup; **exactly one company (`FR-037`)**                                            | The MVP rule as a database guarantee; also the `FR-083` backstop.                     |
| `company_memberships` | `{ companyId: 1 }`                      | no     |                                 | "This company's members"                                                                         | Company-first queries cannot use the userId index.                                    |
| `invitations`         | `{ tokenHash: 1 }`                      | yes    |                                 | Token acceptance lookup (`FR-098`)                                                               | Token resolution must be unambiguous.                                                 |
| `invitations`         | `{ invitedUserId: 1, status: 1 }`       | no     |                                 | The signed-in user's own (pending) invitations (`FR-099`)                                        | The only in-app invitation list in the MVP (`DC-013`).                                |
| `invitations`         | `{ companyId: 1, status: 1 }`           | no     |                                 | Pending count per company (the `maxPendingInvitations` limit) and a recruiter's sent invitations | The pending limit needs a company-first count.                                        |
| `sessions`            | `{ tokenHash: 1 }`                      | yes    |                                 | Resolution of every authenticated request (`FR-091`)                                             | Hot path; unique by construction.                                                     |
| `sessions`            | `{ userId: 1 }`                         | no     |                                 | Revoke all sessions (`FR-093`, `FR-110`)                                                         |                                                                                       |
| `sessions`            | `{ expiresAt: 1 }`                      | no     | **TTL** `expireAfterSeconds: 0` | Delete expired sessions (`NFR-S-016`)                                                            | Documented cleanup policy, not a query.                                               |
| `jobs`                | `{ status: 1, publishedAt: -1 }`        | no     |                                 | Browse published jobs newest-first, bounded (`FR-075`, `FR-076`)                                 | Filter + sort in one scan; `status` leads so drafts/closed never enter.               |
| `jobs`                | `{ companyId: 1, status: 1 }`           | no     |                                 | Recruiter's own-company job list (`FR-053`); company profile published list (`FR-050`)           | Company-first filter that the browse index cannot serve.                              |
| `applications`        | `{ candidateUserId: 1, jobId: 1 }`      | yes    | **partial** `{ active: true }`  | At most one _active_ application per candidate/job (`FR-057`), even under concurrency            | The one rule MongoDB must enforce that no service check can. See below for the shape. |
| `applications`        | `{ candidateUserId: 1, createdAt: -1 }` | no     |                                 | "My applications", newest first (`FR-065`)                                                       |                                                                                       |
| `applications`        | `{ jobId: 1, status: 1 }`               | no     |                                 | Applicants for a job, filterable by status (`FR-066`)                                            |                                                                                       |
| `applications`        | `{ companyId: 1, status: 1 }`           | no     |                                 | Counts per status for a company (`FR-069`); company scope on every recruiter query (`DC-005`)    | The company scope is _in_ the index, making `FR-068` structural.                      |

### Why `FR-057` needs the denormalized `active` boolean

MongoDB `partialFilterExpression` supports only equality, `$exists`,
comparisons, `$type` and `$and`/`$or`/`$nor`. It does **not** support `$in`, so
a partial unique index built on `status IN (non-terminal set)` cannot be
written. The boolean `active` (`active = status is non-terminal`) turns the
partial filter into an equality that MongoDB accepts:

```text
{ candidateUserId: 1, jobId: 1 }  unique  partialFilterExpression: { active: true }
```

Two concurrent "apply" operations for the same pair: one insert wins, the
second hits the unique index and is rejected -- no application-level
existence check needed (`FR-057`). The boolean's currency is guaranteed by the
single CAS write path that sets `status` and `active` together, and by the
`pre('validate')` invariant; a test asserts both.

### Deliberately absent indexes

- `users.capabilities` -- no MVP query filters by capability alone; all
  capability checks ride on an `_id` lookup.
- `companies.name` unique -- `OQ-016` says duplicate names are cosmetic.
- Job **text search** -- that is V1 (`FR-101`/`FR-102`); it will need a text
  index or Atlas Search, deliberately not present in the MVP.
- Invitation `expiresAt` TTL -- **not** indexed for deletion; expired rows are
  _kept as EXPIRED records_ (lifecycle is first-class, `FR-098`). Contrasted
  with sessions, whose requirement is deletion (`NFR-S-016`).

---

## 7. Database-enforceable constraints vs service-layer business rules

| Rule                                                                      | Where it is enforced                       | Mechanism                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One account per email; one profile per user; one membership per user      | **Database**                               | Unique indexes (`users.email`, `candidate_profiles.userId`, `company_memberships.userId`).                                                                                                                                                                                                                                                                  |
| At most one active application per candidate/job, even concurrently       | **Database**                               | Partial unique index on `{ candidateUserId, jobId }` where `active` (`FR-057`).                                                                                                                                                                                                                                                                             |
| Invitation token single-use, once, atomically                             | **Database** (operation)                   | Conditional update: `findOneAndUpdate({ tokenHash, status: 'PENDING', expiresAt: { $gt: now } }, { $set: { status: 'ACCEPTED', acceptedAt } })`. Two concurrent accepts: exactly one matches. No read-then-write.                                                                                                                                           |
| A token hash is never replayed as a different invitation                  | **Database**                               | `tokenHash` unique.                                                                                                                                                                                                                                                                                                                                         |
| Expired sessions do not linger                                            | **Database**                               | TTL index deletes at `expiresAt`.                                                                                                                                                                                                                                                                                                                           |
| Statuses/capabilities are closed sets; required fields; shapes            | **Database** (Mongoose validation)         | Schema enums, `required`, length/pattern checks. Note: Mongoose validation runs in the application. It is still _schema-level_ and it runs before any write persists.                                                                                                                                                                                       |
| `active` ↔ `status`; history chain; invitation status ↔ timestamp         | **Database** (Mongoose validators)         | `pre('validate')` hook + path validators; pure functions under test. These catch corruption, they do not _prevent_ a non-CAS write (see below).                                                                                                                                                                                                             |
| **Authorization** (is this recruiter a member of THIS company)            | **Service** (later phase)                  | Query scoped by membership + `companyId` inside the query (`DC-005`). No schema can replace this.                                                                                                                                                                                                                                                           |
| **Transition legality** (which status → which status, by whom)            | **Service** (later phase)                  | The normative map 10.6.1; `FR-070`. The schema only enumerates states; it does not encode edges.                                                                                                                                                                                                                                                            |
| **Invitation lifecycle** (PENDING only, time-based expiry interpretation) | **Service** (later phase)                  | The conditional update above plus lazy-expiry on read; the schema's enum + single open state support it.                                                                                                                                                                                                                                                    |
| **Immutable, append-only history**                                        | **Service/API discipline** + schema guards | MongoDB cannot freeze an array. All status writes go through the CAS-SET-push update (`NFR-R-003`): status change and history append are one atomic document write, so "status changed but no history entry" is structurally impossible. Existing entries are never `$set`; the chain validator detects (and tests prove the write path guards) corruption. |
| Compare-and-set staleness (`FR-087`)                                      | **Service** + query shape                  | The update _is_ the CAS: filter on the expected `status`; a stale writer's filter matches nothing and the loser is told to reload (`NFR-R-008`).                                                                                                                                                                                                            |
| Re-application after a terminal status (`OQ-024`)                         | **Service** (decision pending)             | The partial index permits it (old row is `active: false`); the service decides whether to allow it.                                                                                                                                                                                                                                                         |
| Pending-invitation limit and expiry _bounds_                              | **Service** (Phase 1 validation decision)  | The schema stores the company's values; the ±bounds are not invented here.                                                                                                                                                                                                                                                                                  |

**Two honest caveats** (do not lose either in an interview):

1. **Mongoose validators are not database constraints.** They are application
   code that runs before a write. An update that bypasses Mongoose (or a
   direct driver call) would not run them. The _uniqueness_ rules are real
   MongoDB constraints; the _derived-state_ invariants are enforced by the
   single documented write path plus validators. That is why the schema
   exposes the invariants as pure functions with tests.
2. **Password hashing and hashing strategy are not the same problem.** The
   invitation/session tokens are high-entropy random values, so storing a plain
   SHA-256 hash is correct: there is nothing to brute-force, and a slow hash
   would buy nothing. Passwords are low-entropy secrets; _their_ hashing
   (`NFR-S-002`) is the authentication phase's job with a deliberately slow,
   salted algorithm. Mixing the two is a classic interview trap.

---

## 8. Application status history: why embedded

`FR-060`/`FR-061`/10.6.1 define the history: each successful change appends
`previousStatus`, `status`, `changedBy`, `changedAt`; the history is
append-only and immutable; the longest legal path is 5 transitions, so **the
history is bounded at 6 entries** and needs no pagination.

Why embedding inside `Application` is right:

1. **Atomicity for free (`NFR-R-003`).** The CAS update changes `status` and
   `$push`es the history entry in one document write. A separate history
   collection would need a transaction to make "new status + its entry" atomic
   -- and free-tier MongoDB tiers complicate transactions (`R-08`). Embedding
   makes the coupling structural, not transactional.
2. **Bounded size.** Six small subdocuments cannot threaten the 16 MB document
   limit. (If a later phase allowed unbounded histories, _that_ would be the
   moment to reconsider.)
3. **Always read together.** `FR-065` returns the application with its full
   history; recruiters see the same. There is no MVP query on history alone.
4. **Immutability is honest here.** MongoDB cannot be asked to freeze array
   elements. The protection is: only the CAS-push write path adds entries
   (`NFR-M-004` simplicity: one write path), plus the chain validator that
   rejects corrupted data (`validStatusHistoryChain`: entry 0 has
   `previousStatus: null`; every later entry's `previousStatus` equals the
   previous entry's `status`; max 6; last entry matches current `status`).

The alternative (a separate `application_status_history` collection) was
rejected: it would have re-introduced the transaction problem `NFR-R-003` was
written to avoid, added pagination where the requirement says none is needed,
and gained nothing an MVP query demands.

The same bounds-driven reasoning applies to `CandidateProfile.experience` /
`education`: they are always read with the profile and never queried alone, so
they are embedded. Unlike history they have no product-imposed cap, which is
noted as a deferred risk (section 10).

---

## 9. Important tradeoffs

| Decision                    | Chosen                                                            | Rejected alternative                                                                                                                              | Why                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capabilities representation | `String[]` enum on User                                           | a single `role: string` (cannot express both); a fixed `{candidate:boolean, recruiter:boolean}` object (a third capability means a schema change) | **`D-013` needs plural; `DC-001` needs extensibility.** The array is a set with validators; `$addToSet` writes it.                                    |
| Membership uniquess         | unique `userId` index on memberships                              | unique `{userId, companyId}` + a service-level "at most one" check                                                                                | **Exactly one company must be a database fact (`FR-037`), not a service habit.** Cost: `DC-004` many-to-many later = drop one index. Named and cheap. |
| Membership status           | none (absent / invitation / row)                                  | `status: PENDING                                                                                                                                  | ACTIVE` on the membership                                                                                                                             | Two `pending` sources would drift. `DC-008` is satisfied across invitation + row. |
| Status history              | embedded in `Application`                                         | separate collection                                                                                                                               | Atomicity (`NFR-R-003`), bounded size, no independent query (section 8).                                                                              |
| `FR-057` enforcement        | partial unique index on `{candidateUserId, jobId}` where `active` | service-level existence check; or partial index on `status: {$in: [...]}` (impossible); or full unique index (blocks re-application forever)      | The per-rule-explained partial index; `active` exists because `partialFilterExpression` cannot do `$in`.                                              |
| Concurrency token           | CAS on `status` itself (`FR-087`)                                 | a numeric `version` counter (or Mongoose `__v`)                                                                                                   | Every transition changes `status`; the status _is_ the version. Two mechanisms would needlessly conflict; `versionKey: false` documents the choice.   |
| Session/revocation          | `tokenHash` + TTL on `expiresAt`; logout deletes                  | storing the raw identifier; a `revokedAt` retention field                                                                                         | A dump must not yield live credentials (`NFR-S-019` spirit); `NFR-S-016` says _delete_, not retain.                                                   |
| Invitation expiry           | TTL-less `expiresAt`, expired state persisted                     | `expireAfterSeconds: 0` TTL on invitations                                                                                                        | TTL would delete the record before `EXPIRED` is ever observed, destroying the first-class lifecycle (`FR-098`).                                       |
| Token hash algorithm        | plain SHA-256 of a random token                                   | bcrypt/argon2 for tokens                                                                                                                          | High-entropy secrets need no slow hash; brute-forcing 256 bits is impossible. Save slow hashing for passwords.                                        |
| Résumé                      | `assetId` + metadata, never bytes, never a URL                    | storing bytes; storing the signed delivery URL                                                                                                    | `DC-002`/`FR-028`; a URL is a transient delivery mechanism, not authorization state (`DC-011`).                                                       |
| Person's name               | once on `User`                                                    | duplicated on `CandidateProfile`                                                                                                                  | Two sources of truth drift. `FR-016` is satisfied at the profile view (reads `user.name`). Trade-off: profile data is not self-contained.             |
| `invitedEmail`              | stored alongside `invitedUserId`                                  | email only via the user reference                                                                                                                 | The invitation stays self-describing and auditable if the email later changes; one string for display + provenance.                                   |
| `Application.companyId`     | denormalized                                                      | join via job per query                                                                                                                            | `DC-005`: company scope lives in every recruiter query; written once, never edited. Costs one denormalized field.                                     |
| Company settings            | required with no default                                          | defaulted values (e.g. 72h / 5)                                                                                                                   | A default _is_ the undecided numeric decision (§13.3). Required forces the choice to be explicit.                                                     |
| Employment type             | a visible provisional enum                                        | an unvalidated string                                                                                                                             | `FR-044` names the field but not the values; a closed, easily-edited set with a flagged open item beats free text.                                    |
| Resumé snapshot             | only the résumé reference                                         | a full profile snapshot                                                                                                                           | `FR-056` wording ("profile _and_ current résumé reference") is read narrowly; flagged as an open question in section 10.                              |
| Normalized email            | `lowercase` stored, display via `name`                            | preserve original casing                                                                                                                          | The cost of a case-insensitive unique index without collation is losing email casing; the account name owns display.                                  |

---

## 10. Lifecycle considerations

Who owns each transition is a later-phase service; this section is about what
the data model guarantees and what the requirements leave open.

| Event                                            | What happens in the data model                                                                                                                                                                                                                               | Open / deferred                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate replaces résumé (`FR-024`)             | `candidate_profiles.resume` path is overwritten with a new asset reference (and the old Cloudinary file is deleted by the upload service, `FR-030`). **Past applications' `resumeSnapshot` are untouched** (`FR-056`).                                       | Deleting the old Cloudinary asset is service logic (Phase with Cloudinary); orphan handling is `NFR-R-002`.                                                                             |
| Candidate deletes résumé (`FR-030`)              | `resume` → null. Snapshots remain.                                                                                                                                                                                                                           |                                                                                                                                                                                         |
| Recruiter closes a job (`FR-047`)                | `jobs.status → CLOSED`, `closedAt` set. Applications are **retained** (`FR-047`: "its applications and history are retained"); nothing cascades.                                                                                                             | Whether a closed job can reopen with applications intact (`OQ-010`) is answered by the reopen service; the schema stores no per-application "job was closed when I applied" flag.       |
| Application reaches a terminal status (`FR-085`) | `status`, `active → false`, history entry appended. The row is never soft-deleted and nothing is purged.                                                                                                                                                     | Re-application after withdrawal/rejection is `OQ-024` (the index permits it; the service will decide).                                                                                  |
| Invitation expires                               | Lazy expiry in the service: on read, a `PENDING` row past `expiresAt` is persisted as `EXPIRED` + `expiredAt`. The row is kept.                                                                                                                              | TTL/sweep frequency is an operational detail; volume is tiny (invitations are rare).                                                                                                    |
| Invitation accepted                              | The conditional PENDING update sets `ACCEPTED` + `acceptedAt`; the membership service then inserts **one** `CompanyMembership` row and **adds** the Recruiter capability (`FR-096`). The unique `userId` membership index backstops a violation of `FR-037`. | The add-capability step is a `$addToSet` on `users.capabilities`; atomicity across the two documents is a Phase 4 design question (`NFR-R-003` is about status+history, not this pair). |
| Session revoked (logout)                         | The row is **deleted** (`FR-092`). Replayed identifiers find nothing.                                                                                                                                                                                        |                                                                                                                                                                                         |
| Session expires                                  | TTL index deletes it (`NFR-S-016`).                                                                                                                                                                                                                          | Idle-timeout (`§13.3`) is not implemented; `lastUsedAt` exists so the policy has its data.                                                                                              |
| User data removal                                | No deletion requirements exist in the MVP (`FR-213` is Future; `OQ-013` is open). Nothing here cascades deletes.                                                                                                                                             | `OQ-013` (self-service deletion/export before public launch) is **deliberately not decided by the schema**.                                                                             |
| Company settings change                          | Only affects _future_ invitations (each invitation snapshots `expiresAt` at creation). Nothing retroactive.                                                                                                                                                  |                                                                                                                                                                                         |

**Deferred-by-silence items** (the requirements say nothing; the schema does
not invent answers): recruitment of a member/leaving (OQ-015), soft-delete for
jobs/applications, per-application expiry data, cascading cleanup on company
deletion (no deletion model exists yet).

---

## 11. Unresolved implementation details (honest list)

These are decisions the requirements deliberately leave open; the schema was
designed to stay valid under any answer. None are fabricated -- each is an
existing open question in `docs/product-requirements.md`.

1. **Re-application after a terminal status** (`OQ-024`). The partial unique
   index permits it; the service must decide. The schema requires no change
   either way.
2. **Employment type values** (the field is `FR-044`, the values are not).
   The provisional enum is one line to edit.
3. **Invitation numeric bounds** (expiry and pending-limit min/max) and
   **résumé size cap** (`OQ-007`) -- Phase 1 validation decisions; the schema
   checks shape only.
4. **`FR-056` profile snapshot scope.** "Records the candidate's profile and
   current résumé reference" is read here as _résumé reference only_ on the
   application. If product wants a full profile snapshot, that is a second
   embedded subdocument (or a reference to a versioned profile) -- a schema
   addition, not a rework. Flagged for the developer.
5. **Job status set** (`OQ-009`): Draft/Published/Closed assumed; a `PAUSED`
   value later is an enum addition.
6. **Session concurrency** (`OQ-025`): the schema supports any of the four
   behaviours (N sessions, revoke-on-login, device list). A "session list"
   UI would need nothing new; "revoke all on login" is a query on `userId`.
7. **Array-size caps** on `experience`/`education`/`skills`: none are invented
   (no requirement bounds them). If unbounded growth becomes real, add explicit
   caps -- the same reasoning as the history's 6-entry cap.
8. **Production index management**: `autoIndex` is currently the Mongoose
   default (indexes build on connect). The deployment phase should set
   `autoIndex: false` in production and manage indexes deliberately
   (`NFR-D`-adjacent operational concern).
9. **V1 growth**: job search text index / Atlas Search (`FR-101`), and moving
   the status enums into `@hireflow/contracts` when the Application API first
   puts them on the wire.
10. **The old README Phase 3 list** (users, candidate profiles, recruiter
    profiles, companies, jobs, applications) predates `D-013`--`D-016`; it is
    superseded by the eight collections above. Recruiter profiles are not a
    concept in the current requirements.

---

## Appendix: verification performed

- `apps/api/src/models/models.test.ts` (40 tests, offline): index definitions
  asserted from `schema.indexes()`; enum/required/pattern validation via
  `validate()`; history chain, `active` invariant, invitation timestamp
  invariant; pure truth-table functions.
- Full `npm run verify` (typecheck, lint, format, tests, build) passes.
- Manual, reported check against the real local MongoDB 8.2: models imported,
  `createIndexes()` run, and the resulting `collection.indexes()` output
  inspected for the unique, partial and TTL indexes (see the Phase 3 report;
  this is not part of the automated suite because the suite must not depend on
  a live database).
