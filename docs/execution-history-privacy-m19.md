# M19 — Browser-side history privacy and mixed-version compatibility

## Problem

M18 introduces `?view=summary`, but deployments can roll out out of order.
An M17 backend ignores this optional query parameter and returns full histories.
TypeScript's `ExecutionHistorySummaryRun` only describes the response — it
cannot remove full inputs, outputs, step errors, diagnostics, future fields or
run-level error values **at runtime**. Those values would otherwise remain in
the browser's history store, even though the list needs metadata only.

## Changes

- A shared, explicit run/step allowlist builds fresh summary objects. Payload
  fields are never copied, including future backend-only schema properties.
- The history-page API client sanitizes both M18 summary responses and older
  full-detail responses. It also rejects mismatched workflow IDs, malformed
  pages and unexpected >20-row pages instead of storing unverifiable data.
- The Zustand history store independently sanitizes both first-page and
  appended records. This protects callers that bypass the shared API client
  and preserves the 200-run cap and cursor/selection semantics.
- Full details still load only via the existing authenticated selected-run
  endpoint; live execution data, read-only comparisons, and normal execution
  behavior are unchanged.
- Tests demonstrate that root errors, step inputs/outputs, diagnostics, and
  invented future properties never enter the summary page or store. Existing
  history paging, loading, status filters, and comparison tests remain in CI.

## Security and rollout limits

This mitigates **browser history-state retention** when the backend is on M17
and the frontend has moved past M18. It is **not** network-transfer redaction:
an older backend can still transmit full payloads to the browser. M18's
server-side projection must be deployed to Railway for bandwidth and transport
privacy to improve. Similarly, the selected-run endpoint intentionally
returns full authorized run details and must retain owner authorization.

This release has **no Railway dependency for implementation or GitHub CI**.
Prepare a draft PR and a Vercel preview independently; don't merge or deploy
M19 until M18's backend release is reconciled and the user authorizes it.
No DB migrations, additional API routes, live workflow execution or production
smoke tests.
