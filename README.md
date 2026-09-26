# HireFlow

**A multi-tenant Applicant Tracking System built as a production-grade MERN reference
implementation — and as a structured learning project in full-stack engineering.**

> **Project status: Phase 0 (Product & Architecture) — complete.**
> No application code exists yet, by design. The entire design is documented and
> defensible before a line is written.

---

## What this is

HireFlow is a web-based ATS. A company creates an **organization**, invites a team, posts
**jobs**, and runs candidates through an explicit hiring **pipeline**:

```
create job → publish → candidate applies → screening → shortlisted
→ interview scheduled → feedback submitted → offer / rejection → hired
```

Companies are **tenants**: two organizations can never see each other's jobs, candidates,
resumes or applications — enforced on the server, not by hiding buttons.

The project is being built in 16 explicit phases. Each phase ends with a gate: working
feature, edge cases considered, tests, updated docs, and a verified run. Phases never
advance automatically.

## Tech stack (as chosen, with reasons in the docs)

| Layer | Choice |
| --- | --- |
| Frontend | React 19 · TypeScript (strict) · Vite · React Router · TanStack Query · Zustand · Tailwind CSS |
| Backend | Node.js · Express 5 · TypeScript (strict) · Zod |
| Database | MongoDB · Mongoose |
| Auth | Access token in memory (15 min) + rotating refresh token in an httpOnly cookie · argon2id |
| Files | S3-compatible object storage (private bucket, signed URLs, magic-byte validation) |
| Email | Resend in production, Nodemailer/Ethereal in development (async, Phase 9) |
| Testing | Jest + Supertest + `mongodb-memory-server` (backend) · Vitest + React Testing Library (frontend) |
| DevOps | Docker · Docker Compose · GitHub Actions (Phase 13) |
| Real-time | Socket.IO, emit-after-commit, REST stays authoritative (Phase 9) |
| Deferred | Redis/BullMQ (only when volume demands) · AI resume matching behind a port interface (Phase 11) |

## Repository layout

```
HireFlow/
├── docs/
│   └── phase-0/        ← start here
│       ├── 01-product-and-requirements.md      product, personas, stories, FR/NFR, priorities
│       ├── 02-domain-model.md                  entities, embedding vs referencing, indexes, concurrency, scale
│       ├── 03-system-architecture.md           request lifecycle, layering, auth, RBAC, frontend, folders
│       ├── 04-api-design-strategy.md           conventions, envelope, errors, pagination, endpoint surface
│       ├── 05-decisions-and-tradeoffs.md       ADRs with alternatives, risks, roadmap, known limitations
│       └── 06-concepts-and-interview-questions.md  the Phase 0 gate + full interview bank
├── server/             (Phase 1)
├── client/             (Phase 1)
└── README.md
```

## Documentation index

| Document | What it answers |
| --- | --- |
| [01 Product & Requirements](docs/phase-0/01-product-and-requirements.md) | What are we building, for whom, and how do we know it is done? |
| [02 Domain Model](docs/phase-0/02-domain-model.md) | What are the entities, how do they relate, and why is the schema shaped this way? |
| [03 System Architecture](docs/phase-0/03-system-architecture.md) | How does a request actually flow? Where does auth happen? How are permissions enforced? |
| [04 API Design Strategy](docs/phase-0/04-api-design-strategy.md) | What do the URLs, response envelope, error codes and pagination look like? |
| [05 Decisions & Trade-offs](docs/phase-0/05-decisions-and-tradeoffs.md) | Why this stack and not the alternative? What are the risks and known gaps? |
| [06 Concepts & Interview Questions](docs/phase-0/06-concepts-and-interview-questions.md) | What must I understand before writing code? What will I be asked? |

## Roadmap

| Phase | Theme |
| --- | --- |
| 0 | Product & architecture ✅ |
| 1 | Project setup, env config, Mongo connection, health endpoints, tooling |
| 2 | Authentication (register / login / refresh / logout, protected routes) |
| 3 | Organizations & RBAC (multi-tenancy, roles, authorization) |
| 4 | Job management (CRUD as a real business workflow) |
| 5 | Candidate profiles, resume upload, applications |
| 6 | Hiring pipeline (state machine, Kanban, stage history, audit) |
| 7 | Interview management (scheduling, assignment, feedback) |
| 8 | Search, filtering & pagination (index-backed) |
| 9 | Notifications, real-time & email |
| 10 | Analytics (aggregation pipelines + dashboard) |
| 11 | AI resume assistant (assistive, explainable, behind an interface) |
| 12 | Testing & security hardening |
| 13 | Docker & CI/CD |
| 14 | Deployment |
| 15 | Interview preparation |

Full phase-by-phase detail, including the **gate that must pass before each phase
starts**, is in
[05-decisions-and-tradeoffs.md §8](docs/phase-0/05-decisions-and-tradeoffs.md).

## The five ideas this project is built to teach

1. **Candidate ≠ Application.** The many-to-many *is* the entity. Stage, interviews and
   feedback hang off the application, not the person.
2. **Authorization is server-side, two-layered, and query-scoped.** Role → permission map
   *plus* ownership predicates, with the tenant filter inside the database query.
3. **Authentication is a token-storage problem, not a password problem.** Short-lived
   in-memory access token, rotated httpOnly refresh token, reuse detection.
4. **Invariants belong in the database.** Unique indexes for "apply once", "one feedback
   per interviewer", "no duplicate candidate per tenant".
5. **Design that makes the mistake impossible beats a review checklist that catches it.**
   Tenant scope, validation and pagination belong in the middleware pipeline.

## Current status

- [x] Product overview, problem statement, personas, user stories
- [x] Functional requirements (FR) and non-functional requirements (NFR) with measurable targets
- [x] Feature prioritisation mapped to phases
- [x] Domain model: 10 entities, field-level design, cardinality
- [x] Embedding vs referencing framework, applied and justified
- [x] Index strategy, compound-order reasoning, pagination strategy, N+1 rule
- [x] Concurrency strategy: unique indexes, transactions, optimistic concurrency
- [x] High-level architecture, backend layering, frontend architecture
- [x] Authentication and authorization architecture
- [x] API design strategy, error catalogue, endpoint surface per module
- [x] Decision records with alternatives and revisit conditions
- [x] Risk register, anti-patterns, known limitations
- [x] 16-phase roadmap with entry/exit gates
- [ ] Application code — begins in Phase 1

**Next step: verify the Phase 0 gate in
[06-concepts-and-interview-questions.md Part A](docs/phase-0/06-concepts-and-interview-questions.md),
then say "Start Phase 1."**
