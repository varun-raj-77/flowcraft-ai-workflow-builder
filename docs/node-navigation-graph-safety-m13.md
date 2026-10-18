# M13 — Node discovery and safe graph editing

## User-facing behavior

- The editor toolbar has a **Find node** button. Use `Ctrl+K`/`Cmd+K` when focus is outside an editable input, or click the toolbar button.
- Search matches a node's **visible label or node type only** (case-insensitive). It does not inspect API configuration, authorization headers, credentials, or execution payloads. Exact and prefix matches appear first. The list is bounded to 30 nodes, with a clear first-30 message when capped.
- Press Enter in search to navigate to the first result, Escape to dismiss and restore keyboard focus to the toolbar trigger. Clicking a result opens its configuration and centers the canvas. Finding never updates workflow nodes or creates undo/redo entries.
- Each focusable **Workflow preflight** finding now centers its node on the canvas as well as selecting it. The same read-only limits still apply during immutable revision previews and comparisons: Find node and editing actions are disabled.
- Canvas centering uses an **ephemeral UI request** scoped to the currently loaded workflow; stale or mismatched requests are consumed without targeting another graph. This is separate from execution replay/inspector selection, and each request centers once so subsequent pan and zoom remains in the user's control.

## Safer connections

The canvas and the workflow-store `onConnect` mutation now use the same validation logic, rejecting:
- Self-connections, missing endpoints, incoming links to Start, and outgoing links from End
- Existing duplicate source-handle/target links (condition true and false handles remain independently valid)
- Links that would introduce a directed cycle into an acyclic workflow

Validation also runs **inside** the Zustand state update so delayed UI callbacks cannot bypass it. Rejected connections do not mutate the graph, dirty the saved workflow, or create undo entries. Existing invalid saved graphs are left intact for preflight review rather than silently rewritten. The original preflight remains the final client validation surface and backend validation remains authoritative for persisted executions.

## Verification and deployment boundary

- Pure tests for matching/ranking/30-item bounds, config privacy, valid condition branches, missing endpoints, duplicate links and cycle detection in cyclic and acyclic existing graphs.
- Store tests cover rejected-link no-ops, no dirty/undo side effects and undoability of valid connections.
- Toolbar UI tests cover search selection, keyboard access and cancellation, read-only preview, and navigation from preflight issues.
- Full CI includes frontend and backend Vitest, typechecking, lint, production build, Playwright Chromium and **offline-only** M7 smoke harness unit tests. Do not dispatch live production smoke.
- No new backend APIs, migrations, AI calls, billing changes or external side-effectful operations. Merge and normal deployment still require a separate explicit approval of the exact PR head.
