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

### Frontend

-   React
-   React Router
-   JavaScript/TypeScript --- decision finalized during architecture
    phase

### Backend

-   Node.js
-   Express.js

### Database

-   MongoDB
-   Mongoose

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

## Phase 1 --- Architecture

Define:

-   technology choices
-   system architecture
-   frontend/backend boundaries
-   database strategy
-   authentication strategy
-   API conventions
-   folder structure
-   development workflow

## Phase 2 --- Project Setup

Set up:

-   repository
-   frontend
-   backend
-   development scripts
-   environment variables
-   linting
-   formatting
-   initial Git workflow

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

Introduce notifications where they provide real product value.

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
| [AGENTS.md](AGENTS.md) | The development rules the coding agent must follow. |

------------------------------------------------------------------------

# Suggested Repository Structure

``` text
hireflow/
├── frontend/
├── backend/
├── docs/
├── AGENTS.md
├── README.md
├── .gitignore
└── .env.example
```

The exact structure may evolve after Phase 1 architecture decisions.

------------------------------------------------------------------------

# Current Status

Phase: **0 --- Product Requirements**

Status: **Complete --- pending developer review**

No application code exists yet, by design. Nothing has been installed, and
frontend/backend source directories do not exist yet.

Delivered in Phase 0:

- [Product Requirements](docs/product-requirements.md) --- product overview,
  problem statement, goals, non-goals, two personas, the candidate and recruiter
  journeys, MVP / V1 / future scope, 71 MVP + 20 V1 + 13 future functional
  requirements, 70 non-functional requirements, 14 risks, 20 open questions,
  7 design constraints for Phase 1, and the Phase 0 decision log (8 recorded
  decisions).

Key Phase 0 decisions (details and rationale in the requirements document):

- Two roles only: **Candidate** and **Recruiter**. An Admin role is future
  scope, and the authorization model must allow one to be added later without a
  redesign.
- Résumé upload is in the MVP: one current PDF per candidate, stored in
  external object storage with only a reference and metadata in the database.
- Application status is a controlled set of eight values --- `APPLIED`,
  `UNDER_REVIEW`, `SHORTLISTED`, `INTERVIEW`, `OFFERED`, `HIRED`, `REJECTED`,
  `WITHDRAWN` --- with append-only status history recording status, `changedAt`
  and `changedBy`.
- A recruiter belongs to exactly one company; a recruiter may only manage the
  jobs and applications of their own company.
- No search engine, filtering, pagination UX or notifications in the MVP;
  those are V1.

Next objective:

Answer the five blocking open questions (`OQ-001`, `OQ-002`, `OQ-003`,
`OQ-004`, `OQ-005`), then start **Phase 1 --- Architecture** on explicit
instruction. Phase 1 has not been started.
