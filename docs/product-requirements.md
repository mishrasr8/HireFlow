# Hireflow --- Product Requirements Document

> Phase 0 --- Product Requirements
> Status: Complete (pending developer review)
> No application code exists yet, by design.

This document defines **what Hireflow is** and **what it must do** before any
implementation is written. It deliberately does **not** define how the system
will be built. Technology selection, architecture, data modelling, API design
and the authentication mechanism are Phase 1 and later decisions, and are
listed as open questions in section 13.

Every requirement in this document is traceable to a numbered ID (`FR-xxx`,
`NFR-xxx`) and every Phase 0 decision is recorded in section 14.

---

## 1. Product Overview

**Hireflow** is a web-based recruitment platform that connects two groups:

- **Candidates** who want to find jobs, maintain a profile and track the
  progress of the applications they have submitted.
- **Recruiters** who represent a company, publish that company's jobs and
  manage the applicants for them.

The product is a realistic, portfolio-grade reference implementation built as a
structured learning project. It is not a real job board: it has no network
effects, no job distribution and no employer brand.

### 1.1 Core capability summary

| Capability | Purpose |
| --- | --- |
| Accounts and roles | Candidates and recruiters register, authenticate and are separated by role. |
| Candidate profile | A candidate maintains skills, experience and education. |
| Resume | A candidate stores one current resume file outside the database. |
| Company | Each recruiter belongs to one company with a public profile. |
| Jobs | A recruiter creates, publishes, closes and reopens jobs for their company. |
| Discovery | Anyone can browse published jobs and read job details. |
| Applications | A candidate applies to a job; a recruiter manages the resulting application. |
| Application status | A controlled, auditable status lifecycle with history. |

### 1.2 Platform and roles

- Web application, usable on desktop and mobile browsers (responsive layout).
- Two roles in the MVP: **Candidate** and **Recruiter**. See decision `D-001`.
- One account holds exactly one role in the MVP. See `OQ-012`, and `OQ-021` for
  the case where an existing candidate is invited to a company.
- A recruiter belongs to exactly one company, and joins a company by invitation
  only. See `D-004` and `D-009`.

---

## 2. Problem Statement

### 2.1 What problem does the product solve?

Small and mid-sized companies hire through informal, disconnected processes:
a job is posted in one place, résumés arrive as email attachments, and the
recruiter keeps track of who applied in a spreadsheet. Meanwhile, candidates
apply to many jobs and have no reliable way to find out what happened after
they pressed submit.

The two concrete failures are:

1. **The candidate loses visibility.** After applying, a candidate typically
   receives no confirmation of receipt, no record of status, and no way to
   know whether they are still being considered or were silently dropped.
2. **The recruiter loses traceability.** Applicant status lives in a private
   spreadsheet, so there is no record of who moved an applicant to a stage, or
   when. Decisions cannot be explained, audited or reproduced.

### 2.2 Who experiences the problem?

- **Junior developers, graduates and career changers** who apply to many
  employers and cannot track their own application history.
- **In-house recruiters and hiring managers at small-to-mid companies** who
  manage a live applicant list for a handful of open roles, often without
  dedicated applicant-tracking software.
- **Company founders and small team leads** who hire occasionally and need a
  system that requires no administrator to set up.

### 2.3 Proposed solution

Hireflow provides one shared record of the hiring process:

- A candidate creates a profile, stores a resume, and applies to jobs.
- A recruiter publishes jobs for their company and reviews applicants.
- Every application moves through a **controlled set of statuses**, and every
  transition is recorded with who made it and when, forming an append-only
  status history.
- Both sides can see the same current state: the candidate sees the status of
  their applications, the recruiter sees the applicant list for their jobs.
- Access is scoped by **ownership**, enforced on the server, so a recruiter can
  only ever see and manage the jobs and applicants of their own company.

### 2.4 Why is this more interesting than a basic job board?

Stated honestly: a job board is mostly CRUD plus a search box. Hireflow is
interesting because the hard part is not the CRUD --- it is the parts around
it, which are exactly the parts that distinguish a junior project from a
career project:

| Area | Why it is non-trivial | Requirement IDs |
| --- | --- | --- |
| A real state machine | Application status is a closed set with a fixed transition map (10.6.1), not a free-text field. Skipped stages, backward moves and reopening a terminal state are rejected server-side. | `FR-059`, `FR-070`, `FR-085` |
| Auditable history | Every transition is append-only, records the previous status as well as the new one, and is attributed to an actor, so history cannot be silently rewritten. | `FR-060`, `FR-061` |
| Correct behaviour under concurrency | Two recruiters acting on one application cannot silently lose one change; the stale write is rejected. | `FR-087` |
| Ownership-scoped authorization | "Recruiters only see their own company" is a correctness and privacy property, not a UI concern. It has to hold in the database query. | `FR-049`, `FR-068`, `NFR-S-014` |
| Revocable, not just verifiable, authentication | Choosing server-side sessions means authentication state can be withdrawn the instant it should be, and logout means something on the server actually changed. That is a security property a stateless self-contained token cannot offer. | `FR-088`---`FR-095`, `NFR-S-013`, `NFR-S-018` |
| Untrusted file handling | A résumé upload is an untrusted-file security surface: type sniffing, size limits, private storage, authorised delivery. | `FR-023`---`FR-034` |
| Multi-actor consistency | Candidate and recruiter act on the same application from opposite sides; both views must stay consistent. | `FR-065`, `FR-066` |

**What it is not:** it does not compete with LinkedIn, Indeed or a real ATS. It
has no ranking algorithm, no matching engine, no messaging, no payments, and
no employer subscription model. Those belong in future scope or not at all
(section 9).

---

## 3. Goals

Product goals for the MVP deployment:

- **G-01** A candidate can register, complete a profile, upload a resume, find a
  job, apply, and see the current status and history of every application they
  have submitted --- without contacting anyone.
- **G-02** A recruiter can register, set up their company, publish a job, and
  manage the resulting applicant list, including changing statuses that the
  candidate can immediately see.
- **G-03** No user can read or modify data belonging to another user or another
  company, enforced on the server and covered by tests.
- **G-04** The application is publicly deployable on free-tier services and is
  usable on a phone browser.
- **G-05** Important behaviour --- authentication, authorization, validation and
  the status lifecycle --- is covered by meaningful automated tests.
- **G-06** Every significant engineering decision is documented with its
  alternatives and tradeoffs, so it can be explained in an interview.

---

## 4. Non-Goals

Explicitly out of scope. Listing these prevents scope creep.

### 4.1 Not in the MVP

- **Admin / moderator role.** Deferred to future scope (`D-001`). Abuse and
  moderation are handled manually until a real need appears.
- **Rich search, filtering, sorting and pagination UX.** The MVP offers a
  bounded, most-recent-first job list. Full search and filtering are V1
  (`FR-101`---`FR-105`).
- **Notifications of any kind**, including in-app. V1 (`FR-079`).
- **Email**: password reset, email verification, application alerts. V1, and
  dependent on an email provider decision (`FR-108`, `FR-109`, `OQ-006`).
- **Dashboards and analytics.** The MVP uses plain list and detail pages.
- **Interview scheduling, interview assignment, interviewer feedback, offer
  negotiation, onboarding, background checks.** V1 or future (`FR-115`---`FR-117`, `FR-207`).
- **AI résumé parsing, matching or candidate scoring.** Future (`FR-203`, `FR-208`).
- **Cover letters, portfolios, multiple résumés, work-sample attachments.**
- **Messaging or chat between candidates and recruiters.**
- **Company verification, company-level roles, multi-company recruiters**
  (`D-004`).
- **Social / OAuth login.** Future (`FR-202`).
- **Company review or rating system.**
- **Native mobile applications.**
- **GDPR-grade self-service data deletion / export.** Raised as `OQ-013`,
  because it may become mandatory before a public launch.

### 4.2 Not in this project at all

- Payments, subscriptions, invoicing.
- Job board monetisation, bidding, or sponsored listings.
- A general-purpose HR suite: payroll, performance review, attendance.
- Replacing a commercial ATS for a paying enterprise customer.

---

## 5. Personas

Two personas are the **minimum useful set**. This is a deliberate decision, not
an oversight: the MVP has exactly two roles, and inventing extra personas would
create requirements that no MVP user needs. A third persona (an administrator)
is named in the non-goals above with the conditions that would justify it
(`OQ-018`).

---

### P-01 --- Candidate: "Priya, active junior developer"

- **Role:** Candidate.
- **Context:** Final-year computer science student or a junior developer with
  0--2 years of experience, currently unemployed or unhappy in their role, and
  applying to roughly 10--30 roles per month.
- **Goals:**
  - Apply quickly without retyping the same information every time.
  - Know that her application was received.
  - See, at a glance, which applications are still live and which closed.
  - Understand why she was rejected or still waiting.
  - Keep one current résumé rather than several stale ones.
- **Frustrations:**
  - Submitting a résumé into a void, with no confirmation.
  - Re-uploading the same PDF to every application form.
  - Being unable to answer "did they even open it?".
  - Having to email a recruiter to ask for an update.
  - Broken or half-finished forms on small screens.
- **Important workflows:**
  - Register and verify the account works.
  - Build a profile once, with skills, experience and education.
  - Upload and later replace her résumé.
  - Browse and open job details.
  - Apply to a job and confirm the application appears in her list.
  - Check the status and full history of an application.
  - Withdraw an application she no longer wants.
- **Success looks like:** she can answer "what is the status of everything I
  applied to?" from one page, without emailing anyone.

---

### P-02 --- Recruiter: "Daniel, in-house recruiter at a 60-person company"

- **Role:** Recruiter.
- **Context:** Employed at a small-to-mid company. Owns hiring for 3--8 open
  roles at any moment, and is the only person who reviews applicants for them.
- **Goals:**
  - Publish a role and start receiving applications the same day.
  - See every applicant for a role in one place, sorted by status.
  - Move an applicant forward and record why, so the decision is defensible.
  - Open a candidate's résumé and profile without leaving the applicant list.
  - Close a filled role and stop receiving applications.
- **Frustrations:**
  - Applicant lists spread across email, a spreadsheet and a shared drive.
  - No record of who moved a candidate to "rejected", making decisions hard to
    explain internally.
  - Reposting the same job description by hand for every opening.
  - Not being able to tell a strong applicant from a weak one without opening
    five attachments.
- **Important workflows:**
  - Register and set up his company profile once.
  - Create a job as a draft and refine it before it is public.
  - Publish the job, then edit it while it is live.
  - Review the applicant list for a job and filter it by status.
  - Open an applicant's profile and résumé.
  - Change an applicant's status, with the change recorded.
  - Close the job when the role is filled, keeping the applicant history.
- **Success looks like:** he can run one role end-to-end --- publish, review,
  decide, close --- and produce a record of every decision he made.

---

## 6. User Journeys

### 6.1 Candidate journey

``` text
Register (choose Candidate)
  → Log in
  → Complete profile (skills, experience, education, summary)
  → Upload one current resume (PDF)
  → Browse published jobs (most recent first)
  → Open a job and read the full description
  → Apply (profile + current resume are attached)
  → Confirm the application appears in "My applications"
  → Later: check status and read the status history
  → Optionally: withdraw, but only while the application is still APPLIED
```

**Preconditions:** none. Registration is the entry point; an account is not
required to browse jobs or read job details (`FR-001`).

