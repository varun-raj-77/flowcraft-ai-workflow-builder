# Test Lab — Isolated JavaScript mode (Milestone 5)

FlowCraft offers two **explicit** Test Lab modes:

- **Mock only (default):** API, Transform and Condition nodes use supplied fixtures. No user code executes. Existing request bodies without `mode` continue behaving exactly as before.
- **Isolated JS (opt-in):** API nodes still use JSON fixtures with no outbound network calls. Saved Transform JavaScript and Condition expressions execute in the already-deployed, resource-limited QuickJS/WASM runner. No production node executors are invoked.

## Editor workflow

Save a workflow revision, open **Test Lab** and choose **Execution mode → Isolated JS**. Enter mock responses for API Call nodes and optionally specify assertions for Transform output fields or expected Condition branches. Click **Run simulation** to execute the actual saved JavaScript under QuickJS, without executing API Call requests, sleeping for Delay nodes, emitting socket events, writing run history or logging Output nodes.

The UI hides Transform mock-output editors and manual Condition branch selectors in this mode. It keeps expected Condition branch assertions so a simulated code branch can be verified against a desired outcome.

## API contract

`POST /api/executions/:workflowId/simulate`

```json
{
  "expectedRevision": 4,
  "mode": "isolated",
  "mocks": {
    "fetch": {"status": 200, "data": [{"id": 1}], "headers": {}}
  },
  "expectedBranches": {"decision": "true"},
  "assertions": [{"nodeId": "transform", "path": "count", "equals": 1}]
}
```

Response includes `mode: "isolated"`, `status`, redacted per-node outputs, step statuses, assertion results and the verified `workflowRevision`/`definitionHash` provenance.

**Only API mocks are permitted** in isolated mode. Passing mocks for Transform or Condition nodes is rejected with HTTP 400. Every reachable API Call node requires a mock: missing API mocks fail closed. The request uses the same 50 KiB scenario limit and revision-pinning/ownership rules as the existing Test Lab.

## Safety and limitations

- Isolated JavaScript runs under the QuickJS/WASM worker's existing memory/time/concurrency limits; at most **12 script nodes** per isolated test are accepted.
- The guest cannot use Node `process`, `require`, filesystem, network, or host APIs. The sandbox is **not** an OS-hardened microVM, and should not be described as sufficient security for arbitrary hostile multi-tenant usage.
- A Condition runtime failure **fails the Test Lab** with a static machine error code instead of selecting a misleading false branch. This differs from production's legacy behavior for ordinary invalid Condition expressions. The Test Lab is a diagnostic tool, not an exact emulator of every runtime side effect.
- Outputs are **redacted before** later nodes consume them, so scripts that rely on secret-bearing fields may behave differently than production.
- Only JSON-compatible synchronous JavaScript is supported by the current runner. Script error messages and guest stack traces are **not** returned to the Test Lab client.
- The default mock-only simulator and associated **AI-assisted diagnosis** are unchanged. AI diagnosis deliberately refuses isolated-mode scenarios until its prompts and product disclosures have been designed for real logic evaluation.
- Neither mode writes execution history, edits the workflow, calls node-specified URLs, or automatically applies repairs.
- Isolated test responses may reflect nondeterminism in guest JavaScript (such as `Math.random()` or `Date.now()`). Don't assume true determinism.

## Verification and rollout

The PR adds tests using **real QuickJS**, testing API mocks, actual true/false branching, assertions, guest escape attempts, timeout/guest errors, revision ownership and UI mode toggles. Run typecheck/lint/unit/build/Playwright in GitHub CI. Review representative existing saved-workflow compatibility before enabling the new mode broadly.

No production merge or deployment is authorized until separate user approval.
