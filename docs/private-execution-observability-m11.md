# M11 — Private execution observability and retry readiness

## Scope and privacy boundary

M11 adds a **read-only, authenticated, owner-scoped** diagnostic GET:
\`GET /api/executions/workflow/:workflowId/diagnostics\`

This route is under the existing /api/executions authentication and trusted-origin middleware, and has its own 12 requests/minute per-IP limiter. It first verifies the workflow belongs to the authenticated user. Invalid, deleted or other-user workflow IDs return the same 404, **before any** execution or index-catalog query.

The query reads **the latest 50 executions only**, sorted newest first, with a narrow projection:
\`status error retryOfRunId startedAt completedAt leaseExpiresAt\`.
It intentionally does not return IDs, workflow contents, step logs, inputs, outputs, error text, user IDs, secrets, or lease-owner fencing tokens.

### Response contract

- \`scannedAt\`: the server timestamp at classification time.
- \`sampleSize\`, \`sampleLimit: 50\`: number of newest run records actually sampled and bound.
- \`counts.running/completed/failed/cancelled\`: distinct execution terminal states.
- \`counts.interrupted\`: exact M9 recovery error among failed runs.
- \`counts.otherFailures\`: failed runs with other error classifications.
- \`counts.retriedAttempts\`: attempts carrying a retry source reference.
- \`counts.expiredRunningLeases\`: leased running records whose expiry has passed as of \`scannedAt\`; this is a **snapshot**, not proof the worker died.
- \`averageTerminalDurationMs\`: average duration of **valid nonnegative** completed, failed or cancelled records; \`null\` if none.
- \`retryReadiness\`: \`ready\`, \`not_ready\`, or \`unavailable\`. The last is a safe failure mode when the index catalog cannot be read.

The report is a bounded **sample of the newest 50** runs, not a full-history count or a global production dashboard. No cross-tenant, platform-wide, or process-wide telemetry is sent to ordinary users.

### Index safety

A shared \`checkRetryReadiness\` helper validates the *live* MongoDB catalog entry: single-field ascending \`retryOfRunId\`, unique flag set, and ObjectId partial filter. The **same function** gates M10 retry creation; if it is \`not_ready\` or \`unavailable\`, the retry operation returns HTTP 503 **without creating an execution**. M11 does not create, drop, rebuild or mutate indexes. No private Mongo URI, catalog contents, error stacks, or source tokens are exposed.

### Structured operational events

- After a **persisted** workflow result: \`execution_terminal\` with enumerated \`status\` and \`cause\` only. No user IDs, run IDs, labels, API response or exception message.
- Recovery: \`execution_recovery\` with a bounded recovered count and scan duration, or \`execution_recovery_failed\` with duration only.
- Healthy monitor: \`execution_recovery_monitor_healthy\` after ten consecutive empty successful scans (about five minutes under normal cadence).
- Startup: \`retry_index_readiness\` with the coarse readiness enum, after the database connects.
- Existing HTTP request logs now use the static Express **route template**, not a concrete URL path, and accept a caller-provided correlation ID only if it is UUID-shaped; otherwise a fresh UUID is generated. Authentication and rate-limit warnings no longer emit user-supplied URL paths. Unexpected execution-processing logs no longer include exception bodies or run IDs.

These events are **per-process best-effort logs**, not durable metrics, long-term analytics, or external alert rules. Railway or an external log/monitoring service must be configured separately for historical dashboards and notifications. A server crash can prevent a terminal event. Recovery and M9 fencing semantics are unchanged.

### CI and tests

Use offline Vitest tests for:
- exact index shape, absent/wrong index and index read errors;
- 50-record query bound, tenant ownership, no lookup on unauthorized IDs;
- interrupted/retried/stale counters and robust timestamp arithmetic;
- absence of raw error text, IDs and workflow contents from diagnostic response;
- untrusted request ID and raw path redaction;
- regression tests for preexisting M9/M10 execution fencing and retry idempotency.

CI uses \`actions/checkout@v5\` and \`actions/setup-node@v5\` to address runner **action runtime** deprecation, but deliberately retains the app's Node.js 20 test target. Browser and offline smoke harness remain unchanged.

### Safe rollout and explicit non-goals

No new public health/metrics endpoint, unauthenticated admin endpoint, migrations, executor calls, synthetic production writes, manual production smoke, or live retry checks in this milestone. The existing public \`/api/health\` response stays minimal.

Only owner-approved merge may trigger normal deployment. Verify the exact SHA, post-merge CI, Vercel and Railway health separately. A successful deployment does **not** independently confirm the live unique index or active monitor behavior; both need safe *separate* operational checks after approval.