**Rules that apply along the way:**

- The candidate may hold at most one active application per job (`FR-057`).
- Applying attaches the résumé that is current at the moment of applying
  (`FR-056`).
- An application starts in `APPLIED` (`FR-058`).
- The candidate can only see and edit their own profile and résumé
  (`FR-021`, `FR-031`).
- **Withdrawal is the candidate's only status action, and it is only available
  while the application is still `APPLIED`** (`FR-063`, `FR-070`, `D-010`).
  Once a recruiter has moved it to `UNDER_REVIEW` or beyond, the candidate can
  no longer withdraw it.
- `HIRED`, `REJECTED` and `WITHDRAWN` are terminal, so the candidate's
  application list has three possible end states (`FR-085`).
- The candidate can always read the full status history, including who made
  each change (`FR-060`, `FR-061`).

**Gaps identified in the original journey, now covered:**

| Gap | Requirement |
| --- | --- |
| "Register" did not say what happens next --- the account is unusable until a profile exists | `FR-015`, `FR-022` |
| No step for résumé handling | `FR-023`---`FR-034` |
| No step for handling an already-applied job | `FR-057` |
| No step for a rejected or closed outcome | `FR-060`, `FR-061`, `FR-085` |
| No way to exit the process | `FR-063`, `FR-064` |
| No stated limit on *when* a candidate may withdraw | `FR-070`, `D-010` --- withdraw is only legal from `APPLIED` |
| No stated consequence of applying to a closed job | `FR-052`, `OQ-010` |

**Not covered in the MVP:** email confirmation of receipt, notification of
status change, password reset (`FR-108`, `OQ-006`), and the ability to withdraw
an application that is already under review.

---

### 6.2 Recruiter journey

``` text
Register (choose Recruiter)
  → Create a company, or accept an invitation to an existing one
  → Create a job as a draft
  → Review and complete the draft
  → Publish the job
  → Receive applications (candidates apply)
  → Open the applicant list for the job, filter by status
  → Open a candidate's profile and résumé
  → Change application status (recorded with who and when)
  → Edit the job while it is live, if needed
  → Close the job when the role is filled
```

There are two ways to become a recruiter of a company, and only these two
(`D-009`):

``` text
Path A --- create
  Register as Recruiter
    → Create company (name, industry, location, website, description)
    → Become the first recruiter of that company

Path B --- invited
  Register as Recruiter (or already registered --- see OQ-021)
    → See a pending invitation from an existing company recruiter
    → Accept  → become a recruiter of that company
    → Decline → no membership, no access
```

**Preconditions:** an account with the Recruiter role, belonging to exactly one
company (`D-004`, `D-009`).

**Rules that apply along the way:**

- A recruiter cannot belong to two companies in the MVP (`FR-037`, `FR-083`).
- Only a recruiter of the company can invite a user to it (`FR-081`).
- An invitee has no access to the company until they accept (`FR-082`).
- A job belongs to one company and records the recruiter who created it
  (`FR-043`, `FR-049`).
- Only published jobs are visible to candidates; drafts and closed jobs are
  not listed (`FR-052`).
- A job must be complete enough to publish (`FR-051`).
- Only recruiters of the owning company may view applicants, change statuses
  or close the job (`FR-062`, `FR-068`).
- Every status change writes a history entry recording previous status, new
  status, actor and time (`FR-060`, `FR-061`).
- Status changes must follow the transition map in 10.6.1; the happy path is a
  strict funnel and stages cannot be skipped or reversed (`FR-070`, `D-010`).
- `HIRED`, `REJECTED` and `WITHDRAWN` are terminal and cannot be reopened
  (`FR-085`).
- A recruiter cannot mark an application `WITHDRAWN` --- only the candidate can
  do that, and only from `APPLIED` (`FR-086`).
- Any recruiter of the owning company may act, not only the recruiter who
  created the job (`FR-062`).
- Closing a job keeps existing applications and their history (`FR-047`).

**Gaps identified in the original journey, now covered:**

| Gap | Requirement |
| --- | --- |
| "Create job" and "publish job" implied editing between them --- there is a **draft** state | `FR-043`, `FR-046`, `FR-051` |
| No way to reopen a job closed by mistake | `FR-048` |
| No stated behaviour when a live job needs correcting | `FR-045`, `OQ-009` |
| No step to open the résumé, only "review candidate profiles" | `FR-032`, `FR-067` |
| No rule about which recruiters may see which applicants | `FR-049`, `FR-068` |
| No stated consequence of closing a job with live applications | `FR-047`, `OQ-010` |
| "Set up company" did not say what happens to a recruiter who is not the first one --- resolved as invite-based joining | `FR-041`, `FR-080`---`FR-084`, `D-009` |
| No stated consequence of a recruiter already being employed elsewhere | `FR-083` |
| No step for a recruiter who is also a candidate | `OQ-021` |
| No stated limit on which status changes are legal, or who may make them | `FR-070`, `FR-085`, `FR-086`, `D-010`, map in 10.6.1 |
| No rule for two recruiters changing one application at the same time | `FR-087` |

**Not covered in the MVP:** leaving or being removed from a company, company
ownership transfer, notifying applicants, scheduling interviews, reporting
(`OQ-015`, `FR-115`, `FR-119`, `D-004`).

---

## 7. MVP

The MVP is the smallest feature set that produces a genuinely usable
two-sided product. Every item below is required for the first usable
deployment.

### 7.1 MVP feature set

| # | Feature | Key requirements |
| --- | --- | --- |
| 1 | Registration for both roles, with unique email | `FR-002`, `FR-003`, `FR-004` |
| 2 | Login, logout, protected functionality, server-side sessions, server-side authorization | `FR-006`---`FR-013`, `FR-088`---`FR-095` |
| 3 | Candidate profile: summary, location, skills, experience, education | `FR-015`---`FR-022` |
| 4 | Résumé upload, replace, delete, download (PDF, external storage) | `FR-022`---`FR-033` |
| 5 | Company profile, one per recruiter | `FR-034`---`FR-038` |
| 5a | **Invite-based company joining:** invite a registered user, accept or decline, no access before acceptance | `FR-041`, `FR-080`---`FR-084` |
| 6 | Job create / edit / publish / close / reopen / list | `FR-043`---`FR-054` |
| 7 | Public job browsing and job detail (bounded list, newest first) | `FR-001`, `FR-075`, `FR-076` |
| 8 | Apply to a published job, one active application per candidate per job | `FR-055`---`FR-058` |
| 9 | Application status lifecycle: 8 controlled statuses, enforced transition map, 3 terminal states | `FR-059`, `FR-070`, `FR-085`, `FR-086` |
| 10 | Append-only status history recording previous status, new status, actor and timestamp | `FR-060`, `FR-061` |
| 11 | Recruiter applicant list, filterable by status, with per-status counts | `FR-066`, `FR-069` |
| 12 | Candidate application list with status and history | `FR-065` |
| 13 | Candidate withdrawal of an application | `FR-063`, `FR-064` |
| 14 | Validation, centralized error handling, loading / empty / error states | `NFR-S-004`, `NFR-R-001`, `NFR-R-007` |
| 15 | Automated tests for auth, authorization, validation, status lifecycle | `NFR-M-006` |

### 7.2 MVP boundary rules

- The MVP has **two roles**. An Admin role is not built (`D-001`).
- The MVP has **no notifications**, no email, no search engine, no dashboards.
  Note that this creates a delivery problem for company invitations, which is
  unresolved --- see `OQ-023`.
- The MVP stores **no file bytes in the database** (`D-005`).
- A recruiter joins a company by **invitation only**. There is no self-serve
  join and no company search (`D-009`, `FR-041`).
- A recruiter belongs to **exactly one** company. No company-level roles, no
  ownership transfer, no leaving or removal (`D-004`, `D-009`).
- Application status moves **only** as the transition map in 10.6.1 allows. No
  stage skipping, no moving backwards, no reopening a terminal state
  (`D-010`, `FR-070`, `FR-085`).
- A recruiter cannot mark an application `WITHDRAWN`; that outcome belongs to
  the candidate alone (`FR-086`).
- Authentication uses **server-side sessions**. No JWT access token and no
  refresh token in the MVP (`D-011`, `FR-095`). The session identifier is a
  reference to server state, not a credential the client can present and be
  believed (`FR-089`).
- Because the browser attaches session credentials automatically, **CSRF
  protection is mandatory**, not optional (`NFR-S-018`). The strategy is a
  Phase 1 design task.
- The codebase is **TypeScript** on both frontend and backend, with shared types
  for the API contract (`D-012`, `DC-010`). JavaScript is not the implementation
  language.
- **Types are not a security control.** Runtime validation and server-side
  authorization remain mandatory even though the code is fully typed
  (`NFR-M-009`, `R-24`). This is the single most important thing to remember
  about choosing TypeScript for a security-sensitive product.
- Every list endpoint is **bounded**. A list that could grow beyond a few
  hundred records must be paginated before it ships (`NFR-P-009`). Note that
  status history needs no pagination: the map caps it at 6 entries per
  application.
- Anything not in 7.1 is not started until the MVP is working.

### 7.3 Definition of done for the MVP

The MVP is done when, against a deployed instance with seeded demo data:

1. A candidate can register, complete a profile, upload a résumé, apply to a
   published job, and see the application with its status and history.
2. A recruiter can register, set up a company, publish a job, see the applicant,
   read the résumé, and change the status.
3. A second recruiter can be invited to that company, accept the invitation,
   and then publish and manage jobs for it --- while being unable to see any
   other company.
4. The candidate sees the new status and the new history entry.
5. Automated tests demonstrate that cross-company and cross-user access is
   rejected --- including that an unaccepted invitee has no access.
6. Automated tests demonstrate that every transition in 10.6.1 is accepted, and
   that each illegal transition is rejected: a skipped stage, a backward move, a
   recruiter setting `WITHDRAWN`, a candidate changing a status other than
   withdrawing, a withdrawal after `UNDER_REVIEW`, and any change to a terminal
   state.
7. Automated tests demonstrate the session properties specifically: after logout
   the identifier is rejected even when replayed; a session identifier issued
   before authentication is not accepted after it; a request with no valid
   session is rejected on a protected route; a state-changing request without
   CSRF proof is rejected **even though the session is valid**; and the session
   identifier does not appear in any response body or log line.
8. Lint, **type check**, test and build all pass --- where a build that only
   strips types without checking them does not count (`NFR-D-009`) --- and the
   deployment is documented.

---

## 8. V1

Added after the MVP works and is deployed. Grouped by theme.

### 8.1 Discovery

- Keyword search across job title, description and company (`FR-101`).
- Filter by location, employment type, skills, date posted (`FR-075`).
- Sorting by relevance / date / salary (`FR-076`).
- Full pagination controls on all list views (`FR-077`).
- Recruiter-side applicant search within their own company's jobs.

### 8.2 Notifications

- In-app notification when an application status changes (`FR-079`).
- Notification list with read / unread state (`FR-107`).
- Notification preferences (which events a user wants).

### 8.3 Account lifecycle

- Password reset by email (`FR-108`).
- Email verification at registration (`FR-109`).
- Change password while logged in.
- Optional profile visibility controls.

### 8.4 Recruitment depth

