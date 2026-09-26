# HireFlow — Phase 0: Concepts to Understand & Interview Questions

Two parts:
1. **The short list of concepts you must own before Phase 1** (the gate).
2. **Potential interview questions** for your Phase 0 / general prep bank.

The interview bank is intentionally *not* answered here. Per your instructions, you
attempt an answer out loud first, then I evaluate and fill the gaps. Answering is the
skill; reading an answer is not.

---

## Part A — Gate: concepts you must understand before Phase 1

The list is deliberately short (14 items). Each is one "I can explain this clearly"
claim, not a topic. For each, be able to answer: **what is it → why does it exist → where
does it appear in HireFlow → what breaks without it.**

### 1. Node, npm, and a monorepo
- What a `package.json` dependency section actually does, what a lockfile guarantees.
- Workspaces: one root `package.json` with `workspaces: ["client", "server"]`, why a single
  `node_modules`, and how `npm run dev -w client` works.
- ESM vs CJS at a practical level: `"type": "module"`, `import`/`export`, why `.js`
  extensions appear in relative imports, and how `tsx`/`ts-node` differ.

### 2. TypeScript for a backend (not just types)
- `strict: true` and what each flag buys you: `strictNullChecks`, `noImplicitAny`,
  `noUncheckedIndexedAccess`.
- Structural typing vs nominal; why interfaces compose better than classes here.
- **Declaration merging and module augmentation** — the *only* legitimate reason to use
  `declare global` in this project: adding `req.user` and `req.tenant` to Express's
  `Request`. Why that is a real use case and not a hack.
- Zod's `z.infer` as a compile-time type derived from a runtime schema.
- Why `any` is banned and what a documented escape looks like.

### 3. The HTTP request/response cycle and Express's middleware model
- What "middleware" *is*: `(req, res, next) => void`, called in order, each one able to
  end the request, modify it, or pass it on.
- The exact execution order in our pipeline and **why auth precedes validation**.
- `next()`, `next(err)`, the 4-argument error middleware signature, and why it must be
  registered last.
- Status codes as an API contract: 200/201/204/400/401/403/404/409/422/429/500.
- `req`/`res` are **the same objects** through the whole chain — that is why
  `authenticate` can set `req.user` for a controller five steps later.

### 4. Layered architecture and the "thin controller" rule
- Route → controller → service → model → DB, and what each layer is *for*.
- Why business logic in a controller is a real cost: it cannot be unit-tested without
  faking `req`/`res`, and it gets duplicated when a socket handler or a background job
  needs the same rule.
- What a *service* signature looks like when it takes `(args, actor, tenant)` instead of
  `(req, res)`.
- Dependency direction: models must not import services; modules talk through `index.ts`.

### 5. Environment configuration and secrets
- `process.env` is a `Record<string, string | undefined>` — hence optional typing.
- Validating env with a Zod schema at boot and **failing fast**: a process that starts
  with a missing `MONGODB_URI` and only fails on the first request is a bad design.
- `.env` vs `.env.example`, why `.env` is git-ignored, and why there are no production
  default values.

### 6. MongoDB and Mongoose primitives
- Document vs collection vs database; embedded documents vs referenced ids.
- `ObjectId`, and why the API should treat ids as opaque strings.
- Schemas, `timestamps`, `select: false`, `lean()` and why `lean()` matters for read paths.
- `find` vs `findOne` vs `findById` vs `updateOne` vs `findOneAndUpdate` — and which one
  supports a *filter* so you can scope in the query.
- `pre('save')` hooks and why **password hashing does not belong in one** (it would
  silently skip on `updateOne`).

### 7. Indexes and query performance
- What an index is: a sorted structure that lets Mongo skip documents.
- Compound index field order = equality → sort → range, with the public-jobs example from
  `02-domain-model.md` §5.2.
- Cost of indexes: write amplification, memory, planner choosing badly.
- What a unique index gives you beyond speed: a **constraint**.
- Reading `explain("executionStats")`: `IXSCAN` (good) vs `COLLSCAN` (bad),
  `docsExamined` vs `nReturned`, and `totalDocsExamined` as the number to watch.

