# M16 — Execution history performance and reliability hardening

## Why this milestone

M14 adds stable cursor pagination and M15 adds server-filtered status queries. Both
authenticate workflow ownership and constrain the page to at most 20 runs, but
high-volume collections still need efficient database index support. The
existing model declares `{ workflowId: 1, createdAt: -1 }`, which does not
fully cover the new tenant/status predicates or the `_id` tie-breaker.

Earlier isolated JavaScript and outbound HTTP milestones already introduced
their security guardrails. M16 does not replace these features or claim a
comprehensive security review.

## Query and data safety

- The authenticated, owner-verified page API and M14 v1/M15 v2 cursor formats
  remain unchanged. Sorting stays `createdAt DESC, _id DESC`, with limit+1
  to detect a next page. No snapshot consistency is promised under concurrent
  deletion or changes to historical records.
- Each history page MongoDB query has a **4,000 ms server-side execution budget**
  via `maxTimeMS`. MongoDB error code 50 becomes HTTP 503 with a fixed
  `HISTORY_QUERY_TIMEOUT` code and generic retry message. It is not retried
  automatically and does not leak query or database internals. Other database
  errors retain the existing global error handling.
- History uses an explicit allowlist projection of **existing API fields**,
  including historical step logs for inspection/comparison; this prevents new
  future model-only properties (such as fencing data) from being exposed
  automatically. It does **not** redact historical step-log content or reduce
  the number of loaded step logs. Existing owner-only access and inspector
  redaction remain necessary.
- The established per-route rate limiter and 200-run browser history cap
  remain intact. No write, rerun, migration, or operational query occurs.

## Index readiness: read only

The existing authenticated owner-scoped diagnostics endpoint now returns
`historyIndexReadiness: { unfiltered, filtered }` with each status strictly
`ready`, `not_ready`, or `unavailable`. It makes one index-catalog read
alongside the existing retry-index check, **after ownership verification**.
Errors fail closed to `unavailable` without database text, index definitions,
user IDs or secrets in the response.

Readiness requires these exact, non-partial, non-sparse, visible index keys:

- Unfiltered: `{ workflowId: 1, userId: 1, createdAt: -1, _id: -1 }`
- Filtered: `{ workflowId: 1, userId: 1, status: 1, createdAt: -1, _id: -1 }`

These are **proposed candidate indexes**, not indexes created by this PR.
Conservative `not_ready` can occur for semantically equivalent alternate
indexes or indexes with collation options. Even `ready` proves only that a
matching index exists, not that MongoDB's planner chose it or that performance
targets are met. Before an authorized production change, inspect representative
`explain('executionStats')` output, index sizes, MongoDB version, write
amplification, tenant distribution and index build impact.

**Do not add these index declarations to the Mongoose schema yet:** index
auto-creation can apply DDL during production startup. Only after separate
approval should operators plan and execute any production index build.
Never run live DB migration or manual deployment as part of M16 verification.

## Tests and release

M16 regression coverage checks the bounded query, allowlisted projection,
safe timeout behavior, ordinary error propagation, tenant verification,
readiness specificity, no index catalog lookup before authorization and
failure redaction. Existing M14/M15 tests still cover page bounds, cursor
versions, status isolation, equal-timestamp tie breakers and stale responses.
Verify exact PR SHA in GitHub Actions (types, lint, Vitest, build, Playwright,
offline smoke harness). CI tests mock DB history reads, so no production load
benchmark or execution end-to-end success is implied.

**No merge, production deployment, index build, manual production smoke,
or live side-effectful execution without separate explicit authorization.**
