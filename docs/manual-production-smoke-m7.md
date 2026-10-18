# M7 — Manual read-only production verification

FlowCraft now has an **independent, manual-only** verification workflow at .github/workflows/read-only-production-smoke.yml. Its default is two anonymous GET checks. An explicitly authorized second mode tests the existing isolated Test Lab against a **previously saved dedicated disposable workflow**, without creating, executing via /run, editing or deleting any workflow.

**No production test was invoked while preparing M7.** CI exercises a synthetic fetch harness offline.

## Scope and non-goals

The older .github/workflows/production-smoke.yml and its production-smoke.mjs script are **unchanged**. That older broad script creates and deletes demo workflows, runs them and calls the live AI provider. It is not a harmless automatic deployment check and should never be treated as one.

| Mode | Requests | Side effects |
| --- | --- | --- |
| public (default) | GET /api/health, anonymous GET /api/workflows (must return 401) | No credentials, workflow mutations or live executions |
| pinned | Above plus POST /api/auth/login, GET /api/auth/me, GET an owned workflow and immutable revision, POST /api/executions/:id/simulate | Session token issued; isolated QuickJS evaluates a preapproved fixture in memory; no saved execution, /run, live API Call, AI generation or workflow mutation |

Runner properties: hard-coded public production origin, manual redirects rejected, per-request abort deadlines, bounded response text, no private values or cookies in logs, explicit fail-closed checks on identity, revision, definition hash and output. Pinned mode refuses the shared demo account even when the credentials are valid.

**This is not full production /run verification**. It does not check external HTTP Call requests, persisted execution history, errors that production Conditions handle differently, unknown customer graphs or full multi-tenant isolation.

## Dedicated saved test fixture for pinned mode

Create a **dedicated non-demo user account**. Save a new workflow named __flowcraft_smoke_readonly_array_v1 with exactly six nodes:

| Node ID | Type | Exact field |
| --- | --- | --- |
| start | Start | default |
| items | Transform | transformCode = return [{ id: 1 }, { id: 2 }]; |
| decision | Condition | expression = input.items.length === 2 && input.items[0].id === 1 |
| yes | Output | message = first={{items.0.id}}; branch={{decision.branchTaken}} ; logLevel = info |
| no | Output | message = wrong branch ; logLevel = info |
| end | End | default |

Edges are start → items → decision; decision true → yes; decision false → no; yes → end; no → end. Ensure branch edges use actual true/false condition branches. The fixture is created **manually before** any pinned smoke; this PR never creates it.

Record the exact owned workflow ID (24-character hex), current immutable revision number and its 64-character definitionHash. The runner checks the workflow name prefix, revision, hash, node IDs/types, Transform and Condition source strings, Output templates and full edge set before it can call Test Lab.

Its fixed in-memory scenario sets mode = isolated, mocks = {}, expectedRevision = approved revision, requires the complete items array [{id:1},{id:2}], checks items.0.id = 1, checks Output yes.message = "first=1; branch=true", and checks decision branchTaken = true. It additionally verifies four passing assertions, direct array shape, skipped false path and exact revision/hash provenance.

## GitHub setup and operator authorization

Only after the owner separately approves merging this PR, open **Actions → M7 production smoke (manual, read-only) → Run workflow**.

- Public: choose public. No saved fixture, secrets or confirmation required. Only two anonymous GET requests are made.
- Pinned: configure Actions **secrets** FLOWCRAFT_SMOKE_EMAIL and FLOWCRAFT_SMOKE_PASSWORD for the dedicated non-demo account; configure Actions **variables** FLOWCRAFT_SMOKE_WORKFLOW_ID, FLOWCRAFT_SMOKE_REVISION and FLOWCRAFT_SMOKE_DEFINITION_HASH for the saved fixture. Choose pinned and enter the exact confirmation text READ_ONLY_PINNED_SIMULATION.
- Never put passwords in workflow dispatch inputs, committed files or console output. Pinned mode refuses missing or malformed configuration **before any network request**.
- A changed fixture definition or revision requires reapproval and updated pinned settings.

For offline tests run:

~~~sh
node --test .github/scripts/read-only-production-smoke.test.mjs
~~~

CI executes those synthetic tests on every PR. The manual production workflow does **not** run for pull_request, push, schedules or deployments. No authenticated smoke is claimed until manually executed with explicit approval.

## Release gate

Review full diff and CI, obtain separate owner approval to merge, and confirm post-merge CI plus Vercel/Railway status. A green deploy does not prove the manual probe has run. Live production probing requires a separate affirmative authorization; do not silently dispatch either this or the older broad smoke workflow.
