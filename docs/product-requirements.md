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
- One account holds exactly one role in the MVP. See open question `OQ-015`.

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
| A real state machine | Application status is a closed set with legal transitions, not a free-text field. Illegal transitions must be rejected server-side. | `FR-059`, `FR-070` |
| Auditable history | Every transition is append-only and attributed to an actor, so history cannot be silently rewritten. | `FR-060`, `FR-061` |
| Ownership-scoped authorization | "Recruiters only see their own company" is a correctness and privacy property, not a UI concern. It has to hold in the database query. | `FR-049`, `FR-068`, `NFR-S-014` |
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
  → Optionally: withdraw an application
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
- Withdrawal is the candidate's only self-service status change (`FR-063`).

**Gaps identified in the original journey, now covered:**

| Gap | Requirement |
| --- | --- |
| "Register" did not say what happens next --- the account is unusable until a profile exists | `FR-015`, `FR-022` |
| No step for résumé handling | `FR-023`---`FR-034` |
| No step for handling an already-applied job | `FR-057` |
| No step for a rejected or closed outcome | `FR-060`, `FR-061` |
| No way to exit the process | `FR-063`, `FR-064` |
| No stated consequence of applying to a closed job | `FR-052`, `OQ-010` |

**Not covered in the MVP:** email confirmation of receipt, notification of
status change, password reset (`FR-108`, `OQ-006`).

---

### 6.2 Recruiter journey

