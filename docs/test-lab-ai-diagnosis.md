# Test Lab — AI-assisted failure diagnosis (Milestone 3)

FlowCraft now offers **read-only, opt-in AI analysis** after a failed Test Lab simulation. This is an advisory preview, not an automatic workflow-repair engine.

## Using the editor

1. Save a workflow, open **Test Lab**, supply mock API/Transform outputs and expected checks.
2. Run the simulation. If a fixture is missing or an assertion/expected branch fails, select **Explain failure**.
3. Review short, low/medium-confidence suggestions on the relevant node. Selecting a node focuses it in the editor.
4. Make any desired corrections yourself, save them as a new revision when appropriate, and rerun Test Lab.

## API

`POST /api/ai/workflows/:workflowId/diagnose-simulation`

Send the **same scenario body** as `POST /api/executions/:workflowId/simulate` with `expectedRevision`, `mocks`, `assertions` and `expectedBranches`.

The server reruns the pinned mock-only simulation using authenticated ownership and immutable revision validation; it does not trust client-submitted failure reports.

If the simulation passes, the endpoint returns `409 SIMULATION_HAS_NO_FAILURES`. Missing or cross-user workflows return 404; revision changes return 409. An unconfigured or unavailable provider returns 503 rather than fabricated advice. Invalid or out-of-scope provider suggestions return 502.

Example success:

```json
{
  "data": {
    "provider": "anthropic",
    "model": "configured-model",
    "provenance": { "workflowRevision": 2, "definitionHash": "64-character-sha256" },
    "findings": [
      {
        "nodeId": "transform",
        "action": "inspect_fixture",
        "explanation": "This test uses a mock Transform result, so the simulated output may not match the expected value.",
        "suggestedNextStep": "Compare the Transform output fixture against the assertion and update the test data if appropriate.",
        "confidence": "medium"
      }
    ],
    "disclaimer": "Advisory only..."
  }
}
```

## Security boundaries

- The provider receives **anonymized node refs** (`n0`, `n1`), node types, error categories, and broad field kinds only.
- It **does not receive** graph source, Transform JavaScript, Condition expressions, labels, node IDs, raw API URLs/headers, mock values, expected values, error messages, or secrets.
- The server maps suggestions back to owned nodes and validates structured output with strict allowed action and confidence enums. Suggestions can only reference failed checks.
- No generated patch is executed, applied or persisted. No test run or workflow changes are written. The provider request is user-triggered and uses the existing AI rate limiter and a 15-second timeout.
- Because this tests **mocked output**, the AI cannot conclude that actual Transform/Condition code or a real HTTP endpoint is broken. Treat suggestions as investigation ideas only.
- Neither the production code execution sandboxing nor outbound API-call restrictions are addressed by this feature; those need a separate security milestone.

Run the root repository CI and browser tests before any merge. No production environment changes are required beyond the configured Anthropic key already used by AI generation.