- Interview scheduling with a proposed slot and confirmation.
- Interviewer assignment and per-interviewer feedback.
- Private recruiter notes attached to an application.
- Offer details: salary, start date, expiry.
- Export an applicant list to CSV.
- Résumé upload audit trail: who accessed which résumé and when (`FR-112`).

### 8.5 Platform

- Application status transition rules exposed as an explicit, tested matrix,
  replacing the Phase 0 reference table with generated documentation from the
  same source the server enforces.
- A recruiter can see the company's recruiter list and the status of any pending
  invitation they issued.
- A recruiter can leave a company, or be removed by another recruiter of that
  company, resolving `OQ-015`.
- Company-level roles, if a real need appears (`OQ-015`).
- Basic analytics per job: application volume over time, status distribution.

---

## 9. Future Scope

Interesting, plausible, and explicitly **not** to be built yet.

| Item | Notes |
| --- | --- |
| **Admin / moderator role** | User suspension, job removal, dispute handling. Build when there is a real incident to handle (`OQ-018`). |
| **Multi-company recruiters** | Recruiter-to-company becomes many-to-many. The MVP model must not prevent this (`D-004`). |
| **Leaving and revoking company access** | A recruiter can resign from a company, and another recruiter can remove them. Invitations are in the MVP (`D-009`); the ability to undo a membership is not (`OQ-015`). |
| **Company-level roles** | Owner / admin / member distinctions within a company, with per-role permissions. Explicitly excluded from the MVP (`D-004`, `D-009`). |
| **Company directory and search** | Finding companies to join. Pointless while joining is invitation-only (`D-009`); needed only if self-serve joining is ever introduced. |
| **Company verification** | Verified badge, document upload, review queue. Requires the Admin role first. |
| **AI résumé parsing** | Extract structured skills and experience from the uploaded PDF for recruiter review. Must be assistive and explainable, never the sole basis for a decision. |
| **Candidate-job matching** | Score candidates against a job using skills and experience. Must be explainable to the candidate. |
| **Real-time updates** | Live applicant list and status push. REST stays authoritative. |
| **Email notifications** | Application received, status changed, interview scheduled. |
| **Saved jobs and saved searches** | Candidate-side alerts for new matching jobs. |
| **Recruiter analytics dashboards** | Funnel conversion, time-to-hire, source of applicants. |
| **Messaging** | Candidate-recruiter conversations tied to an application. High abuse potential. |
| **OAuth / social login** | Google and GitHub sign-in. |
| **Account deletion and data export** | Self-service. See `OQ-013`. |
| **Public recruiter profiles** | Agencies and personal recruiter brands. |
| **Multilingual / localisation** | UI and résumé content. |
| **Audit log across all entities** | Generalised beyond application status history. |
| **Rate-limited public API** | If the platform is exposed to third parties. |

---

## 10. Functional Requirements

Priority key: **MVP** = required for first usable deployment, **V1** = after
the MVP works, **Future** = not to be built yet.

### 10.0 ID conventions

| Range | Meaning |
| --- | --- |
| `FR-001`---`FR-095` | MVP requirements (sections 10.1---10.8) |
| `FR-101`---`FR-120` | V1 requirements (section 10.9) |
| `FR-201`---`FR-213` | Future requirements (section 10.10) |

**An ID is never reused or reassigned.** Requirement IDs are referenced from
design docs, code, tests and commits, so once an ID appears in this document it
keeps its meaning permanently.

This document has **intentional gaps** in the MVP range: `FR-014`, `FR-035`,
`FR-036`, `FR-042`, and `FR-071`---`FR-074`. Those requirements were
reclassified to V1 or Future during Phase 0 and now carry IDs in the `1xx` and
`2xx` blocks. The original IDs are **retired, not free for reuse** --- leaving a
gap is deliberate, because silently recycling `FR-071` for a different
requirement later would make old commits, tests and reviews misleading.

`FR-080`---`FR-095` were **appended** after the MVP block was first written:
`FR-080`---`FR-084` when decision `D-009` (invite-based company joining) was
taken, `FR-085`---`FR-087` when `D-010` (the application state machine) was
taken, and `FR-088`---`FR-095` when `D-011` (server-side sessions) was taken.
New requirements are always appended to the end of their priority block;
existing IDs are never renumbered to make room.

All non-functional, design-constraint, open-question, decision and risk IDs are
contiguous within their own prefix: `NFR-S-001`---`NFR-S-018`,
`NFR-P-001`---`NFR-P-010`, `NFR-R-001`---`NFR-R-008`,
`NFR-A-001`---`NFR-A-007`, `NFR-M-001`---`NFR-M-011`,
`NFR-SC-001`---`NFR-SC-005`, `NFR-O-001`---`NFR-O-005`,
`NFR-D-001`---`NFR-D-009`, `DC-001`---`DC-010`, `OQ-001`---`OQ-025`,
`D-001`---`D-012`, `R-01`---`R-25`.

Within a family, an ID is never renumbered and never reused; a new item takes the
next free number even if its row is not placed at the end of the table. `D-006`
is marked superseded rather than deleted, and the requirement IDs listed in
section 10.0 as intentionally retired are never reused either.

### 10.1 Accounts and authentication

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-001 | MVP | A visitor can browse published jobs and view job details without an account. |
| FR-002 | MVP | A visitor can register as a candidate, providing name, email and password. |
| FR-003 | MVP | A visitor can register as a recruiter, providing name, email, password and their company. |
| FR-004 | MVP | An email address identifies exactly one account; duplicate registration is rejected. |
| FR-005 | MVP | Passwords are never stored in plaintext and never appear in any API response. |
| FR-006 | MVP | A registered user can log in with valid credentials, which creates a server-side session (`FR-088`). |
| FR-007 | MVP | Invalid credentials return a generic message that does not reveal whether the email exists. |
| FR-008 | MVP | Missing or malformed credentials are rejected with a clear validation message. |
| FR-009 | MVP | An authenticated user can log out, after which the server-side session is invalidated and the session identifier no longer authenticates anything, including if it is replayed (`FR-092`). |
| FR-010 | MVP | Exactly one role is assigned at registration in the MVP. |
| FR-011 | MVP | Protected functionality rejects unauthenticated requests, established by resolving a valid server-side session on the server (`FR-091`). |
| FR-012 | MVP | Authorization is enforced on the server for every protected operation; hiding or disabling UI controls is not a security control. Authentication --- "who is this user?" --- and authorization --- "is this user allowed to do this?" --- are separate decisions made in that order. |
| FR-013 | MVP | A candidate cannot perform recruiter actions, and a recruiter cannot perform candidate-only actions. |
| FR-088 | MVP | Successful login creates a **server-side session record**. The client receives only an opaque session identifier and holds no authentication state of its own (`D-011`). |
| FR-089 | MVP | The session identifier is a random, opaque value that carries no identity, role, company or expiry information. Possessing it grants nothing on its own --- it is only a reference to server-side state, so it cannot be decoded, forged or edited to escalate privilege. |
| FR-090 | MVP | The session identifier is delivered only through a secure mechanism designed in Phase 1, is never readable by client-side JavaScript, is never returned in a response body, and is never written to logs (`NFR-S-003`). |
| FR-091 | MVP | Every protected request is authenticated **on the server** by resolving a valid, unexpired session record. Identity and role are derived from the user record the session points at, never from values supplied by the client, so a change of role takes effect without the user logging in again. |
| FR-092 | MVP | Logout invalidates the server-side session record immediately. The identifier stops authenticating at once, and a stale or replayed copy of it is rejected like any other invalid identifier. |
| FR-093 | MVP | Authentication state is revocable server-side at any time, without waiting for anything to expire, and revoking one session does not affect the user's other sessions. |
| FR-094 | MVP | A session identifier is issued **only after** successful authentication, and any identifier that existed before authentication is discarded. A session identifier must never be accepted before the credentials behind it have been verified (session-fixation defence). |
| FR-095 | MVP | The MVP issues no JWT access token and no refresh token, and no API response contains a bearer credential that a client could replay on its own (`D-011`). |

### 10.2 Candidate profile

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-015 | MVP | A candidate can view and edit their own profile. |
| FR-016 | MVP | A profile captures name, professional headline, location, summary, skills, experience entries and education entries. |
| FR-017 | MVP | A candidate can add, edit and remove skill entries. |
| FR-018 | MVP | A candidate can add, edit and remove experience entries (role, organisation, dates, description). |
| FR-019 | MVP | A candidate can add, edit and remove education entries (institution, qualification, dates). |
| FR-020 | MVP | Profile input is validated on the server for required fields, types, lengths and formats. |
| FR-021 | MVP | A candidate cannot read or modify another candidate's profile. |
| FR-022 | MVP | A candidate can see how complete their profile is, so they know what is missing before applying. |

### 10.3 Résumé

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-023 | MVP | A candidate can upload a résumé file for their own profile. |
| FR-024 | MVP | A candidate has at most one current résumé; uploading a new file replaces the previous one. |
| FR-025 | MVP | PDF is the supported format in the MVP; other formats are rejected with a clear message. |
| FR-026 | MVP | Upload size is capped at a documented maximum, enforced server-side. |
| FR-027 | MVP | File type is validated by inspecting file content, not only by the filename or the browser-supplied content type. |
| FR-028 | MVP | Résumé bytes are stored in external object storage and are **never** stored in the database. |
| FR-029 | MVP | The database stores only a reference to the stored file plus metadata: original filename, stored name, MIME type, byte size, upload timestamp. |
| FR-030 | MVP | A candidate can delete their own résumé; the stored file is removed and the reference is cleared. |
| FR-031 | MVP | A candidate can download their own résumé. |
| FR-032 | MVP | A recruiter can view or download the résumé of a candidate who has applied to a job belonging to the recruiter's company. |
| FR-033 | MVP | A recruiter cannot access the résumé of a candidate who has not applied to a job of their company. |
| FR-034 | MVP | Résumés are not publicly reachable by direct link; access requires an authorised request. |

### 10.4 Company

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-037 | MVP | A recruiter belongs to exactly one company. |
| FR-038 | MVP | A recruiter joining by **creating** a company provides its details: name, industry, location, website and description. That recruiter is associated with the new company. |
| FR-039 | MVP | A recruiter can view and edit their own company's information. |
| FR-040 | MVP | A recruiter cannot read or modify another company's information through the API. |
| FR-041 | MVP | A recruiter joins an existing company **only** by accepting an invitation from a recruiter who already belongs to that company (`D-009`). There is no self-serve join, and no way to join by naming a company. |
| FR-080 | MVP | A recruiter who belongs to a company can invite an already-registered user to that company, identifying them by email address. |
| FR-081 | MVP | Only a recruiter who already belongs to the company can issue an invitation for it, and only for their own company. |
| FR-082 | MVP | An invitation must be **accepted** by the invited user before they become a recruiter of that company. Until acceptance, the invitee gains no access to the company's jobs, applicants or résumés. |
| FR-083 | MVP | A user cannot accept an invitation while already belonging to a company, because a recruiter belongs to exactly one company in the MVP (`FR-037`). The behaviour when the invitee is an existing candidate is `OQ-021`. |
| FR-084 | MVP | An invitation can be **declined** by the invitee, and an invitation stops being valid once it is accepted, declined, or its expiry passes. The expiry period, the token mechanism and the precise authorization rules are designed in Phase 1 (`OQ-022`). |

