# M8 — Reliable terminal execution states and failure notifications

## Problem verified against main

The existing execution engine processes a revision-pinned graph and records node-level progress. It had three failure paths with inconsistent lifecycle results:

- Missing or invalid pinned revisions marked the run failed, but could leave the pre-created step list in `pending` rather than marking work that never executed as skipped.
- A database failure retrieving the pinned revision could reject the runner before any catch block. The controller logged the exception but the persisted run could remain `running`, with no terminal Socket.IO event.
- The general engine-level catch persisted `failed` but returned without emitting `execution:complete`. Additionally, its error text and a node failure's interpolated label could expose source-controlled or exception-supplied sensitive text.

These are actual reliability gaps, not a change to user-facing execution semantics for valid workflows.

## Implementation

- Wrap the entire asynchronous execution processor with a fail-closed lifecycle boundary, including pinned revision lookup.
- Introduce `finalizeFailedRun` as the common path for preflight errors and unexpected infrastructure/engine failures.
- On failure, preserve completed steps, mark unexecuted `pending` steps `skipped`, mark interrupted `running` steps `failed`, fill terminal time and duration, and persist the modified document.
- Only **after a successful persistence** emit exactly one terminal `execution:complete` event to the authorized run room.
- Persist static, non-sensitive messages for unexpected failures and immutable revision integrity failures; redact user-controlled node labels in ordinary execution error summaries.
- Keep normal success output, execution ordering, conditional branching, Transform diagnostics, request authorization and existing revision integrity enforcement unchanged.

## Verification

The new `executionLifecycle.test.ts` exercises synthetic runs (no MongoDB/network side effects) and verifies:

1. Successful execution emits completion after persistence, once.
2. Legacy unpinned runs fail with skipped steps and a terminal event.
3. Missing revision failures persist and emit a terminal event.
4. Pinned revision lookup errors do not leak exception text or leave runs stuck.
5. Invalid pinned revision graphs reveal only a fixed safe message.
6. Unexpected engine bookkeeping corruption finalizes an interrupted step.
7. Failed node errors redact sensitive labels and propagate sanitized completion.
8. A failed database save does **not** emit misleading completion.
9. Immutable lookup always includes the run owner, revision and exact definition hash.

Full CI runs frontend/backend tests, typecheck, lint, build and Playwright. There is no production smoke or authenticated production request in this milestone.

## Explicit limits and follow-ups

The outer boundary is **best effort**, not a durable cross-process job queue. If the server process crashes, the database is unavailable when saving the final result, or the container is terminated, a run can still remain stale. Do not claim recovery after infrastructure loss. Durable worker leases, watchdog reconciliation, idempotency keys and timeout-based stale-run recovery require a separate scoped milestone and design.

No database schema migration, workflow mutation, active-run cancellation, retry policy, or new external API calls are included. A post-merge deployment can happen only after explicit owner approval. Treat the authenticated disposable production smoke check as separate and never auto-dispatch it.
