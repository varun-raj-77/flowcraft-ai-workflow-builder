# M17 — Cancellable execution-history reads (browser only)

## Problem and scope

M14 introduced bounded cursor paging and M15 added status filters; both protect
UI state against late responses. Nevertheless, a request from a prior workflow,
status filter, or closed inspector can continue consuming browser/network
resources after the user has moved on. M17 cancels **obsolete HTTP requests**
via `AbortController` while retaining the existing stale-response identity guards.

- The authenticated first-party `listExecutionHistoryPage` client accepts an
  optional `AbortSignal`; existing callers and query URLs remain compatible.
- The history inspector aborts pending initial or older-page reads when its
  workflow/filter changes or the History tab unmounts.
- A new refresh supersedes an older-page request, rather than allowing both
  page requests to overlap.
- Aborted requests never surface generic history errors or replace a newer
  page; reopening the inspector reloads when a prior request was interrupted.
- No changes to execution submission, retry behavior, browser run selection,
  comparison, endpoint contracts, API permissions, or DB indexes.

## What this does *not* prove

An HTTP abort doesn't guarantee that the backend's already-started database
query is cancelled, nor does it reduce per-page execution payload size. M16's
server query budget remains a separate protection, and a later milestone can
add bounded summary-only history reads plus on-demand full-run details.

M17 is intentionally independent of M16's server changes and can be reviewed
on a branch based on the current main. Tests mock browser HTTP requests; they
verify signal forwarding, stale-filter cancellation, tab-unmount cancellation,
re-entry recovery, and preserved existing pagination behavior. No live
side-effectful workflow execution is required.

**Release policy:** merge or production redeploy only after exact-head CI,
preview verification where available, and separate explicit approval.
