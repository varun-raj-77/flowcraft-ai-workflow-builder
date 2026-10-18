# M9 — Crash-safe abandonment detection without workflow replay

## Why this exists

M8 made ordinary execution exceptions terminal, but **process termination** (Railway recycle, worker crash, forced shutdown) can strand persisted runs in \`running\`. The previous server had neither per-run ownership, a persisted activity lease, nor a way for a different instance to distinguish abandoned runs from active ones.

M9 adds **bounded automatic reconciliation** of newly leased runs. It explicitly does **not resume or replay any workflow**. A stale run becomes **failed / interrupted**, and remaining steps are marked skipped. Users must choose how to investigate and rerun a workflow.

## Core ownership and race contract

- When starting a new run, an unguessable **UUID leaseOwner token**, \`leaseHeartbeatAt\`, and \`leaseExpiresAt\` are stored with the revision-pinned run inside the existing MongoDB transaction. An index on \`(status, leaseExpiresAt)\` supports recovery scans.
- Lease duration **120 seconds**. The owner renews it every **15 seconds** while an execution is active, and checks ownership before each step, after an external executor returns, and before terminal writes.
- Every step checkpoint and final status write uses an **atomic compare-and-set** requiring the correct \`_id\`, \`userId\`, \`leaseOwner\`, \`status=running\`, and a future lease expiration. This prevents an old process from overwriting a recovery decision or a finished run.
- Running/finished/failed/skipped checkpoints are persisted, so a recovered run can retain completed work and correctly distinguish a currently executing step from work never started.
- On startup after MongoDB is connected, and every **30 seconds**, a bounded monitor scans up to **25** expired, leased, still-running records. For each candidate it builds the terminal step state, then attempts one atomic update conditional on the **original exact lease expiration**, token, owner and status.
- Competing recovery workers cannot both win the update. A heartbeat that extends the expiration or a terminal writer changing the status defeats an out-of-date claim. The scanner never calls executors, external HTTP, AI generation, or workflow create/modify/delete APIs.
- When the running worker loses its lease, it stops beginning new steps and refuses terminal writes. It cannot claim the lease again.
- Recovery writes a fixed non-sensitive failure reason: "Execution interrupted after its worker lease expired. No steps were replayed." In-flight steps become failed, pending steps become skipped; completed steps remain unchanged.
- Internal lease tokens and timestamps are hidden from normal serialized run objects and stripped from lean execution-history lists. Logs carry counts and static event categories, never payloads or tenant content.

## Automated coverage (all offline)

The \`executionRecovery.test.ts\` suite uses mocked MongoDB queries to verify initial leases, renewal fencing, stale owner rejection, conditional terminal writes, conversion of all step states, bounded scans, healthy-run exclusion, heartbeat-vs-recovery races, competing-worker claims, malformed record refusal, and DB failures.

The existing pinned execution tests also verify **no first external API call** after initial lease loss and **no subsequent execution or terminal overwrite** when lease expires while an API Call is in flight. The new code does not resume or replay the API Call.

The entire existing Vitest + TypeScript + lint + build + Playwright CI remains required for the draft PR.

## Important limits and rollout safety

**M9 provides safe abandonment detection, not exactly-once execution.** Side effects from an already in-flight external API request **cannot be recalled** after the worker loses its lease. The recovery scanner never initiates a second request, but preventing all side effects across crashes and retries requires provider idempotency keys/fencing and a durable job protocol, which are outside this milestone.

- Runs created before M9 have **no lease fields**. They are deliberately **excluded** from automatic recovery to avoid falsely interrupting pre-M9 workers during a rolling deployment. They require a separate migration or manual diagnosis; do not silently convert them.
- A failed MongoDB write prevents checkpoint/finalization. The scanner retries on subsequent intervals without claiming success. A long DB outage can delay discovery.
- A worker whose lease is lost returns without overwriting persisted recovery state; the browser should reload historical run state after reconnect. Cross-replica Socket.IO broadcast and proactive recovered-run completion notifications are not guaranteed here.
- The startup monitor makes database writes only to **expired M9-leased running records**. Initial production rollout must be separately approved, including its normal deployment.
- No automatic continuation, retry, migration of historical runs, release smoke dispatch, or new external API calls.
- The error code/status surface remains existing \`failed\`; interruption is explained by the persisted static error string, not a new schema-wide enum.
- Existing CI Node.js runner/action deprecation warnings are unrelated and nonblocking.

## Operational verification following owner-approved merge

1. Confirm post-merge CI passes at the merge SHA.
2. Verify Vercel and Railway deployed that exact commit and the backend connected to MongoDB.
3. Check Railway structured logs for \`execution_recovery\` count-only events and \`execution_recovery_failed\` (without copying private data).
4. **Do not manufacture stranded runs in production** or dispatch production smoke without a separate approval. Use synthetic unit/race tests as the default evidence.
5. If recovery fails, inspect DB connectivity, worker clock skew, index status and M9 lease fields in restricted operational tools. Never manually rerun a workflow in response to an interruption without confirming side-effect risks.
