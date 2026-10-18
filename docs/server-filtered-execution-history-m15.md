# M15 — Server-filtered execution history

## Problem and user experience

M14's paginated history can load 20–200 runs but its status dropdown only filters loaded rows. A historical failed run at position 201 is invisible to a user who selects **Failed**, despite that filter appearing to cover execution history.

**M15 queries the selected status at the authenticated backend.** In the Execution Inspector's History tab, use **Find runs by status** to retrieve all matching runs through the same bounded paging API. Load older matching runs in batches of 20; new filters begin at the first matching page. `all` remains the default, preserving existing unfiltered functionality.

## Backend contract

`GET /api/executions/workflow/:workflowId/page?status=failed&limit=20&cursor=<token>`

- `status` is optional: absent / `all`, `running`, `completed`, `failed` or `cancelled` only. Invalid values, arrays, Mongo operators and case variants return `400 INVALID_HISTORY_STATUS` before any DB query.
- No change to the legacy list endpoint. All requests remain authenticated, rate-limited, and owner-checked; the query includes both the workflow and the owner even after ownership verification.
- Matching pages remain strictly ordered by `createdAt DESC, _id DESC`, bounded by `limit + 1`, with the next page cursor only when a further matching run is present.
- **Cursor compatibility:** M14 `v1` cursors continue to work when filtering `all`. New `v2` cursors for named statuses encode the selected enum and refuse reuse with a different filter; malformed or mismatched cursors return `400 INVALID_HISTORY_CURSOR`. Cursor payloads include no labels, user IDs, execution contents, errors, or credentials. Cursors are *not* authorization tokens; server ownership predicates remain authoritative.
- No index DDL, schema migrations or writes. Existing indices are reused. Query profiling and a dedicated composite index are deferred to separately authorized performance readiness work.

## Frontend invariants

- Status changes restart at the first backend page, reset older-page cursors and clear comparison/selection from the previous result set. They never change the active execution or its step logs.
- Multiple in-flight filter requests and older pages are guarded against stale responses. Users can switch filters even while a request is pending or has failed.
- The in-memory limit remains 200 loaded runs *per current status*. The UI does not claim to show all matching runs; it discloses loaded count and cap.
- Failure and cancellation statuses are historical records only; no automatic retry, replay, external API request or side-effectful operation is initiated.

## Verification

- Service tests: strict enum input, owner scoping, version compatibility, status cursor binding, status-filtered limit+1 and invalid input before DB reads.
- Client tests: encoded URLs, filter-specific reloads, reset state, preservation of live runs, rapid request race and cursor safety.
- Playwright: fixture contains a failed run beyond the first 20 entries; choosing **Failed** reveals that run without loading all preceding records.
- Full CI: frontend and backend unit tests, typecheck, lint, production build, Chromium Playwright and offline smoke harness.

**No merge, production deployment, manual production smoke or live side-effectful test without separate owner authorization.**
