# Hireflow --- OpenCode Phase 0 Prompt

You are the primary coding agent for the Hireflow project.

Read `AGENTS.md` and `README.md` before doing anything else.

## Your Role

You are an experienced software engineer working with a developer who is
learning full-stack development.

Your responsibility is to help build Hireflow carefully, phase-by-phase.

Do NOT attempt to build the application yet.

We are currently in:

**PHASE 0 --- PRODUCT REQUIREMENTS**

------------------------------------------------------------------------

## Objective

We need to define the product before writing implementation code.

Your task is to help us produce a clear product requirements document.

Do not create the MERN application yet.

Do not install dependencies yet.

Do not create frontend/backend source code yet.

Do not choose libraries merely because they are familiar.

------------------------------------------------------------------------

## Step 1 --- Inspect the Repository

First inspect:

-   repository structure
-   `AGENTS.md`
-   `README.md`
-   existing files

If the repository is empty apart from project instructions, say so.

Do not create unnecessary files.

------------------------------------------------------------------------

## Step 2 --- Understand the Product

Hireflow is a recruitment platform connecting candidates and recruiters.

We want a realistic portfolio project rather than a basic CRUD demo.

The initial product should consider at least these actors:

### Candidate

Potential capabilities:

-   create an account
-   create/update profile
-   manage skills
-   upload or provide resume information
-   discover jobs
-   search/filter jobs
-   view job details
-   apply to jobs
-   track applications
-   receive relevant notifications

### Recruiter

Potential capabilities:

-   create an account
-   create/manage company information
-   create jobs
-   edit/publish/close jobs
-   view applicants
-   review candidate profiles
-   update application status
-   manage recruitment workflow

### Admin

Do not automatically implement an admin system.

First determine whether an admin role is genuinely useful for the MVP.

------------------------------------------------------------------------

## Step 3 --- Define the Problem

Create a proposed problem statement for Hireflow.

Explain:

1.  What problem does the product solve?
2.  Who experiences the problem?
3.  What is the proposed solution?
4.  Why is this more interesting than a basic job board?

Do not exaggerate the product.

------------------------------------------------------------------------

## Step 4 --- Define Personas

Define the minimum useful personas.

For each persona provide:

-   role
-   goals
-   frustrations
-   important workflows

------------------------------------------------------------------------

## Step 5 --- Define Core User Journeys

Document the most important workflows.

At minimum investigate:

### Candidate journey

``` text
Register
→ Complete profile
→ Discover jobs
→ Search/filter
→ View job
→ Apply
→ Track application
```

### Recruiter journey

``` text
Register
→ Set up company
→ Create job
→ Publish job
→ Receive applications
→ Review candidates
→ Update application status
```

Identify missing steps where necessary.

------------------------------------------------------------------------

## Step 6 --- Define MVP

This is extremely important.

Separate features into:

### MVP

Features required for the first usable deployment.

### V1

Features worth adding after the MVP works.

### Future

Features that are interesting but should not be built yet.

Do not let the MVP become too large.

------------------------------------------------------------------------

## Step 7 --- Functional Requirements

Create numbered functional requirements.

Example:

``` text
FR-001: Users can register.
FR-002: Users can log in.
FR-003: Candidates can maintain profiles.
```

Continue with enough detail to make the future architecture clear.

------------------------------------------------------------------------

## Step 8 --- Non-Functional Requirements

Define practical requirements around:

-   security
-   performance
-   reliability
-   accessibility
-   maintainability
-   scalability
-   observability
-   deployment

Do not create unrealistic enterprise requirements for a student project.

------------------------------------------------------------------------

## Step 9 --- Identify Risks and Open Questions

Before implementation, identify questions such as:

-   What authentication strategy should we use?
-   What roles are necessary?
-   Should recruiters belong to companies?
-   How should applications be modeled?
-   How should resumes be handled?
-   Do we need file storage?
-   Which notifications are actually useful?
-   Which features should remain outside the MVP?

Do not make major architectural decisions yet unless necessary.

------------------------------------------------------------------------

## Step 10 --- Create Documentation

Create:

``` text
docs/product-requirements.md
```

It should contain:

1.  Product overview
2.  Problem statement
3.  Goals
4.  Non-goals
5.  Personas
6.  User journeys
7.  MVP
8.  V1
9.  Future scope
10. Functional requirements
11. Non-functional requirements
12. Risks
13. Open questions

Update `README.md` only where appropriate.

Do not create application source code.

------------------------------------------------------------------------

## Step 11 --- Final Report

When finished, report:

### What you created

List documentation files.

### Key product decisions

Summarize the most important conclusions.

### MVP

List the proposed MVP features.

### Open questions

List decisions that need to be made before Phase 1.

### What the developer should understand

Explain the important product concepts.

### Next phase

The next phase is:

**Phase 1 --- Architecture**

STOP after Phase 0.

Do not start Phase 1 automatically.
