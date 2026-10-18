# M14 — Cursor-paginated workflow execution history

## Why

The M12 inspector loads only the most recent 20 runs. Operators cannot compare older attempts, retrieve earlier failures, or investigate trends across a longer period without using external tooling.

## Implementation

- **New read-only API**: `GET /api/executions/workflow/:workflowId/page?limit=20&cursor=<opaque>`. Keeps the legacy `GET /api/executions/workflow/:workflowId` unchanged for backwards compatibility.
- **Strict, deterministic keyset**: sort `createdAt DESC, _id DESC` and request `limit + 1` rows to identify whether a next page exists. The versioned base64url cursor contains only the last row's timestamp and ObjectId, not payloads or user identifiers; invalid cursors and limits return typed 400 errors. Limit 1–20.
- **Authorization**: check valid workflow ID and `Workflow.exists({_id: workflowId, userId})` before querying runs. Every page is filtered by both `workflowId` and `userId`. Cursors are not authorization tokens; changing their contents cannot remove tenant constraints.
- **Privacy**: do not return lease owner/heartbeat/expiry fields. Existing owner-authenticated run payload access and inspector-side redaction remain unchanged. No new telemetry or logs of user values.
- **Frontend**: History initially loads 20 runs; **Load older runs** progressively adds pages. Deduplicate overlapping rows, preserve baseline and historical selection, leave current live run untouched, and separately show/retry older-page errors without throwing away already loaded results.
- **Workflow races**: reject stale page responses after switching workflows or changing cursors. Refresh resets the page and starts from newest again.
- **Memory bound**: at most **200** hydrated runs in the browser. The interface explains the cap and invites a refresh. Status filtering remains client-side and explicitly describes only *loaded* runs—not all past history.

## Non-goals and release safety

- No run creation, replay, retry, webhook, mutation, automatic execution, database migration or destructive operations.
- No count or offset queries and no promise of snapshot-perfect pagination if historical runs are deleted or mutated concurrently. Tie-breaking avoids duplicate/omitted positions for equal timestamps under static data.
- The existing workflow/createdAt MongoDB index remains in place; a future index readiness/performance review can consider a dedicated `(workflowId,userId,createdAt,_id)` index before scaling.
- Tests: cursor parser/limit, user scoping, tie-breakers, empty pages, frontend encoding, store dedup/race/cap, UI paging and retry; plus full frontend/backend Vitest, typecheck, lint, builds, Chromium Playwright and **offline only** M7 harness safety checks.
- **No merge, deployment, manual production smoke, or live side-effectful execution without explicit additional approval.**