### 10.5 Jobs

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-043 | MVP | A recruiter can create a job as a draft. |
| FR-044 | MVP | A job captures title, description, responsibilities, requirements, location, employment type, optional salary range and skill tags. |
| FR-045 | MVP | A recruiter can edit a job belonging to their own company, including while it is published. |
| FR-046 | MVP | A recruiter can publish their own company's job, making it visible to candidates. |
| FR-047 | MVP | A recruiter can close a published job; it stops accepting applications but its applications and history are retained. |
| FR-048 | MVP | A recruiter can reopen a closed job. |
| FR-049 | MVP | A recruiter cannot create, read, modify, publish or close a job owned by another company. |
| FR-050 | MVP | A published job displays the posting company, and the company profile lists its published jobs. |
| FR-051 | MVP | A job cannot be published unless its minimum required fields are present and valid. |
| FR-052 | MVP | Candidate-facing job listing shows published jobs only; drafts and closed jobs never appear. |
| FR-053 | MVP | A recruiter can list their own company's jobs with each job's status and application count. |
| FR-054 | MVP | A candidate can see which jobs they have already applied to, so they do not apply twice. |
| FR-055 | MVP | A candidate can apply to a published, open job. |

### 10.6 Applications and status lifecycle

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-056 | MVP | Applying records the candidate's profile and current résumé reference as they are at the moment of applying. |
| FR-057 | MVP | A candidate has at most one active application per job; a second attempt is rejected. |
| FR-058 | MVP | A new application starts in status `APPLIED`. |
| FR-059 | MVP | Application status is restricted to the controlled set: `APPLIED`, `UNDER_REVIEW`, `SHORTLISTED`, `INTERVIEW`, `OFFERED`, `HIRED`, `REJECTED`, `WITHDRAWN`. Arbitrary strings are rejected. |
| FR-060 | MVP | Every **successful** status change appends a history entry recording at least `previousStatus`, the new `status`, `changedBy` and `changedAt`. |
| FR-061 | MVP | Status history is append-only and immutable; existing entries are never modified, reordered or deleted, and it is visible to the candidate and to recruiters of the owning company. |
| FR-062 | MVP | A recruiter may change the status of an application only for a job owned by the recruiter's company, and only to a status the transition map allows for the current status (`FR-070`, `FR-085`). |
| FR-063 | MVP | A candidate may set their own application to `WITHDRAWN`, and only from `APPLIED` (`FR-070`). |
| FR-064 | MVP | A candidate cannot make any other status change. Once an application leaves `APPLIED` --- that is, once it reaches a recruiter-controlled status --- the candidate has no remaining status action on it, and no terminal state can be reopened (`FR-085`). |
| FR-065 | MVP | A candidate can list all their applications, each showing the job, current status and full status history. |
| FR-066 | MVP | A recruiter can list the applicants for a job belonging to their company, filterable by status. |
| FR-067 | MVP | A recruiter can open an applicant's profile and résumé from within the applicant list. |
| FR-068 | MVP | A recruiter cannot see, or change the status of, an application for another company's job. |
| FR-069 | MVP | A recruiter can see the number of applications per status for their own jobs. |
| FR-070 | MVP | The transition map in 10.6.1 is enforced **on the server**. A transition that is not in the map is rejected without writing a history entry, and the current status is left unchanged. |
| FR-085 | MVP | `HIRED`, `REJECTED` and `WITHDRAWN` are **terminal**. They have no outbound transitions in the MVP and cannot be reopened by anyone, including a recruiter. |
| FR-086 | MVP | A recruiter cannot set an application to `WITHDRAWN`. `WITHDRAWN` means only that the candidate chose to leave, so recruiter rejection and candidate withdrawal stay distinguishable in the data. |
| FR-087 | MVP | A status change is rejected if the application's current status is no longer the status the change was based on (compare-and-set). Two recruiters acting on the same application at the same time must not silently lose one of the changes. |

#### 10.6.1 Transition map (normative)

This table is the authoritative definition of the MVP application state
machine, from decision `D-010`. Anything not listed here is rejected by
`FR-070`.

| From | To | Permitted actor | Note |
| --- | --- | --- | --- |
| `APPLIED` | `UNDER_REVIEW` | Recruiter | First recruiter action. |
| `APPLIED` | `REJECTED` | Recruiter | |
| `APPLIED` | `WITHDRAWN` | **Candidate** | The candidate's only status action, and only on their own application. |
| `UNDER_REVIEW` | `SHORTLISTED` | Recruiter | |
| `UNDER_REVIEW` | `REJECTED` | Recruiter | |
| `SHORTLISTED` | `INTERVIEW` | Recruiter | |
| `SHORTLISTED` | `REJECTED` | Recruiter | |
| `INTERVIEW` | `OFFERED` | Recruiter | |
| `INTERVIEW` | `REJECTED` | Recruiter | |
| `OFFERED` | `HIRED` | Recruiter | |
| `OFFERED` | `REJECTED` | Recruiter | An offer may be declined, recorded as a rejection. |
| `HIRED` | --- | --- | **Terminal** (`FR-085`). |
| `REJECTED` | --- | --- | **Terminal** (`FR-085`). |
| `WITHDRAWN` | --- | --- | **Terminal** (`FR-085`). |

**Properties of this map, stated explicitly so that Phase 1 does not have to
infer them:**

- The forward path is a strict funnel: `APPLIED` → `UNDER_REVIEW` →
  `SHORTLISTED` → `INTERVIEW` → `OFFERED` → `HIRED`. **Stages cannot be
  skipped.** A recruiter cannot move an application straight from `APPLIED` to
  `INTERVIEW`.
- **There are no backward transitions.** An application cannot move from
  `INTERVIEW` back to `SHORTLISTED`, or from `SHORTLISTED` back to
  `UNDER_REVIEW`, even within the same company.
- `REJECTED` is reachable from every non-terminal status except `WITHDRAWN`.
- `WITHDRAWN` is reachable **only** from `APPLIED`, and **only** by the
  candidate. Once a recruiter has acted on an application, the candidate cannot
  withdraw it.
- The longest possible path is the full happy path, 5 transitions. So an
  application's history is inherently bounded at **6 entries** including
  creation, and no pagination of history is required in the MVP.
- Every non-terminal status except `APPLIED` is **recruiter-controlled**. Once
  an application leaves `APPLIED`, only a recruiter can move it.
- No transition is restricted to the recruiter who created the job. Any
  recruiter of the owning company may act (`FR-062`); the creating recruiter
  recorded on the job is provenance, not a permission.

**Authorization rules for transitions:**

1. A recruiter may change status only for applications belonging to jobs owned
   by the recruiter's company (`FR-062`, `FR-068`).
2. A candidate may set `WITHDRAWN` only on their own application, and only from
   `APPLIED` (`FR-063`).
3. A candidate cannot make any other status change, on any application
   (`FR-064`).
4. A recruiter cannot set `WITHDRAWN` (`FR-086`).
5. Candidates cannot change an application once it has reached a
   recruiter-controlled status (`FR-064`).
6. Terminal states cannot be reopened by anyone (`FR-085`).
7. Authorization is checked **before** the transition is validated as legal, so
   an unauthorized caller learns nothing about which transitions exist for an
   application they cannot see.

### 10.7 Discovery and listing (MVP)

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-075 | MVP | Candidates can browse published jobs, most recently posted first. |
| FR-076 | MVP | Job and applicant list endpoints return a bounded number of results; no list query is unbounded. |

### 10.8 Reliability of user-facing behaviour (MVP)

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-077 | MVP | Every list view handles loading, empty, error and success states explicitly. |
| FR-078 | MVP | A failed write shows the user what failed and leaves the interface in a consistent state. |
| FR-079 | MVP | Destructive actions (delete résumé, withdraw application, close job) require confirmation. |

### 10.9 V1 requirements

Added after the MVP is working and deployed. Grouped to match section 8.

| ID | Requirement |
| --- | --- |
| FR-101 | Candidates can search jobs by keyword across title, description and company. |
| FR-102 | Candidates can filter jobs by location, employment type, skill and date posted. |
| FR-103 | Job lists can be sorted by relevance, date posted and salary. |
| FR-104 | All growing lists provide pagination controls. |
| FR-105 | Recruiters can search and filter the applicant list of their own jobs. |
| FR-106 | A candidate receives an in-app notification when an application status changes. |
| FR-107 | A user can list notifications and mark them read or unread. |
| FR-108 | A user can reset a forgotten password using a single-use, expiring link. |
| FR-109 | A user can verify their email address and can be required to do so before sensitive actions. |
| FR-110 | A logged-in user can change their password, which invalidates existing sessions. |
| FR-111 | A candidate can control which profile sections are visible on an application. |
| FR-112 | Résumé access is recorded as an auditable event. |
| FR-113 | A recruiter can duplicate an existing job to create a similar one. |
| FR-114 | Recruiters can add private notes to an application, visible only within their company. |
| FR-115 | Interview scheduling supports proposing, confirming and rescheduling a slot. |
| FR-116 | Interviewers can be assigned to an application and submit feedback. |
| FR-117 | An offer can record salary, start date and expiry. |
| FR-118 | A recruiter can export the applicant list of their own job to CSV. |
| FR-119 | A recruiter can view per-job analytics: application volume over time and status distribution. |
| FR-120 | List views preserve filter and sort state in the URL, so a view can be shared or reloaded. |

### 10.10 Future requirements

Interesting and plausible, explicitly not to be built yet. Grouped to match
section 9.

| ID | Requirement |
| --- | --- |
| FR-201 | An authorised administrator can suspend or remove an account, and remove a job. |
| FR-202 | A user can register or log in through an external identity provider. |
| FR-203 | Résumé content is parsed automatically to suggest skills and experience, always requiring candidate confirmation. |
| FR-204 | Additional documents (cover letter, portfolio, work samples) can be attached. |
| FR-205 | Company verification, company-level roles and multi-company recruiters are supported. |
| FR-206 | Job postings are versioned so candidates can see when a live job was last changed. |
| FR-207 | Interview scheduling, interviewer feedback, offer negotiation, onboarding and background checks are supported as separate capabilities. |
| FR-208 | AI-assisted candidate scoring produces an explainable suggestion, never an automatic decision. |
| FR-209 | Candidates can save jobs and searches and be alerted to new matching jobs. |
| FR-210 | Email notifications are sent for application events. |
| FR-211 | Applicant list updates in real time without a page refresh. |
| FR-212 | Candidates and recruiters can exchange messages tied to an application. |
| FR-213 | A user can delete their account and export their personal data. |

---

## 11. Non-Functional Requirements

Targets are realistic for a single developer deploying to free-tier services.
They are measurable, but they are not enterprise SLAs.

### 11.1 Security