``` text
Register (choose Recruiter)
  → Set up / join company
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

**Preconditions:** an account with the Recruiter role, belonging to exactly one
company (`D-004`).

**Rules that apply along the way:**

- A job belongs to one company and records the recruiter who created it
  (`FR-043`, `FR-049`).
- Only published jobs are visible to candidates; drafts and closed jobs are
  not listed (`FR-052`).
- A job must be complete enough to publish (`FR-051`).
- Only recruiters of the owning company may view applicants, change statuses
  or close the job (`FR-062`, `FR-068`).
- Every status change writes a history entry (`FR-060`).
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
| No step for a recruiter who is also a candidate | `OQ-015` |

**Not covered in the MVP:** inviting colleagues, company ownership transfer,
notifying applicants, scheduling interviews, reporting (`FR-115`, `FR-119`, `D-004`).

---

## 7. MVP

The MVP is the smallest feature set that produces a genuinely usable
two-sided product. Every item below is required for the first usable
deployment.

### 7.1 MVP feature set

| # | Feature | Key requirements |
| --- | --- | --- |
| 1 | Registration for both roles, with unique email | `FR-002`, `FR-003`, `FR-004` |
| 2 | Login, logout, protected functionality, server-side authorization | `FR-006`---`FR-013` |
| 3 | Candidate profile: summary, location, skills, experience, education | `FR-015`---`FR-022` |
| 4 | Résumé upload, replace, delete, download (PDF, external storage) | `FR-022`---`FR-033` |
| 5 | Company profile, one per recruiter | `FR-034`---`FR-038` |
| 6 | Job create / edit / publish / close / reopen / list | `FR-043`---`FR-054` |
| 7 | Public job browsing and job detail (bounded list, newest first) | `FR-001`, `FR-075`, `FR-076` |
| 8 | Apply to a published job, one active application per candidate per job | `FR-055`---`FR-058` |
| 9 | Application status lifecycle with 8 controlled statuses | `FR-059`, `FR-070` |
| 10 | Append-only status history with actor and timestamp | `FR-060`, `FR-061` |
| 11 | Recruiter applicant list, filterable by status, with per-status counts | `FR-066`, `FR-069` |
| 12 | Candidate application list with status and history | `FR-065` |
| 13 | Candidate withdrawal of an application | `FR-063`, `FR-064` |
| 14 | Validation, centralized error handling, loading / empty / error states | `NFR-S-004`, `NFR-R-001`, `NFR-R-007` |
| 15 | Automated tests for auth, authorization, validation, status lifecycle | `NFR-M-006` |

### 7.2 MVP boundary rules

- The MVP has **two roles**. An Admin role is not built (`D-001`).
- The MVP has **no notifications**, no email, no search engine, no dashboards.
- The MVP stores **no file bytes in the database** (`D-005`).
- Every list endpoint is **bounded**. A list that could grow beyond a few
  hundred records must be paginated before it ships (`NFR-P-009`).
- Anything not in 7.1 is not started until the MVP is working.

### 7.3 Definition of done for the MVP

The MVP is done when, against a deployed instance with seeded demo data:

1. A candidate can register, complete a profile, upload a résumé, apply to a
   published job, and see the application with its status and history.
2. A recruiter can register, set up a company, publish a job, see the applicant,
   read the résumé, and change the status.
3. The candidate sees the new status and the new history entry.
4. Automated tests demonstrate that cross-company and cross-user access is
   rejected.
5. Lint, test and build all pass, and the deployment is documented.

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

- Application status transition rules exposed as an explicit, tested matrix.
- Company-level roles if `OQ-001` shows a real need.
- Basic analytics per job: application volume over time, status distribution.

---

## 9. Future Scope

Interesting, plausible, and explicitly **not** to be built yet.

| Item | Notes |
| --- | --- |
| **Admin / moderator role** | User suspension, job removal, dispute handling. Build when there is a real incident to handle (`OQ-018`). |
| **Multi-company recruiters** | Recruiter-to-company becomes many-to-many. The MVP model must not prevent this (`D-004`). |
| **Company teams and invitations** | Multiple recruiters per company with join / leave / revoke, and company-level roles. |
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
| `FR-001`---`FR-079` | MVP requirements (sections 10.1---10.8) |
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

All non-functional, design-constraint, open-question, decision and risk IDs are
contiguous within their own prefix (`NFR-S-001`---`NFR-S-016`, `DC-001`---`DC-007`,
`OQ-001`---`OQ-020`, `D-001`---`D-008`, `R-01`---`R-14`).

### 10.1 Accounts and authentication

| ID | Priority | Requirement |
| --- | --- | --- |
| FR-001 | MVP | A visitor can browse published jobs and view job details without an account. |
| FR-002 | MVP | A visitor can register as a candidate, providing name, email and password. |
| FR-003 | MVP | A visitor can register as a recruiter, providing name, email, password and their company. |
| FR-004 | MVP | An email address identifies exactly one account; duplicate registration is rejected. |
| FR-005 | MVP | Passwords are never stored in plaintext and never appear in any API response. |
| FR-006 | MVP | A registered user can log in with valid credentials. |
| FR-007 | MVP | Invalid credentials return a generic message that does not reveal whether the email exists. |
| FR-008 | MVP | Missing or malformed credentials are rejected with a clear validation message. |
| FR-009 | MVP | An authenticated user can log out, after which the session is no longer usable. |
| FR-010 | MVP | Exactly one role is assigned at registration in the MVP. |
| FR-011 | MVP | Protected functionality rejects unauthenticated requests. |
| FR-012 | MVP | Authorization is enforced on the server for every protected operation; hiding or disabling UI controls is not a security control. |
| FR-013 | MVP | A candidate cannot perform recruiter actions, and a recruiter cannot perform candidate-only actions. |

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
| FR-038 | MVP | During onboarding a recruiter provides their company details: name, industry, location, website and description. |
| FR-039 | MVP | A recruiter can view and edit their own company's information. |
| FR-040 | MVP | A recruiter cannot read or modify another company's information through the API. |
| FR-041 | MVP | The data model allows one company to have many recruiters; how a second recruiter joins is `OQ-001`. |

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
| FR-060 | MVP | Every status change appends a history entry recording at least the new status, the time, and the actor who made the change. |
| FR-061 | MVP | Status history is append-only; existing entries are never modified or deleted, and it is visible to the candidate and to recruiters of the owning company. |
| FR-062 | MVP | A recruiter can change the status of an application for a job belonging to their company. |
| FR-063 | MVP | A candidate can withdraw their own application, setting the status to `WITHDRAWN`. |
| FR-064 | MVP | A candidate cannot change an application status other than by withdrawing, and cannot return a withdrawn or rejected application to an active state. |
| FR-065 | MVP | A candidate can list all their applications, each showing the job, current status and full status history. |
| FR-066 | MVP | A recruiter can list the applicants for a job belonging to their company, filterable by status. |
| FR-067 | MVP | A recruiter can open an applicant's profile and résumé from within the applicant list. |
| FR-068 | MVP | A recruiter cannot see, or change the status of, an application for another company's job. |
| FR-069 | MVP | A recruiter can see the number of applications per status for their own jobs. |
| FR-070 | MVP | Legal status transitions are defined and enforced on the server; the transition map is finalised in Phase 1 (`OQ-002`). |

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
| NFR-S-003 | Passwords, password hashes, tokens and résumé contents are never written to logs. |
| NFR-S-004 | All input is validated server-side against an explicit schema. Unknown fields are rejected or explicitly ignored --- never passed through. |
| NFR-S-004a | The request body size is capped globally, at a limit comfortably above the largest legitimate payload, so an oversized or malicious body is rejected before it is parsed. Upload routes use their own explicit, documented limit (`FR-026`). |
| NFR-S-005 | All secrets come from environment variables. No secret is committed. `.env.example` documents every variable. |
| NFR-S-006 | CORS allows only the known frontend origin(s). Credentials are not allowed from arbitrary origins. |
| NFR-S-007 | Security headers are set: content-type sniffing protection, clickjacking protection, a content security policy, referrer policy, and HSTS in production. |
| NFR-S-008 | Rate limiting is applied to authentication endpoints, registration, uploads and other write endpoints. |
| NFR-S-009 | Uploaded files are validated by content, size-capped, stored outside any web-servable path, and delivered only through an authorised, time-limited request. Untrusted content is never rendered inline in the application origin. |
| NFR-S-010 | All database access goes through the ODM's query API. No query is built by string concatenation of user input. |
| NFR-S-011 | Production error responses contain a safe message and a correlation id. No stack traces, query text, or internal identifiers. |
| NFR-S-012 | Data exposure is minimised: API responses return only fields the caller needs; listing endpoints do not return full documents. |
| NFR-S-013 | Authentication state is revocable server-side. Logging out invalidates server-side state, not just a client token. |
| NFR-S-014 | Ownership scoping is applied inside the database query --- filtering after retrieval is not acceptable for tenant or company data. |
| NFR-S-015 | Authorization is centralised in reusable middleware, and each protected route has a negative test proving the denied case. |
| NFR-S-016 | Personally identifiable data is retained only as long as needed, and the retention position is documented before public launch. |

### 11.2 Performance

| ID | Requirement |
| --- | --- |
| NFR-P-001 | Public job list and job detail pages render usable content within 2.5 seconds on a mid-range device over a typical deployment network. |
| NFR-P-002 | API read endpoints respond within 500 ms at the 95th percentile under expected demo load. |
| NFR-P-003 | Writes --- including résumé upload --- complete within 3 seconds at the 95th percentile, excluding client file selection time. |
| NFR-P-004 | No database query is unbounded. Every list query applies an explicit limit, and pagination beyond a defined threshold. |
| NFR-P-004a | No list endpoint returns more than **100 records** by default. This cap is enforced in request validation, not left to each handler, so it cannot be forgotten. A higher maximum is a deliberate, reviewed change. |
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
| NFR-R-003 | A status change and its history entry either both persist or neither does. The mechanism is decided in Phase 1 (`OQ-010`, free-tier transaction support). |
| NFR-R-004 | Database connection uses retry with backoff on startup, and a health endpoint reports connectivity. |
| NFR-R-005 | No user data depends on ephemeral container or instance storage. A redeploy cannot lose data. |
| NFR-R-006 | A backup and restore procedure for the deployed database is documented. |
| NFR-R-007 | The interface never fails silently. Every error state is visible to the user with a way forward. |
| NFR-R-008 | Concurrent conflicting writes --- for example two recruiters changing one application's status --- result in one consistent outcome, not a silently lost update. |

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
| NFR-M-009 | Every boundary --- HTTP, database, file storage --- is validated at runtime, regardless of whether static types are used. |
| NFR-M-010 | No fake implementation. Mocked behaviour is labelled as a mock in code and in documentation. |

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

---

## 12. Risks

Product and delivery risks. Each has a mitigation; residual risk is stated
honestly.

| ID | Risk | Impact | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| R-01 | **Scope creep.** The status set invites interview scheduling, offers and analytics, which turns the MVP into an ATS. | High | MVP is defined in section 7 only. `FR-115`---`FR-119` and section 9 are explicitly deferred. The phase gate stops work. | Medium --- requires ongoing discipline. |
| R-02 | **Untrusted résumé uploads.** A malicious or malformed file could be used for malware hosting, content-type confusion, or denial of service. | High | `NFR-S-009`: content-based type validation, hard size cap, private external storage, authorised time-limited delivery, no inline rendering of untrusted content, rate limiting on upload. | Medium --- PDFs can carry active content. Production would add malware scanning and serve files from a separate origin. |
| R-03 | **Personal data exposure.** Résumés and profiles are sensitive; leaking them is the most damaging realistic failure. | High | `NFR-S-014`, `NFR-S-016`, `FR-033`, `FR-034`, `NFR-S-003`, `NFR-S-012`. | Medium --- access-log auditing is deferred to V1 (`FR-112`), so early misuse may go undetected. |
| R-04 | **Authorization defects.** A bug that lets one recruiter see another's applicants is the worst bug this product can have. | High | Centralised middleware (`NFR-S-015`), query-level scoping (`DC-005`), and an explicit negative test per protected route. | Low --- if the negative tests are actually written. |
| R-05 | **Free-tier limits.** Database size, storage quota, build minutes, memory and cold starts can all fail during a demo. | Medium | Cap résumé size, one résumé per candidate, bound all lists, measure quotas, keep a documented fallback. | Medium --- quota exhaustion is possible under an unexpected demo load. |
| R-06 | **No email provider decided.** Password reset and email verification are blocked, and a public deployment without password reset is a genuine usability gap. | Medium | `OQ-006` is marked as blocking for the V1 plan; the MVP deliberately does not advertise password reset. | Accepted for MVP, must be resolved before inviting real users. |
| R-07 | **Ambiguous company-join model.** How a second recruiter joins a company was never specified. Building on a guess means rework. | Medium | Raised as blocking `OQ-001`, to be answered before Phase 1. | Eliminated once answered. |
| R-08 | **Transaction support on the target database tier.** Status change plus history entry must be atomic (`NFR-R-003`), but multi-document transactions may not be available on all free tiers. | Medium | Verify the deployed tier in Phase 1; design so the write is safe without transactions if necessary. | Medium until verified. |
| R-09 | **Empty demo state.** A reviewer who sees no jobs and no applicants concludes the product is broken. | Medium | `NFR-D-006` seed script with realistic demo data. | Low. |
| R-10 | **Public deployment collecting real personal data.** A publicly reachable demo may attract real users and real résumés. | Medium | Document that the deployment is a demo; keep retention minimal; resolve `OQ-013` before promoting it publicly. | Medium. |
| R-11 | **Unbounded lists degrade quickly and look broken.** | Low | `NFR-P-004`, `NFR-P-005`, `FR-076`. | Low. |
| R-12 | **Learning-curve overload.** Too much infrastructure too early can stall the project. | Medium | `NFR-M-004` simple-code rule; the MVP avoids queues, caches, microservices and a design-system build. | Low. |
| R-13 | **Documentation drift.** Requirements are written now; the code arrives over many phases. | Medium | Requirement IDs are referenced from code and tests, and the phase gate requires re-checking this document. | Medium. |
| R-14 | **A previous over-scoped Phase 0 attempt exists in Git history** (commit `8900570`) with an architecture the current plan does not endorse. Reading from it by mistake could reintroduce unapproved decisions. | Low | Those documents are deleted in this phase and are not a source of truth. This document is. | Low. |

---

## 13. Open Questions

To be answered before or during Phase 1. **Blocking** means Phase 1
architecture should not be finalised until it is answered.

| ID | Question | Blocks | Why it matters |
| --- | --- | --- | --- |
| OQ-001 | **How does a second recruiter join a company in the MVP?** The model allows many recruiters per company, but no join mechanism was specified: self-serve join by selecting an existing company, an invite code, or not supported in MVP. | **Phase 1** | Determines whether the company entity needs membership, invites and revocation, and whether company names must be unique (`OQ-016`). |
| OQ-002 | **Which application status transitions are legal, and who may perform them?** For example: may a recruiter move `REJECTED` back to `SHORTLISTED`? May a recruiter set `HIRED` directly from `SHORTLISTED`? Can `WITHDRAWN` be reversed by a recruiter? | **Phase 1** | The transition map is the state machine. `FR-070` cannot be implemented or tested without it. |
| OQ-003 | **What is the authentication mechanism?** Short-lived access token plus a rotating refresh token, or server-side sessions; and how the client stores it. | **Phase 1** | Determines the whole session model, `FR-009`, `FR-011`, `NFR-S-013`. Deliberately not decided in Phase 0. |
| OQ-004 | **JavaScript or TypeScript?** | **Phase 1** | README defers this to the architecture phase. Affects every file and the validation strategy (`NFR-M-009`). |
| OQ-005 | **Which object storage provider, and how are files delivered** --- signed URL, or proxied stream through the backend? | **Phase 1** | Required by `D-002` / `FR-028`---`FR-034`. Also determines free-tier cost and the résumé access-control implementation. |
| OQ-006 | **Is there an email provider, and are password reset / email verification MVP or V1?** | V1 planning | `FR-108`, `FR-109` depend entirely on this. See `R-06`. |
| OQ-007 | **What is the maximum résumé size, and is DOCX supported later?** | **Phase 1** | `FR-025`, `FR-026` need concrete numbers. |
| OQ-008 | **Is salary range required, optional, or omitted?** Some regions treat it as legally sensitive. | Phase 1 | `FR-044` currently treats it as optional. |
| OQ-009 | **What is the job status set?** Draft / Published / Closed is assumed. Is a `PAUSED` state needed, and are edits to a live job versioned for candidates? | Phase 1 | `FR-039`---`FR-044`, `FR-206`. |
| OQ-010 | **What happens to live applications when a job is closed?** Retained and visible to the recruiter, with no new applications accepted --- currently assumed. And can a closed job be reopened with applications intact? | Phase 1 | `FR-047`, `FR-048`. |
| OQ-011 | **Must a candidate meet a minimum profile completeness to apply?** Currently unspecified. | Phase 1 | Affects `FR-022` and the apply flow. |
| OQ-012 | **Can one person hold both roles?** Currently one role per account, so a recruiter cannot also apply as a candidate. | Phase 1 | `FR-010`, and a realistic edge case for a small community demo. |
| OQ-013 | **Is self-service account deletion and data export required before a public launch?** | Before public launch | `NFR-S-016`, `R-10`. A real obligation in many jurisdictions. |
| OQ-014 | **Is one email allowed to register twice?** Currently no: one account per email (`FR-004`). | Phase 1 | Blocks `OQ-001` and `OQ-012`. |
| OQ-015 | **Do recruiters need a way to be removed from a company?** | Phase 1 | Follows from `OQ-001`. |
| OQ-016 | **Must company names be unique?** | Phase 1 | Follows from `OQ-001`; affects a database-level constraint. |
| OQ-017 | **What triggers building the Admin role?** | Future | `OQ-018`; keep this as an explicit revisit condition. |
| OQ-018 | **Which free-tier services will be used for hosting, database, storage and email?** | Phase 1 / Phase 16 | Constrains transactions, storage, cold starts and cost (`R-05`, `R-08`). |
| OQ-019 | **Can a recruiter add a private note per application or per status change?** | V1 | Affects whether the history entry needs a free-text field now or later. |
| OQ-020 | **What are the abuse limits for public registration and application submission?** | Phase 1 | Sets concrete rate-limit values for `NFR-S-008`. |

### 13.1 Deliberately not decided in Phase 0

The following are Phase 1 decisions and were intentionally left open. This
list exists so that a later phase does not mistake silence for approval.

- Programming language: JavaScript or TypeScript.
- Authentication and session mechanism.
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
| D-003 | **Application status uses controlled enum values, not arbitrary strings:** `APPLIED`, `UNDER_REVIEW`, `SHORTLISTED`, `INTERVIEW`, `OFFERED`, `HIRED`, `REJECTED`, `WITHDRAWN`. The MVP also keeps status history recording at least status, `changedAt` and `changedBy`. No complex interview stages, offer negotiation, onboarding, background checks or AI scoring. Basic valid-transition rules are designed in Phase 1. | A closed set is testable and prevents meaningless values; history makes the process auditable and answers the candidate's real question. | `FR-059`, `FR-060`, `FR-061`, `DC-003`, `FR-207` is Future, `OQ-002` is blocking for Phase 1. |
| D-004 | **A recruiter belongs to exactly one company.** One company can have many recruiters. A job belongs to one company and records the recruiter who created it. Applications belong to jobs. A recruiter may only create, edit, publish, close and manage jobs and applications belonging to their company. No multi-company recruiters, no company-level admin/owner roles, no company verification, simple company management. The model stays extensible. | One-owner-per-company is the simplest ownership model that still supports teams later, and it makes the authorization story explainable. | `FR-034`---`FR-038`, `FR-045`, `FR-064`, `DC-004`, `DC-005`, and blocking `OQ-001`, `OQ-015`, `OQ-016`. |
| D-005 | **File bytes are never stored in MongoDB.** The database stores a reference and metadata only. | Keeps documents small, avoids database storage limits, and makes files replaceable and deletable independently of records. | `FR-028`, `FR-029`, `DC-002`. |
| D-006 | **No programming-language decision is made in Phase 0.** | The README defers JavaScript versus TypeScript to the architecture phase. | `OQ-004`. |
| D-007 | **Search, filtering, sorting, pagination UX and notifications are not MVP.** They are V1. | Keeps the first deployment to the smallest usable two-sided product. | `FR-101`---`FR-107` are V1; MVP keeps a bounded newest-first list (`FR-075`, `FR-076`). |
| D-008 | **The product is named "Hireflow" and is framed as a learning and portfolio project**, per the current `README.md`. The multi-tenant ATS framing from the withdrawn attempt (`8900570`) is not adopted. | The README is the project's own statement of intent. | Documentation and naming consistency; the ATS framing is not a requirement here. |

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
- [x] Phase 0 decisions recorded (section 14).
- [x] No application source code, dependency, or architectural decision made.

**Blocking questions that should be answered before Phase 1 is finalised:**
`OQ-001`, `OQ-002`, `OQ-003`, `OQ-004`, `OQ-005`.

**Next phase:** Phase 1 --- Architecture. It is not started.
