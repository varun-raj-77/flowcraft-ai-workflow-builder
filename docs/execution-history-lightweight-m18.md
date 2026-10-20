# M18 — Lightweight execution-history pages and selected-run hydration

## Why

M14–M17 made history paging bounded, owner-scoped, status-filtered, index-aware and browser-cancellable, but each history page still sent complete persisted step inputs, outputs, diagnostics and errors. Those values can be large and may contain confidential workflow data, even though the history list and read-only comparison do not need them.

## Contract

- `GET /api/executions/workflow/:workflowId/page?view=summary` opts in to **metadata-only step logs**: `nodeId`, `nodeType`, `nodeLabel`, `status`, `durationMs`, plus selected existing run metadata, pin hashes, revision identifiers and cursors.
- Projection explicitly excludes step `input`, `output`, `error`, `diagnostic`, run `error`, lease fields and any future model-only fields. It is a MongoDB subfield projection, not just JSON response filtering.
- Omitted `view` or `view=full` retains the established full history API contract. Invalid view values return `INVALID_HISTORY_VIEW` HTTP 400 before any DB access.
- Both views preserve M14/M15 cursor shape, status binding, owner verification, 20-row page cap, M16 4s query budget, rate limiting, and existing indexes. No DB migration or DDL.
- The browser inspector now requests the summary view for pages and keeps at most 200 lightweight rows in its history store. Step status/duration/node type still permit the existing read-only same-revision comparison and list counters.
- Opening a historical run triggers one existing authenticated `GET /api/executions/run/:runId` full-detail read; the single-run endpoint independently checks the user, and client also verifies the run ID and workflow ID before rendering timeline or variables. Only the selected full run is kept in local inspector state, not in history pages.
- Switching run/workflow aborts obsolete detail fetches and ignores late responses. Loading, error and explicit retry states never substitute current live data for failed historical detail.

## Verification and limits

Unit and component tests cover strict query parsing, index-safe projection, cursor/tenant isolation, legacy full view, summary API URLs, lazy loading, retry, stale workflow switching, and existing comparison. Playwright still checks canonical workflow journeys.

This reduces browser transfer and avoids loading large step payloads on history pages; it **does not** reduce MongoDB document scan costs for the projected arrays, guarantee sublinear query time without an index, redact user-written node labels, or restrict access to full details of an owner-accessible run. Aggregated payload reduction must be measured on representative fixture sizes; no live database benchmarks are claimed.

Release guard: no PR merge, manual production deployment, live execution, production index build, or side-effectful production smoke without separate approval.