| ID | Requirement |
| --- | --- |
| NFR-S-001 | Every authorization decision is made on the server. Client-side checks are user-experience only. |
| NFR-S-002 | Passwords are hashed with a modern salted, deliberately slow algorithm. The specific algorithm is chosen in Phase 1. |
| NFR-S-003 | Passwords, password hashes, session identifiers and résumé contents are never written to logs. |
| NFR-S-004 | All input is validated server-side against an explicit schema. Unknown fields are rejected or explicitly ignored --- never passed through. |
| NFR-S-017 | The request body size is capped globally, at a limit comfortably above the largest legitimate payload, so an oversized or malicious body is rejected before it is parsed. Upload routes use their own explicit, documented limit (`FR-026`). |
| NFR-S-005 | All secrets come from environment variables. No secret is committed. `.env.example` documents every variable. |
| NFR-S-006 | CORS allows only the known frontend origin(s). Credentials are not allowed from arbitrary origins. |
| NFR-S-007 | Security headers are set: content-type sniffing protection, clickjacking protection, a content security policy, referrer policy, and HSTS in production. |
| NFR-S-008 | Rate limiting is applied to authentication endpoints, registration, uploads and other write endpoints. |
| NFR-S-009 | Uploaded files are validated by content, size-capped, stored outside any web-servable path, and delivered only through an authorised, time-limited request. Untrusted content is never rendered inline in the application origin. |
| NFR-S-010 | All database access goes through the ODM's query API. No query is built by string concatenation of user input. |
| NFR-S-011 | Production error responses contain a safe message and a correlation id. No stack traces, query text, or internal identifiers. |
| NFR-S-012 | Data exposure is minimised: API responses return only fields the caller needs; listing endpoints do not return full documents. |
| NFR-S-013 | Authentication state is revocable server-side. Logging out invalidates server-side state, not just a client token, and no request is authenticated by a credential the client can replay without the server checking live state (`FR-088`---`FR-095`). |
| NFR-S-014 | Ownership scoping is applied inside the database query --- filtering after retrieval is not acceptable for tenant or company data. |
| NFR-S-015 | Authorization is centralised in reusable middleware, and each protected route has a negative test proving the denied case. |
| NFR-S-016 | Personally identifiable data is retained only as long as needed, and the retention position is documented before public launch. Session records are deleted when they expire or are revoked, not retained indefinitely --- the cleanup mechanism is designed in Phase 1. |
| NFR-S-018 | Because a browser attaches session credentials automatically, every state-changing request must be protected against cross-site request forgery. A request that arrives without proof that it was initiated from the application is rejected regardless of how valid the session is. The specific strategy is designed in Phase 1, but it is not optional: it is the price of server-side sessions (`D-011`, `R-21`). |

### 11.2 Performance

| ID | Requirement |
| --- | --- |
| NFR-P-001 | Public job list and job detail pages render usable content within 2.5 seconds on a mid-range device over a typical deployment network. |
| NFR-P-002 | API read endpoints respond within 500 ms at the 95th percentile under expected demo load. |
| NFR-P-003 | Writes --- including résumé upload --- complete within 3 seconds at the 95th percentile, excluding client file selection time. |
| NFR-P-004 | No database query is unbounded. Every list query applies an explicit limit, and pagination beyond a defined threshold. |
| NFR-P-010 | No list endpoint returns more than **100 records** by default. This cap is enforced in request validation, not left to each handler, so it cannot be forgotten. A higher maximum is a deliberate, reviewed change. |
| NFR-P-005 | Indexes exist for every field used to look up, filter or sort, including compound indexes in an order justified by real query patterns. |
| NFR-P-006 | No N+1 access patterns. Related data is fetched with deliberate population or aggregation, and the number of populated relations is bounded. |
| NFR-P-007 | Frontend routes are code-split; the initial route bundle stays under 300 KB gzipped. |
| NFR-P-008 | Résumé files are streamed or downloaded, never embedded in a JSON API payload. |
| NFR-P-009 | No image or asset is shipped unoptimised. |

### 11.3 Reliability

| ID | Requirement |
| --- | --- |
| NFR-R-001 | Errors are handled centrally. An unexpected error returns a safe response and is logged with context; it does not crash the process. |
| NFR-R-002 | A failed or abandoned upload leaves no orphaned database record and no orphaned stored file. |
| NFR-R-003 | A status change and its history entry either both persist or neither does, and an illegal transition persists neither. The mechanism is decided in Phase 1 (`OQ-010`, free-tier transaction support). |
| NFR-R-004 | Database connection uses retry with backoff on startup, and a health endpoint reports connectivity. |
| NFR-R-005 | No user data depends on ephemeral container or instance storage. A redeploy cannot lose data. |
| NFR-R-006 | A backup and restore procedure for the deployed database is documented. |
| NFR-R-007 | The interface never fails silently. Every error state is visible to the user with a way forward. |
| NFR-R-008 | Concurrent conflicting writes --- for example two recruiters changing one application's status --- result in one consistent outcome, not a silently lost update. For status changes this means compare-and-set on the current status (`FR-087`), and the loser is told to reload rather than being shown a success that did not persist. |

### 11.4 Accessibility

| ID | Requirement |
| --- | --- |
| NFR-A-001 | Core flows --- browse a job, apply, manage an application --- target WCAG 2.1 AA. |
| NFR-A-002 | Semantic HTML, labelled form controls, full keyboard operability, and a visible focus indicator. |
| NFR-A-003 | Text and meaningful interface elements meet AA contrast ratios. |
| NFR-A-004 | Every image has a text alternative, or is explicitly marked decorative. |
| NFR-A-005 | Validation errors are associated with their field and announced to assistive technology. |
| NFR-A-006 | Status is never communicated by colour alone; a text label is always present. |
| NFR-A-007 | The application is usable at 320 CSS pixels wide. |

### 11.5 Maintainability

| ID | Requirement |
| --- | --- |
| NFR-M-001 | Clear module separation: routing, request handling, business logic, data access and validation are distinct responsibilities. |
| NFR-M-002 | Route handlers orchestrate; they do not contain business rules. |
| NFR-M-003 | All frontend API access goes through one service layer. Components do not construct requests. |
| NFR-M-004 | Code is explicit and simple. No speculative abstraction, no design pattern without a named problem it solves here. |
| NFR-M-005 | Linting and formatting are enforced automatically and run in CI. |
| NFR-M-006 | Authentication, authorization, validation, the status lifecycle and résumé access have automated tests covering both success and failure cases. |
| NFR-M-007 | Significant decisions are documented with the alternatives considered and the reason for the choice. |
| NFR-M-008 | No dead code. A deletion is justified by checking references and running tests. |
| NFR-M-009 | Every boundary --- HTTP, database, file storage --- is validated **at runtime**, regardless of the static types in use. TypeScript types are erased when the code runs, so they cannot validate an attacker's request body or authorise an operation (`R-24`). A type is documentation and a compile-time aid; it is never the enforcement mechanism. |
| NFR-M-010 | No fake implementation. Mocked behaviour is labelled as a mock in code and in documentation. |
| NFR-M-011 | Static types are treated as an aid, never as enforcement (`NFR-M-009`, `R-24`). `any`, a type assertion (`as`) or a suppressed error must not be used to silence a type error that is actually reporting a modelling mistake, and types must not be used to justify skipping a runtime check. The strictness level is set explicitly in Phase 1 rather than left at a default (`R-25`). |

### 11.6 Scalability

| ID | Requirement |
| --- | --- |
| NFR-SC-001 | The application tier holds no required session state on local disk, so it can run on free-tier PaaS and scale horizontally if needed. |
| NFR-SC-002 | File storage is external, so instances are interchangeable. |
| NFR-SC-003 | The design leaves room for a cache and a background job queue, but the MVP requires neither. |
| NFR-SC-004 | Optimisation is driven by an observed bottleneck, not by speculation. |
| NFR-SC-005 | The data model avoids design decisions that would make later growth unnecessarily expensive --- for example a recruiter-to-company model that cannot become many-to-many. |

### 11.7 Observability

| ID | Requirement |
| --- | --- |
| NFR-O-001 | Structured logs with a timestamp, level, request correlation id and event name. |
| NFR-O-002 | Errors are logged server-side with enough context to diagnose them, and never with secrets or personal data. |
| NFR-O-003 | A health endpoint exists for uptime checks and reports database connectivity. |
| NFR-O-004 | Unhandled exceptions and rejections are captured by an error-tracking service or an equivalent, without leaking secrets. |
| NFR-O-005 | Non-2xx responses are logged, so failures are visible without a debugger. |

### 11.8 Deployment

| ID | Requirement |
| --- | --- |
| NFR-D-001 | The application deploys to free-tier services and the process is documented in `docs/deployment.md`. |
| NFR-D-002 | All configuration is supplied by environment variables, and `.env.example` matches the variables the code actually reads. |
| NFR-D-003 | Frontend and backend deploy and can be updated independently. |
| NFR-D-004 | CI runs lint, tests and build on every push, and a red build blocks merging. |
| NFR-D-005 | Production is served over HTTPS only, with HSTS. |
| NFR-D-006 | A seed script provides realistic demo data for reviewers, and is clearly separated from any production path. |
| NFR-D-007 | No secret appears anywhere in the repository or its history. |
| NFR-D-008 | Database backups exist and a restore has been attempted at least once. |
| NFR-D-009 | Type checking runs in CI and a type error blocks merging (`NFR-D-004`). A build that merely strips types without checking them does not count as a passing build --- a transpile-only step would let type errors reach production while the pipeline stays green (`D-012`). |

### 11.9 Design constraints carried into Phase 1

These come directly from the Phase 0 decisions and constrain the architecture
without deciding it:

| ID | Constraint | From |
| --- | --- | --- |
| DC-001 | The role model must permit a third role (for example Admin) to be added later without redesigning stored data or rewriting authorization logic. | `D-001` |
| DC-002 | Résumé file bytes must never be written to the database. | `D-005` |
| DC-003 | Application status must be a closed enumerated set with an explicit, server-enforced transition map --- never a free-text field. | `D-003` |
| DC-004 | Recruiter-to-company is many-to-one in the MVP and must remain extensible to many-to-many. | `D-004` |
| DC-005 | Company scoping must be part of the database query, not a post-retrieval filter. | `D-004`, `NFR-S-014` |
| DC-006 | No global client-side state store unless a real application-wide requirement justifies it. | AGENTS.md §19 |
| DC-007 | The authorization layer must be centralised, not reimplemented per route. | `NFR-S-015` |
| DC-008 | Company membership must be representable as pending, accepted or absent, so that an invitation is a first-class state rather than a boolean flag. | `D-009` |
| DC-009 | Session state must live in a store **shared by every application instance** --- the database or an equivalent shared service --- never in the memory of a single process. An in-process session store is excluded, because it would log every user out on restart or deploy and would prevent more than one instance from running. | `NFR-SC-001`, `D-011`, `R-22` |
| DC-010 | The API's request and response shapes are defined once as shared TypeScript types consumed by both frontend and backend, so a contract change is a compile error on both sides rather than a runtime surprise. How those shared types are organised --- workspace layout, package boundaries, path aliases --- is a Phase 1 decision. | `D-012`, `NFR-M-001` |

---

## 12. Risks

Product and delivery risks. Each has a mitigation; residual risk is stated
honestly.