### 8. Relations, joins and the N+1 problem
- Mongoose `populate` is a **second query**, and in a loop it is 1 + N queries.
- Batch populate: collect ids, one `find({ _id: { $in: ids } })`.
- `$lookup` in an aggregation pipeline as the single-query alternative.
- Referential integrity being *your* job in MongoDB, and how to test it.

### 9. Authentication: passwords, hashing, JWT
- Why passwords are **hashed with a salt and a slow KDF** (argon2id/bcrypt), never
  encrypted and never hashed with plain SHA-256.
- What a salt does; what "adaptive"/cost factor means.
- JWT structure: `header.payload.signature`, signature over the first two parts, and the
  fact that the payload is **base64, not encrypted** — anyone can read it, so never put
  secrets in a JWT.
- Stateless verification: why that is fast and why it makes revocation hard.
- Access vs refresh token lifetimes and the trade-off you accept by choosing them.

### 10. Browser token storage and the XSS/CSRF trade-off
- Why `localStorage` is readable by any script on the page → one XSS is a full account
  takeover.
- Why an httpOnly cookie is unreadable by JS but is **sent automatically** → CSRF risk.
- What `SameSite=Lax/Strict/None` actually changes, what `Secure` does, and what a
  `credentials: "include"` fetch implies.
- "Access token in memory + header, refresh token in httpOnly cookie": what each part
  fixes, and what you give up.

### 11. Authorization: RBAC, ABAC, ownership, and IDOR
- Authentication vs authorization; 401 vs 403.
- RBAC: role → permissions, one map, centrally defined.
- ABAC / ownership: "this interviewer, this interview" cannot be expressed as a role.
- **IDOR** (OWASP API1:2023) and the two-line fix: filter by tenant in the *query*.
- Why cross-tenant absence is `404`, not `403`.
- Server-side enforcement: the browser guard is a UX feature, and anyone can edit a
  request in devtools.

### 12. Input validation and error handling
- Trust boundary: **all** input is untrusted, including from our own frontend.
- Zod parse + inference; `safeParse` vs `parse`; mapping `issues[]` into a 422 `details`.
- Why Mongoose validation is not enough (it runs too late and errors are poorly shaped).
- The error taxonomy: expected (`AppError` subclasses) vs unexpected; a single error
  middleware; never leak internals; always a `requestId` for correlation.

### 13. Frontend: rendering, the four kinds of state, server-state caching
- React renders on state change; re-render cost is proportional to how much tree you
  invalidate; `useMemo`/`useCallback`/`React.memo` are for measured problems.
- **The four state kinds** (server / client / URL / form) and which tool owns each.
- Server state is a *cache of a remote truth* — it is stale the moment you write it, so
  it needs invalidation, not local mutation. This single idea explains most of
  TanStack Query's API.
- Query keys as a cache identity; invalidating too broadly or too narrowly.
- Optimistic updates: apply locally → `onError` rollback → `onSettled` invalidate.

### 14. Multi-tenancy and the pipeline state machine
- Tenant isolation as a *correctness and legal* requirement, not a filter.
- Shared-collection vs database-per-tenant; why `organizationId` on every document is
  both a security boundary and (later) a shard key.
- A state machine as a **pure function + transition table**; why it is trivially testable
  and how it becomes the extension point for per-org configurable stages.

### Self-check before you say "Start Phase 1"

You do **not** need to be an expert. You need to be able to answer, in plain language,
without notes:

1. What is middleware, and why do we run authentication before validation?
2. Why can `authenticate` set `req.user` and have a controller read it later?
3. What is the difference between a controller and a service, and why does it matter?
4. Why is `app.ts` separate from `server.ts`?
5. What does a unique index do that an `if (!exists)` check does not?
6. Why is `{ status: 1, publishedAt: -1 }` the right order for a published-jobs query?
7. What is an N+1 query, and what is the fix?
8. Why is a JWT payload not private, and what must therefore never go in it?
9. Why not store the refresh token in `localStorage`?
10. What is IDOR, and what is the one-line fix?
11. Why 404 instead of 403 for someone else's resource?
12. How do you validate a request, and where in the pipeline?
13. What is server state, and why is it not the same as client state?
14. What is a query key for, and what happens if it is wrong?

If any answer stalls, re-read the matching section. If you can answer 12 of 14 confidently,
start Phase 1 — the remaining two will be learned by building.

