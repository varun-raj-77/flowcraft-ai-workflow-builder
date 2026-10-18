# M10 — Explicit interrupted-execution retries and recovery UX

## Contract

M9 marks runs failed when a worker lease expires; an external API request may **already have caused an effect**. M10 adds an intentionally conservative new-attempt workflow. It is **not** a resume, an automatic retry, or exactly-once delivery.

### Eligibility and authorization

- The source run must exist **under the caller's userId**, have status \`failed\`, and carry the **exact** M9 interruption error string.
- A caller must explicitly POST \`{"acknowledgeExternalSideEffects":true}\` to \`/api/executions/run/:runId/retry\`. No implicit or scheduled retry exists.
- The source and workflow are rechecked inside the same MongoDB transaction that initializes the new run.
- The **current immutable revision ID, revision number and definition hash must match the source run**. If a workflow was edited/restored since interruption, the API returns HTTP 409, does not run a changed graph, and asks for a separate user decision.
- A fresh run gets pending steps, its own lease and an immutable reference \`retryOfRunId\` to the source run. It does not copy outputs or resume from the interrupted step.

### Durable idempotency

MongoDB enforces a **unique partial index on retryOfRunId**. At most one new run is initialized per source run, even for simultaneous requests from separate tabs/instances, provided the index exists and is healthy. Repeating POST returns the existing run with HTTP 200 and **does not** start its processor again. A winning transaction returns 201 and starts processing once.

Duplicate key handling is constrained to the \`retryOfRunId\` index; unrelated index errors remain errors. A failed HTTP response is ambiguous: the request may have committed before its connection dropped, so clients should inspect history or repeat the same source-run request (rather than starting a normal manual run).

### Execution inspector

- A dedicated amber recovery panel appears **only** for M9-interrupted runs in Live or Timeline (including historical selection).
- It displays completed, interrupted and skipped steps; notes that a previous API Call may already have executed, and requires a checkbox acknowledgement before enabling **Start one new attempt**.
- While a request is pending the control is disabled and protected by an in-memory click latch; a backend unique constraint is the authority across tabs/instances.
- Dirty edits, revision previews/comparisons, other active runs and different workflows block the action in the client. The backend repeats all critical checks.
- After creating or retrieving the one retry run, the inspector switches to Live. Durable run-state polling also runs while the selected workflow's panel is mounted to surface M9 recovery outcomes even without a cross-instance Socket.IO event; late responses cannot overwrite a newly selected run.

### Limitations

This prevents duplicated *retry creations for the same source*, not all external effects. Starting one new attempt deliberately executes the **entire saved workflow again**; a previous API request or email could have succeeded despite a worker crash. A later interruption of the retry is itself a new source and may allow another acknowledged attempt. Full exactly-once semantics require provider-specific idempotency keys, a durable outbox or transport support, and a different cross-run policy.

A process crash after committing a new retry but before dispatching its worker can leave it pending until M9 lease recovery marks it failed. Repeated retry requests **never dispatch that same run again** (fail-closed).

Database index rollout must complete before serving concurrent retry traffic. During deployment, normal API route use should not be considered safe until the unique index is confirmed built on the target database. No migration of legacy executions is required.

### Verification

Backend regression coverage includes cross-user 404, missing acknowledgement, non-interrupted source rejection, immutable revision drift/hash mismatch, creation with new lease and lineage, deduplication, duplicate-key race and unrelated errors. Frontend tests cover eligibility, opt-in, one click, disabled states, revision conflicts and switching to the new run. Run full CI including unit suites, lint, typecheck, build and Playwright.

Do **not** run a live retry in production during testing without separate consent: it can reissue real API calls. No manual production smoke, merge or deployment is permitted without the owner's separate approval.