| ID | Risk | Impact | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| R-01 | **Scope creep.** The status set invites interview scheduling, offers and analytics, which turns the MVP into an ATS. The invitation flow invites roles, revocation and a team dashboard. | High | MVP is defined in section 7 only. `FR-115`---`FR-119` and section 9 are explicitly deferred. Invite-based joining is held to the minimum in `FR-080`---`FR-084`; see `R-17`. The phase gate stops work. | Medium --- requires ongoing discipline. |
| R-02 | **Untrusted résumé uploads.** A malicious or malformed file could be used for malware hosting, content-type confusion, or denial of service. | High | `NFR-S-009`: content-based type validation, hard size cap, private external storage, authorised time-limited delivery, no inline rendering of untrusted content, rate limiting on upload. | Medium --- PDFs can carry active content. Production would add malware scanning and serve files from a separate origin. |
| R-03 | **Personal data exposure.** Résumés and profiles are sensitive; leaking them is the most damaging realistic failure. | High | `NFR-S-014`, `NFR-S-016`, `FR-033`, `FR-034`, `NFR-S-003`, `NFR-S-012`. | Medium --- access-log auditing is deferred to V1 (`FR-112`), so early misuse may go undetected. |
| R-04 | **Authorization defects.** A bug that lets one recruiter see another's applicants is the worst bug this product can have. | High | Centralised middleware (`NFR-S-015`), query-level scoping (`DC-005`), and an explicit negative test per protected route. | Low --- if the negative tests are actually written. |
| R-05 | **Free-tier limits.** Database size, storage quota, build minutes, memory and cold starts can all fail during a demo. | Medium | Cap résumé size, one résumé per candidate, bound all lists, measure quotas, keep a documented fallback. | Medium --- quota exhaustion is possible under an unexpected demo load. |
| R-06 | **No email provider decided.** Password reset and email verification are blocked, and a public deployment without password reset is a genuine usability gap. | Medium | `OQ-006` is marked as blocking for the V1 plan; the MVP deliberately does not advertise password reset. | Worsened by `D-009` --- invitations also want an email channel. See `R-15` and `OQ-023`. |
| R-07 | ~~**Ambiguous company-join model.**~~ **RESOLVED** by `D-009`: joining a company is invite-based. | --- | Answered in Phase 0. Requirements `FR-041`, `FR-080`---`FR-084` now define the behaviour. | Closed, but see `R-15` and `R-16` for what the decision introduced. |
| R-08 | **Transaction support on the target database tier.** Status change plus history entry must be atomic (`NFR-R-003`), but multi-document transactions may not be available on all free tiers. | Medium | Verify the deployed tier in Phase 1; design so the write is safe without transactions if necessary. | Medium until verified. |
| R-09 | **Empty demo state.** A reviewer who sees no jobs and no applicants concludes the product is broken. | Medium | `NFR-D-006` seed script with realistic demo data. | Low. |
| R-10 | **Public deployment collecting real personal data.** A publicly reachable demo may attract real users and real résumés. | Medium | Document that the deployment is a demo; keep retention minimal; resolve `OQ-013` before promoting it publicly. | Medium. |
| R-11 | **Unbounded lists degrade quickly and look broken.** | Low | `NFR-P-004`, `NFR-P-005`, `FR-076`. | Low. |
| R-12 | **Learning-curve overload.** Too much infrastructure too early can stall the project. | Medium | `NFR-M-004` simple-code rule; the MVP avoids queues, caches, microservices and a design-system build. Worsened somewhat by `D-012`, since a typed build adds tooling that must also be learned. | Low --- manageable, because the tooling is standard rather than exotic. |
| R-13 | **Documentation drift.** Requirements are written now; the code arrives over many phases. | Medium | Requirement IDs are referenced from code and tests, and the phase gate requires re-checking this document. Type errors surface contract drift early (`D-012`, `DC-010`), which helps here. | Medium. |
| R-14 | **A previous over-scoped Phase 0 attempt exists in Git history** (commit `8900570`) with an architecture the current plan does not endorse. Reading from it by mistake could reintroduce unapproved decisions. | Low | Those documents are deleted in this phase and are not a source of truth. This document is. | Low. |
| R-15 | **Invitations have no delivery channel in the MVP.** Invite-based joining normally means emailing the invitee, but no email provider is decided (`OQ-006`) and in-app notifications are deferred to V1 (`D-007`). The invitee may have no way to learn that they were invited. | High | Recorded as blocking `OQ-023`, with three concrete options, before Phase 1 is finalised. | Medium --- resolvable, but it may force an email dependency into the MVP. |
| R-16 | **Inviting an existing candidate conflicts with the single-role model.** `FR-004` allows one account per email and `FR-010` assigns one role, so a registered candidate who accepts an invitation has nowhere to go. | Medium | Recorded as blocking `OQ-021`. Options are converting the account to recruiter, or supporting multiple roles. | Medium --- changes the role model, so it must be decided in Phase 1, not discovered in Phase 4. |
| R-17 | **The MVP grew.** Invite-based joining adds an invitation lifecycle, a pending state, a decline path and an expiry path --- scope that a self-serve join would not have needed. | Medium | Kept deliberately minimal: one invitation type, no roles, no revocation, no company directory. The 7.1 feature set was not otherwise expanded. | Medium --- Phase 1 must not treat "we have invitations now" as licence to build a team-management system. |
| R-18 | **Unauthenticated or unaccepted invitation access.** If an invitation is a bearer token in a URL, leaking or guessing it could grant company access. | High | `FR-082` grants no access before acceptance. Tokens must be single-use, random, expiring and compared in constant time --- designed in Phase 1 (`OQ-022`), covered by `NFR-S-009` principles. | Medium until Phase 1 designs the token. |
| R-19 | **The state machine is deliberately rigid, and rigidity can be wrong.** Stages cannot be skipped or reversed, and a candidate cannot withdraw an application that is already under review --- so a candidate who accepts another offer mid-process has no way to signal that. A recruiter who mis-clicks a stage has no undo. | Medium | The rigidity is the decision (`D-010`), and it buys a testable, auditable funnel. Every illegal transition is covered by a negative test (definition-of-done item 6), so the rule is at least enforced consistently. | Medium --- likely to produce recruiter workflow friction in a real deployment. Reversibility (`OQ-024`) is the first thing to revisit. |
| R-20 | **Map and implementation can drift.** If the transition map lives in documentation while the server hard-codes something slightly different, the documentation becomes a lie. | Medium | The map is normative (10.6.1) and `FR-070` requires the server to enforce it; Phase 1 should hold the map in a single source and derive both the validation and the tests from it. | Low if a single source is used; High if the map is transcribed by hand into two places. |
| R-21 | **Server-side sessions create a cross-site request forgery surface that a bearer-token design does not have.** A browser attaches session credentials automatically, so another site can make the user's browser send authenticated requests. A session design is only as safe as its CSRF defence, and a missing or misconfigured CSRF check is a silent, total authentication bypass. | High | `NFR-S-018` makes CSRF protection mandatory, `FR-091` requires server-side resolution on every protected request, and the definition of done requires a test proving a state-changing request without CSRF proof is rejected even with a valid session. The strategy is designed in Phase 1 and must be chosen before any endpoint ships. | Medium if the Phase 1 strategy is chosen deliberately and tested; **High if sessions ship before CSRF protection exists.** This is the single risk that `D-011` introduces. |
| R-22 | **The session store becomes shared state on the hot path.** Every authenticated request reads session state, so the store is a latency and availability dependency for the whole application. If sessions are kept in process memory, every deploy or restart logs out every user and the app cannot run more than one instance. Expired records also accumulate forever unless something removes them. | Medium | `DC-009` requires a store shared by all instances and excludes in-process memory, which also keeps `NFR-SC-001` satisfiable on free-tier hosting. `NFR-S-016` requires expired and revoked sessions to be deleted, not retained. The exact store, its cleanup mechanism and its index are Phase 1 design tasks. | Low-medium. The load is one indexed lookup per authenticated request, which is comfortable at MVP scale; the real cost is the discipline of actually expiring records. |
| R-23 | **Logout and revocation are only as good as every path that ends a session.** If any code path marks a session invalid in one place but not another --- or if an expired record is still honoured --- then "revocable authentication state" becomes a claim rather than a fact, and the Phase 0 decision `D-011` would be quietly untrue. | Medium | `FR-092` requires immediate invalidation including on replay, `FR-093` requires revocation without waiting for expiry, and definition-of-done item 7 tests the replay case explicitly. Revocation is centralised rather than reimplemented per route (`DC-007`). | Low if the tests in item 7 are written. The realistic failure is skipping those tests, not a subtle bug. |
| R-24 | **Static types are erased at runtime, so TypeScript can create false confidence.** A type annotation disappears when the code executes. It cannot validate a request body from an attacker, enforce an authorization rule, or stop a malformed document entering the database. A developer who trusts the types may skip the runtime checks that are the actual security boundary --- and the code will look correct while compiling. | High | `NFR-M-009` requires runtime validation at every boundary *regardless* of static types, `NFR-M-011` forbids treating types as a substitute for checks, and `NFR-M-006` requires failure-case tests. The transition map (10.6.1) and the authorization rules are enforced by code that does not depend on types. | Medium --- the risk is behavioural, not technical. It is avoided by discipline and by tests, and a reviewer reading only the type signatures would not see the problem. |
| R-25 | **A codebase full of `any` and type assertions is worse than plain JavaScript, because it looks checked while guaranteeing nothing.** Every `any`, every `as`, and every suppressed error buys compilation at the cost of the actual safety net. TypeScript's structural typing also lets two unrelated shapes with the same fields stand in for each other, so a mismatched payload can pass unnoticed. Relaxed strictness makes the whole benefit cosmetic. | Medium | `NFR-M-011` forbids `any` and assertions as a way to silence a type error that reveals a real modelling problem, `NFR-M-005` enforces linting, and `NFR-D-009` makes a type error block merging. The strictness level is an explicit Phase 1 decision rather than an unexamined default. | Low-medium with strict mode on and unchecked escapes forbidden by lint; High if `strict` is off or `any` spreads. |

---

## 13. Open Questions

To be answered before or during Phase 1. **Blocking** means Phase 1
architecture should not be finalised until it is answered.

### 13.1 Resolved

| ID | Question | Resolution |
| --- | --- | --- |
| OQ-001 | How does a second recruiter join a company in the MVP? | **RESOLVED --- invite-based joining.** The first recruiter creates the company; an existing recruiter of that company invites an already-registered user; the invitee must accept before becoming a recruiter of that company. No self-serve join, no joining by naming a company. See `D-009`, `FR-041`, `FR-080`---`FR-084`. Raised `OQ-021`, `OQ-022` and `OQ-023` as a result. |
| OQ-002 | Which application status transitions are legal, and who may perform them? | **RESOLVED --- fixed transition map.** The normative map is **10.6.1**: a strict forward funnel with `REJECTED` reachable from every non-terminal status, `WITHDRAWN` reachable only from `APPLIED` and only by the candidate, no backward moves, and `HIRED` / `REJECTED` / `WITHDRAWN` terminal. Seven authorization rules accompany it. See `D-010`, `FR-070`, `FR-085`, `FR-086`, `FR-087`. Raised `OQ-024` as a result. |
| OQ-004 | JavaScript or TypeScript? | **RESOLVED --- TypeScript.** TypeScript is used for the frontend, the backend, and shared types and utilities where appropriate. JavaScript is not the primary implementation language. Strictness, `tsconfig` settings, build tooling, module system and the exact frontend/backend setup are Phase 1 decisions. Critically, types are **not** treated as a substitute for runtime validation or server-side authorization, because they are erased at runtime. See `D-012`, `DC-010`, `NFR-M-009`, `NFR-M-011`, `NFR-D-009`. No new open question was raised. |
| OQ-003 | What is the authentication mechanism? | **RESOLVED --- server-side sessions.** Successful login creates a session record on the server; the client receives only an opaque session identifier and holds no authentication state of its own. Logout invalidates that server-side state, the state is revocable server-side at any time, every protected request verifies the session on the server, and authorization remains a separate decision made afterwards. No JWT access token and no refresh token in the MVP. Session storage, cookie configuration, expiry and idle timeout, CSRF strategy and session cleanup are Phase 1 design tasks. See `D-011`, `FR-088`---`FR-095`, `DC-009`, `NFR-S-013`, `NFR-S-018`. Raised `OQ-025` as a result. |