---

## Part B — Interview question bank (do not read the answers yet)

Answer **out loud**, in 60–120 seconds each, as if in an interview. Then ask me to
evaluate. I will tell you what you missed and why it matters.

### B1. About this project (structure & scope)

1. Walk me through HireFlow. What does it do and who uses it?
2. What problem does an ATS solve that a spreadsheet cannot? Why is it not just a job board?
3. What did you deliberately leave out of scope, and why?
4. You say it is multi-tenant. What does "multi-tenant" actually mean in your code?
5. Why a modular monolith instead of microservices? What would have to change to extract one?
6. What are the four roles, and what is the *one* action that most clearly separates
   `RECRUITER` from `ADMIN`?
7. What is the single most important query in the whole product, and which index serves it?
8. Walk me through the lifecycle of an application, from apply to hire.
9. What would break first if this had 10 000 times more data?
10. What is the most impressive-sounding decision here that is actually trivial, and what is
    the least impressive-sounding decision that is actually hard?

### B2. Backend & architecture

11. Explain the request lifecycle of `GET /api/v1/organizations/:id/jobs` from TCP to response.
12. Why do you authenticate before validating the body? Give a concrete risk if you reverse it.
13. What is middleware? What can it do besides "call the next thing"?
14. Why is `asyncHandler` needed? What happens without it in Express 4?
15. Why is the error middleware registered last, and how does Express know?
16. What is a service layer, and what do you lose if you skip it?
17. Your controller catches an error and returns 500. What did you do wrong in ten different ways?
18. `app.ts` and `server.ts` — why two files? What breaks if they are one?
19. How do you keep modules from importing each other's internals?
20. Where do you put shared code, and when is `shared/` just a new dumping ground?
21. How would you add a `GET /api/v1/candidates/:id/applications` endpoint without
    violating anything in your architecture?
22. Explain a design where a business rule *cannot* be accidentally skipped. (Hint: the
    validate middleware, and tenant scoping.)

### B3. Database

23. Why MongoDB for this problem? What would Postgres have been better at?
24. Why not store a resume PDF in MongoDB? What is the 16 MB limit and why does it matter here?
25. Explain embedding vs referencing. Give the four-question test.
26. You embed `stageHistory` inside `Application` but reference `Interview`. Why the difference?
27. You denormalise `organizationId` onto four collections. Why?
28. What is a compound index, and how do you decide the field order?
29. What does `explain("executionStats")` tell you, and what are the two numbers you look at first?
30. What is a multikey index, and what limitation does it have?
31. What is N+1, how do you spot it in code review, and what are the two fixes?
32. Offset vs cursor pagination: when must you use cursor, and what breaks with offset?
33. Two users click "Apply" at the same instant. What happens, and which mechanism saves you?
34. What is optimistic concurrency? When would you need pessimistic locking instead?
35. What are MongoDB transactions for, and what do they require of your deployment?
36. How do you delete a candidate and everything that belongs to them? What is hard about that here?
37. How would you add a new pipeline stage later without a painful migration?
38. What is a schema migration strategy that allows zero-downtime deploys?

### B4. Authentication & security

39. Walk me through the entire login → protected request → refresh flow.
40. What is stored in a JWT, what is *not* secure about it, and what must never go in it?
41. Why is bcrypt/argon2 used instead of SHA-256 for passwords? What is a salt?
42. Why is the access token in memory and not in `localStorage`? Argue both sides.
43. Explain CSRF. Which of your endpoints are vulnerable, and why?
44. What is refresh-token rotation, and what is reuse detection? What attack does it stop?
45. How do you log a user out of all devices? Why is "delete the cookie" not logout?
46. What is `tokenVersion` for, and why not just delete the user's tokens?
47. What is the difference between 401 and 403, and why does returning 403 for a
    not-yet-authenticated request leak information?
48. Why 404 instead of 403 for a resource in another tenant?
49. What is IDOR? Give the two-line fix and the test that catches it.
50. How do you prevent a user from seeing whether an email address is registered?
51. You have a refresh token in an httpOnly cookie and a mutation endpoint. What stops CSRF
    here specifically, and what if you turned SameSite off?
