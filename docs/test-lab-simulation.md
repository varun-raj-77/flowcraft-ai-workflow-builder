# Test Lab — Safe simulation foundation (Milestone 1)

The backend-only first milestone introduces an authenticated, **read-only** endpoint:

`POST /api/executions/:workflowId/simulate`

It verifies ownership and the exact saved current workflow revision, including its immutable definition hash. It does **not** create an ExecutionRun, advance the revision pointer, write database records, emit Socket.IO events, or execute production node executors.

## Example request

The workflow must already exist at the specified `expectedRevision`. All API, Transform, and Condition nodes reachable during the test **require explicit mock outputs**. Sample node IDs below are illustrative; use IDs from your own graph.

```json
{
  "expectedRevision": 2,
  "mocks": {
    "fetch": {
      "status": 200,
      "data": [{ "id": 1, "name": "Example" }],
      "headers": { "content-type": "application/json" }
    },
    "filter": { "count": 1 },
    "decision": { "branchTaken": "true" }
  },
  "assertions": [
    { "nodeId": "fetch", "path": "status", "equals": 200 },
    { "nodeId": "filter", "path": "count", "equals": 1 },
    { "nodeId": "print", "path": "message", "equals": "Found 1 item" }
  ],
  "expectedBranches": { "decision": "true" }
}
```

Results include `status: "passed" | "failed"`, per-node `simulated`, `mocked`, `failed` or `skipped` states, boolean assertion results, and verified revision/hash provenance. Assertion reports intentionally omit compared values. Node mock outputs are redacted before returning.

## Security and scope

- **No real network requests** or API credentials: API nodes return only fixture-provided `status`, `data`, and `headers`.
- **No user-authored JavaScript is evaluated**: Transform nodes require output fixtures; Condition nodes require `branchTaken: "true" | "false"` fixtures.
- Condition fixtures test **graph routing**, not the truth of the original condition expression. Transform fixtures test **downstream contracts**, not the original transformation code.
- Start and End return empty objects, Delay returns the configured virtual delay without sleeping, and Output resolves simple field templates without printing messages to logs.
- The result is **ephemeral** and does not appear in run history.
- 80 node / 160 edge cap, 50 KB fixture/assertion payload cap, and the existing execution endpoint rate limiter apply.
- Any unmocked API/Transform/Condition node **fails closed**, rather than falling back to production execution.
- Wrong revision returns 409; missing or cross-user workflows return 404; corrupted revisions still fail integrity verification.

## Not included in Milestone 1

A visual Test Lab panel, editable saved test suites, actual transform/condition execution in a hardened sandbox, retry/cancellation, deterministic partial replay, and CI workflow assertions are future milestones. This foundation deliberately does not introduce unsafe JavaScript evaluation as part of the simulation feature.

Run `npm run typecheck`, `npm run lint`, and `npm test` from the repository root to validate this change. No production deployment or data migration is necessary until this PR has been reviewed and approved.