### 13.2 Open

| ID | Question | Blocks | Why it matters |
| --- | --- | --- | --- |
| OQ-005 | **Which object storage provider, and how are files delivered** --- signed URL, or proxied stream through the backend? | **Phase 1** | Required by `D-002` / `FR-028`---`FR-034`. Also determines free-tier cost and the résumé access-control implementation. |
| OQ-006 | **Is there an email provider, and are password reset / email verification MVP or V1?** | V1 planning | `FR-108`, `FR-109` depend entirely on this. See `R-06`. |
| OQ-007 | **What is the maximum résumé size, and is DOCX supported later?** | **Phase 1** | `FR-025`, `FR-026` need concrete numbers. |
| OQ-008 | **Is salary range required, optional, or omitted?** Some regions treat it as legally sensitive. | Phase 1 | `FR-044` currently treats it as optional. |
| OQ-009 | **What is the job status set?** Draft / Published / Closed is assumed. Is a `PAUSED` state needed, and are edits to a live job versioned for candidates? | Phase 1 | `FR-039`---`FR-044`, `FR-206`. |
| OQ-010 | **What happens to live applications when a job is closed?** Retained and visible to the recruiter, with no new applications accepted --- currently assumed. And can a closed job be reopened with applications intact? | Phase 1 | `FR-047`, `FR-048`. |
| OQ-011 | **Must a candidate meet a minimum profile completeness to apply?** Currently unspecified. | Phase 1 | Affects `FR-022` and the apply flow. |
| OQ-012 | **Can one person hold both roles?** Currently one role per account, so a recruiter cannot also apply as a candidate. | Phase 1 | `FR-010`. Closely tied to `OQ-021`: if an existing candidate can accept an invitation, the single-role rule is what blocks them. |
| OQ-013 | **Is self-service account deletion and data export required before a public launch?** | Before public launch | `NFR-S-016`, `R-10`. A real obligation in many jurisdictions. |
| OQ-014 | **Is one email allowed to register twice?** Currently no: one account per email (`FR-004`). | Phase 1 | Blocks `OQ-012` and `OQ-021`. |
| OQ-015 | **Can a recruiter leave a company, or be removed by another recruiter of that company?** Currently neither. | Phase 1 | `D-009` makes this concrete: invitations can be issued and declined, but a mistaken acceptance is currently irreversible. Listed in section 8.5 as V1. |
| OQ-016 | **Must company names be unique?** | Phase 1 | **Downgraded from blocking.** With invite-based joining (`D-009`) a joiner never types or searches a company name, so uniqueness is no longer needed for correctness --- only for clarity. A soft "name already in use" warning is probably sufficient; a unique index is not required. |
| OQ-017 | **What triggers building the Admin role?** | Future | `OQ-018`; keep this as an explicit revisit condition. |
| OQ-018 | **Which free-tier services will be used for hosting, database, storage and email?** | Phase 1 / Phase 16 | Constrains transactions, storage, cold starts and cost (`R-05`, `R-08`). |
| OQ-019 | **Can a recruiter add a private note per application, and is a reason captured when moving to `REJECTED` or `WITHDRAWN`?** The transition map fixes *when* a change is allowed but not what else is recorded with it. | V1 | Affects whether the history entry needs a free-text or reason field now or later. `D-010` deliberately did not decide this, to avoid reworking the history record. |
| OQ-020 | **What are the abuse limits for public registration and application submission, and for issuing invitations?** | Phase 1 | Sets concrete rate-limit values for `NFR-S-008`. |
| OQ-021 | **What happens when an already-registered *candidate* accepts a company invitation?** `FR-004` allows one account per email and `FR-010` assigns exactly one role, so a candidate who accepts has nowhere to go. Options: (a) accepting converts the account to Recruiter, and candidate access is lost; (b) accounts may hold both roles, relaxing `FR-010`; (c) only accounts that registered *as recruiters* can be invited, which makes candidate-to-recruiter promotion impossible. | **Phase 1** | Changes the role model itself, so it must be settled in Phase 1 rather than discovered during Phase 4. Affects `FR-010`, `FR-080`, `FR-083`. See `R-16`. |
| OQ-022 | **What is the invitation token mechanism and expiry?** Random single-use token, expiry period, whether it is emailed or shown in-app, whether re-inviting after decline is allowed, and how many pending invitations may exist. | **Phase 1** | The user directed that token handling, expiry and exact authorization rules be designed in Phase 1. `FR-084` states the required behaviour without fixing the mechanism. See `R-18`. |
| OQ-023 | **How is an invitation delivered to the invitee in the MVP, given that the MVP has no email and no notifications?** Options: (a) pending invitations are listed in-app on the invitee's own account, and they see them when they log in; (b) the MVP takes an email dependency, contradicting `D-007` and pulling `OQ-006` forward; (c) the inviter is responsible for passing the invitation on out of band, which is weak but dependency-free. | **Phase 1** | Invite-based joining is unusable if the invitee never learns they were invited. Option (a) is the smallest thing that works, but it is arguably a minimal in-app notification, which `D-007` defers. See `R-15`. |
| OQ-024 | **Should any transition become reversible, should a candidate be able to withdraw after `UNDER_REVIEW`, and may a candidate re-apply after withdrawing?** `D-010` makes the map one-directional and gives the candidate an exit only from `APPLIED`. Options: allow `REJECTED` → re-open into a non-terminal status for the same company; allow a recruiter-set "cancelled" outcome distinct from `REJECTED`; allow candidate withdrawal from any non-terminal status; allow a new application after a withdrawn or rejected one; or keep it exactly as decided. | Future | Real deployments will hit all three frictions in `R-19`. Reversibility also weakens the audit story, so it should be a conscious trade rather than an accident. Candidate withdrawal after review is arguably a **data-protection** question, not only a UX one, because the candidate is declining to have their data processed further. The re-apply sub-question is a gap `D-010` exposed: `FR-057` limits a candidate to one *active* application per job, but `D-010` makes `WITHDRAWN`, `REJECTED` and `HIRED` terminal, so whether a terminal application frees the candidate to apply again is currently undefined. It needs an explicit answer in Phase 1 either way, because "active" is currently doing undefined work. |
| OQ-025 | **May a user hold several concurrent sessions, and does logging in revoke the ones already open?** With server-side sessions this becomes a real product question, because there is now a list of live sessions per user that can be inspected and revoked. Options: allow N concurrent sessions across devices; allow unlimited; revoke all previous sessions on each login (single-device); or show the user their active sessions and let them revoke individual ones ("log out other devices"). | **Phase 1** | `D-011` made sessions first-class server state, so this had to be answered *somewhere*. It affects the session record shape, whether a device/session list is shown, and whether `FR-110` (password change invalidates sessions) means all sessions or all but the current one. Not raised as blocking because the MVP can ship with any of the four behaviours; it is a Phase 1 design choice with a product dimension. |

### 13.3 Deliberately not decided in Phase 0

The following are Phase 1 decisions and were intentionally left open. This
list exists so that a later phase does not mistake silence for approval.

- **TypeScript implementation details.** The *language* is decided (`D-012`,
  TypeScript everywhere); these specifics are not, and are Phase 1 design tasks:
  - the strictness level and which compiler flags are enabled --- this is the
    setting that decides whether the types are worth anything (`R-25`);
  - the module system and compilation target;
  - build tooling, and for the frontend whether a bundler is used and whether it
    type-checks or only strips types (`NFR-D-009`);
  - whether the frontend and backend share one TypeScript configuration or have
    separate ones;
  - how shared contract types are organised --- workspace layout, package
    boundaries, path aliases (`DC-010`);
  - how third-party libraries without type declarations are handled;
  - whether tests are written in TypeScript, and how test fixtures are typed.
- **Session implementation details.** The *mechanism* is decided (`D-011`,
  server-side sessions); these specifics are not, and are Phase 1 design tasks:
  - where session records are stored, subject to `DC-009` (shared store, not
    process memory);
  - how the session identifier is transported and the exact cookie
    configuration;
  - absolute expiry and idle timeout;
  - the CSRF protection strategy (`NFR-S-018` makes it mandatory, not optional);
  - how expired, revoked and abandoned session records are cleaned up.
- Frontend and backend frameworks, routers, data-fetching and styling
  libraries.
- Test framework and assertion library.
- Object storage, email and hosting providers.
- Database collection and field design, index definitions, embedding versus
  referencing.
- API URL structure, response envelope, error format, pagination style.
- Folder structure, module boundaries, middleware pipeline order.
- Monorepo versus two separate packages.
- Whether the job and application lifecycles are modelled as embedded
  documents or referenced collections.

---

## 14. Phase 0 Decision Log

Decisions confirmed by the developer during Phase 0. These are **product**
decisions. Each one constrains Phase 1 without dictating it.