52. What is NoSQL operator injection, and what would an attack look like?
53. You accept a PDF upload. List every check you perform and every one you deliberately skip.
54. What is `helmet` actually setting, and which of its defaults would you change for an SPA?
55. How do you configure CORS for a SPA, and what mistake exposes your API?
56. What is rate limiting, and what does it *not* protect against?
57. A user's session was stolen. Walk me through how each of your design choices affects
    the attacker's options.
58. What would you add to this app before it handled real resumes of real people?

### B5. Frontend

59. What are the four kinds of state in this app, and which tool owns each? Why?
60. What is server state and why is it fundamentally different from client state?
61. What is a query key? What happens if two components use different keys for the same data?
62. When should you invalidate a query, and what is the cost of invalidating too much?
63. What is an optimistic update, when is it worth it, and how do you roll it back?
64. Why not put all your state in Redux/Zustand? What specifically goes wrong?
65. What is a "feature folder" and how does it differ from a "type folder"?
66. When do you need `useMemo`/`useCallback`/`React.memo`, and what is the cost of
    applying them everywhere?
67. How would you make the pipeline Kanban feel instant with a slow network?
68. How do you handle the refresh-token race, and what breaks if you skip it?
69. Why does the browser omit my refresh cookie? Name the exact fetch option.
70. How do you decide what is a `components/ui` primitive and what is a feature component?
71. What is code splitting and which routes in this app must be split?
72. A list of 5 000 candidates feels bad. Diagnose it in order: network, render, or data?
73. How do you render a form that must match server validation, without duplicating rules?

### B6. System design & scaling

74. Walk me through designing HireFlow from an empty repo. What do you build first and why?
75. How do you test this application? What does each test level catch that the others miss?
76. The pipeline board query is slow. List, in order, how you diagnose it.
77. You go from 1 000 to 1 000 000 applications. What changes, in order?
78. You now have 5 API instances. What breaks in your current design?
79. Where would you add caching, and what is your invalidation strategy?
80. How would you make email delivery reliable? When do you add a queue?
81. You need to know "how many candidates were rejected for lack of React this quarter".
    Is that a query, a report, or both? How do you make it fast?
82. How would you support 2 000 concurrent users on the pipeline board?
83. What is the CAP trade-off for a hiring system? Would you ever trade consistency for
    availability here, and where?
84. How do you deploy this with zero downtime? How do you roll back a bad migration?
85. What are your observability requirements, and what would you alert on?
86. Where is the data in this system most likely to be leaked from?

### B7. Product & judgement

87. Why does AI output in your system not produce a candidate score?
88. How would you measure whether HireFlow is working, beyond "users signed up"?
89. A recruiter says the pipeline is slow. What do you instrument before changing anything?
90. What candidate experience mistake would make a user never apply twice?
91. What would you cut from your own project if you had half the time?
92. If you had to re-architect HireFlow today, what is the first thing you would change?
93. What is the difference between a feature that is impressive and a feature that is useful?
94. How would you explain this project's value to a non-technical founder in 60 seconds?

### B8. Honest self-assessment prompts

These are for you, not for me. Answer them in writing before the mock interview.

- Which of the 14 gate concepts do I still only half-understand?
- Which three decisions in `05-decisions-and-tradeoffs.md` could I not defend?
- Where in my own code would a reviewer find the most convincing evidence that I understand
  security — and where would they find evidence that I do not?
- What is one thing in this project that is *over*-engineered, and what is one thing that is
  dangerously *under*-engineered?

---

## Part C — How I will evaluate your answers

When you answer, I will assess:

| Dimension | What I am looking for |
| --- | --- |
| **Correctness** | Is the technical claim true? |
| **Causal reasoning** | Do you say *because* / *so that*, or do you just state the practice? |
| **Trade-off awareness** | Did you name what the choice costs? |
| **Context** | Do you tie it to HireFlow, or recite a generic answer? |
| **Boundaries** | Do you know when the answer stops being true? |
| **Honesty** | Do you say "I don't know, here's how I'd find out"? |

That last row matters more than the others. An interviewer trusts a candidate who says
"I don't know, but I would look it up in the MongoDB docs / read the express source /
write a test to find out" infinitely more than one who guesses confidently.