| ID | Decision | Rationale | Consequence |
| --- | --- | --- | --- |
| D-001 | **Two roles only in the MVP: Candidate and Recruiter.** No Admin role is implemented. Admin functionality is documented as future scope. | No MVP workflow needs moderation; an admin surface would add a role, a permission tier, screens and tests that nothing uses. | `FR-201` is Future. `DC-001` requires the role and permission model to accept a third role later without a redesign. |
| D-002 | **Résumé upload is in the MVP.** One current résumé per candidate. PDF is the primary supported format. The candidate can replace and delete it. Recruiters can access the résumé of candidates who applied to their jobs. Files are stored in external object storage, never in MongoDB; the database holds a reference plus metadata. File type and size are validated. No AI parsing. The storage provider is deferred to Phase 1. | A résumé is the core artefact of recruitment; without real file handling the product is a demo. Keeping bytes out of the database avoids document-size limits and keeps the database concerned with records. | `FR-022`---`FR-033`, `DC-002`, `NFR-S-009`, `OQ-005`, `OQ-007`; `FR-203` is Future. |
| D-003 | **Application status uses controlled enum values, not arbitrary strings:** `APPLIED`, `UNDER_REVIEW`, `SHORTLISTED`, `INTERVIEW`, `OFFERED`, `HIRED`, `REJECTED`, `WITHDRAWN`. The MVP also keeps status history recording at least status, `changedAt` and `changedBy`. No complex interview stages, offer negotiation, onboarding, background checks or AI scoring. | A closed set is testable and prevents meaningless values; history makes the process auditable and answers the candidate's real question. | `FR-059`, `FR-060`, `FR-061`, `DC-003`; `FR-207` is Future. **Superseded in part by `D-010`**, which fixes the transition map and adds `previousStatus` to the history record. |
| D-004 | **A recruiter belongs to exactly one company.** One company can have many recruiters. A job belongs to one company and records the recruiter who created it. Applications belong to jobs. A recruiter may only create, edit, publish, close and manage jobs and applications belonging to their company. No multi-company recruiters, no company-level admin/owner roles, no company verification, simple company management. The model stays extensible. | One-owner-per-company is the simplest ownership model that still supports teams later, and it makes the authorization story explainable. | `FR-034`---`FR-038`, `FR-045`, `FR-064`, `DC-004`, `DC-005`. The joining mechanism is `D-009`; open questions `OQ-015` and `OQ-016` remain. |
| D-005 | **File bytes are never stored in MongoDB.** The database stores a reference and metadata only. | Keeps documents small, avoids database storage limits, and makes files replaceable and deletable independently of records. | `FR-028`, `FR-029`, `DC-002`. |
| D-006 | ~~**No programming-language decision is made in Phase 0.**~~ **SUPERSEDED by `D-012`**, which selects TypeScript. | The README originally deferred JavaScript versus TypeScript to the architecture phase; the language was subsequently decided in Phase 0 instead. | Superseded. `OQ-004` is resolved by `D-012`. |
| D-007 | **Search, filtering, sorting, pagination UX and notifications are not MVP.** They are V1. | Keeps the first deployment to the smallest usable two-sided product. | `FR-101`---`FR-107` are V1; MVP keeps a bounded newest-first list (`FR-075`, `FR-076`). |
| D-008 | **The product is named "Hireflow" and is framed as a learning and portfolio project**, per the current `README.md`. The multi-tenant ATS framing from the withdrawn attempt (`8900570`) is not adopted. | The README is the project's own statement of intent. | Documentation and naming consistency; the ATS framing is not a requirement here. |
| D-009 | **Joining a company is invite-based.** The first recruiter creates the company and becomes associated with it. An existing recruiter of that company can invite another already-registered user, identified by email address. The invited user must **accept** the invitation before becoming a recruiter of that company. A recruiter still belongs to exactly one company, and a company can have multiple recruiters. No multi-company recruiters, no company/team roles or permissions, no company verification. The detailed invitation mechanism, expiry, token handling and exact authorization rules are designed in Phase 1. | Invite-based joining is the only option that keeps a company genuinely closed: nobody can attach themselves to a company they do not belong to, which means company scoping is trustworthy by construction rather than by validation. It is also a more realistic model of how a hiring team forms, and it makes the authorization story simpler to explain and to test than self-serve joining. | Resolves `OQ-001`. Adds `FR-041` (revised), `FR-080`---`FR-084`, `DC-008`, MVP feature 5a, and definition-of-done item 3. **Introduces three new blocking questions** --- `OQ-021` (can a candidate accept an invitation, given one role per account?), `OQ-022` (token mechanism and expiry), `OQ-023` (how the invitee is notified, given no email and no notifications in the MVP). Adds `R-15`---`R-18`. `OQ-015` (leaving / removal) becomes concrete and is now a V1 item in section 8.5. `OQ-016` (company name uniqueness) is downgraded to non-blocking. |
| D-010 | **Application status is a controlled state machine with a fixed transition map, defined normatively in 10.6.1.** Forward path: `APPLIED` → `UNDER_REVIEW` → `SHORTLISTED` → `INTERVIEW` → `OFFERED` → `HIRED`. `REJECTED` is reachable from every non-terminal status except `WITHDRAWN`. `WITHDRAWN` is reachable only from `APPLIED`, and only by the candidate. `HIRED`, `REJECTED` and `WITHDRAWN` are terminal and cannot be reopened. No stage skipping and no backward transitions. Every successful transition appends an immutable history record capturing `previousStatus`, `status`, `changedBy` and `changedAt`. Authorization is checked before transition legality, and a stale concurrent change is rejected rather than silently applied. | A fixed map turns a free-text field into a testable specification: every legal move and every illegal move is enumerable, so the rules can be proven by tests rather than described in prose. Making `WITHDRAWN` candidate-only keeps "we rejected them" distinguishable from "they left", which matters for reporting. Recording `previousStatus` makes the history a complete audit chain rather than a list of states. Rejecting stale writes prevents one recruiter's decision from being silently overwritten by another. | Resolves `OQ-002`. Revises `FR-060` (adds `previousStatus`), `FR-061` (adds immutability), `FR-062`, `FR-063`, `FR-064`; adds `FR-085` (terminal states), `FR-086` (recruiters cannot set `WITHDRAWN`), `FR-087` (compare-and-set); adds normative table 10.6.1 with seven authorization rules; adds definition-of-done item 6 requiring a positive test per legal transition and a negative test per illegal one. Adds `R-19`, `R-20`; strengthens `NFR-R-003` and `NFR-R-008`. Raises `OQ-024` (reversibility and re-application) and broadens `OQ-019` (whether a rejection reason is captured). A side effect worth noting: because the longest path is 5 transitions, status history is capped at 6 entries per application and needs no pagination in the MVP. |
| D-011 | **Authentication uses server-side sessions.** Successful login creates a session record on the server. The client receives only an opaque session identifier through a secure mechanism and holds no authentication state of its own. Logout invalidates the server-side session. Authentication state is revocable server-side at any time. Every protected request is authenticated on the server by resolving a valid session. Authentication --- "who is this user?" --- and authorization --- "is this user allowed to do this?" --- remain separate decisions, made in that order. No JWT access token and no refresh token in the MVP. The session identifier is issued only after successful authentication, carries no identity or authority of its own, and is never readable by client-side JavaScript, returned in a response body, or logged. | Revocability is the deciding factor. A self-contained token is *verifiable* but not *revocable* before it expires: after a user reports a compromised account, the honest answer is "wait for it to expire". With server-side state, logout and revocation are immediate and real, which is what `NFR-S-013` already required. It also keeps the client simple --- no token refresh logic, no refresh-token rotation, no "the access token expired, retry" path in every API call --- and it makes the authorization story in `D-004` and `D-009` straightforward to test, because every protected request resolves a real user from the database. Storing role and company on the user record rather than inside the session also means a role change takes effect immediately instead of at next login. | Resolves `OQ-003`. Revises `FR-006`, `FR-009`, `FR-011`, `FR-012`; adds `FR-088`---`FR-095`; revises `NFR-S-003` (session identifiers, not tokens) and `NFR-S-013`; adds `NFR-S-018` (CSRF protection is mandatory) and `DC-009` (shared session store, never process memory); adds MVP feature 2 wording, three constraints in 7.2, and definition-of-done item 7 covering logout-and-replay, session fixation, CSRF-with-a-valid-session, and the identifier never appearing in a body or log. Adds `R-21`, `R-22`, `R-23`. Raises `OQ-025` (concurrent sessions and whether login revokes previous ones). **The main cost, stated plainly:** a browser attaches session credentials automatically, so this decision creates a cross-site request forgery surface that a bearer-token-in-header design would not have. `NFR-S-018` therefore makes CSRF protection a hard requirement rather than a hardening option, and `R-21` records that shipping sessions before CSRF protection exists would be a total authentication bypass. The five implementation specifics --- storage, cookie configuration, expiry and idle timeout, CSRF strategy, cleanup --- are Phase 1 design tasks listed in 13.3. |
| D-012 | **TypeScript is the implementation language across the whole application.** The frontend and the backend are both written in TypeScript, and shared types and utilities are written in TypeScript where that is appropriate --- in particular the API request and response shapes. JavaScript is not used as the primary implementation language. Strictness, `tsconfig` settings, build tooling, module system, and the exact frontend and backend setup are Phase 1 architecture decisions. | Compile-time checking catches a real class of defect --- a renamed field, a wrong shape, a forgotten property --- before the code runs, and it does so across the whole repository rather than in one place. For this project specifically, the shared API contract types are the biggest win: a change to a request or response shape becomes a compile error on both the server and the client simultaneously, instead of a bug that only appears when a real request meets a real response. It also makes the authorization and status-lifecycle logic far easier to refactor safely as the project grows, and it is the expected default for a production-oriented portfolio project. On the interview value the rationale names: being able to explain *why* types are not a substitute for runtime validation, and where a type system stops, is a more sophisticated answer than listing the benefits of TypeScript. | Resolves `OQ-004`. **Supersedes `D-006`**, which had deferred the language to Phase 1. Adds `DC-010` (API contract types are shared between frontend and backend), `NFR-M-011` (types are an aid, never enforcement), `NFR-D-009` (type checking runs in CI; a transpile-only build does not count as passing); revises `NFR-M-009` to state explicitly that types are erased at runtime and therefore cannot validate input or authorise an action; adds `R-24` (false confidence from erased types) and `R-25` (`any` and assertions eroding the guarantee); adds two constraints in 7.2 and makes the type check explicit in definition-of-done item 8; updates `R-12` and `R-13`; lists the TypeScript specifics in 13.3 as Phase 1 design tasks. **The main cost, stated plainly:** TypeScript creates a false sense of safety. A type annotation is erased when the code runs, so it cannot check an attacker's request body, enforce an authorization rule, or keep a malformed document out of the database. A developer who trusts the signatures can write code that compiles cleanly and is still insecure. `R-24` rates this High impact, which is why `NFR-M-009` and `NFR-M-011` are worded as prohibitions rather than preferences, and why "a request is not trusted because of its type" is a Phase 0 constraint on a fully typed codebase. The benefit depends entirely on the strictness level, so that is called out as the Phase 1 decision that matters most. |

---

## 15. Phase 0 Completion Checklist

Phase 0 is complete when all of the following are true. This is the gate; the
developer decides whether to proceed.

- [x] Repository inspected and its actual state reported.
- [x] Problem statement written, without exaggeration (section 2).
- [x] Minimum useful personas defined with goals, frustrations and workflows
      (section 5).
- [x] Core candidate and recruiter journeys documented, with missing steps
      identified (section 6).
- [x] MVP, V1 and future scope separated, with the MVP kept small (sections
      7--9).
- [x] Functional requirements numbered and prioritised (section 10).
- [x] Non-functional requirements defined across security, performance,
      reliability, accessibility, maintainability, scalability, observability
      and deployment, at a realistic scale (section 11).
- [x] Risks identified with mitigations and honest residual risk (section 12).
- [x] Open questions raised, with blocking ones marked (section 13).
- [x] Phase 0 decisions recorded (section 14) --- twelve decisions, `D-001`---`D-012`.
- [x] No application source code, dependency, or architectural decision made.

**Blocking questions that should be answered before Phase 1 is finalised:**

| Origin | Question |
| --- | --- |
| Phase 0, initial | `OQ-005` --- object storage provider and file delivery |
| **Raised by `D-009`** | `OQ-021` --- can an existing candidate accept a company invitation, given one role per account? |
| **Raised by `D-009`** | `OQ-022` --- invitation token mechanism and expiry |
| **Raised by `D-009`** | `OQ-023` --- how the invitee learns about the invitation, with no email and no notifications in the MVP |

`OQ-001` was resolved by `D-009`, `OQ-002` by `D-010`, `OQ-003` by `D-011` and
`OQ-004` by `D-012`. Resolving `OQ-001` **increased** the number of blocking
questions from five to seven, because invite-based joining couples company
membership to the role model and to a delivery channel the MVP otherwise does
not have. Resolving `OQ-002` reduced it to six, since the transition map needed
no new architecture decisions. Resolving `OQ-003` reduced it to five and raised
one **non-blocking** question (`OQ-025`, concurrent sessions). Resolving
`OQ-004` reduced it to four and raised none, because every TypeScript
specific --- strictness, module system, build tooling, workspace layout --- is a
Phase 1 design task rather than a decision that must come first. Four Phase 1
questions that were blocking are now gone; three company-joining questions took
their place.

**Next phase:** Phase 1 --- Architecture. It is not started.
