# FlowCraft MCP adapter — Issue #23

**Local stdio MVP, not a hosted MCP endpoint.** No changes to the FlowCraft backend, MongoDB schemas, frontend, Railway or production routes. Node.js 20+ with zero added dependencies. Implements MCP 2026-07-28 discovery and 2025-11-25 initialization compatibility.

## Local configuration

Configure your MCP-compatible desktop client to launch:

    node /absolute/path/to/flowcraft/integrations/mcp/server.mjs

Give it these environment variables using the host's private secret configuration:

- FLOWCRAFT_MCP_API_ORIGIN — exact HTTPS origin, e.g. https://flowcraft-ai-workflow-builder.vercel.app. Local loopback HTTP allowed for development.
- FLOWCRAFT_MCP_SESSION_TOKEN — the raw value of an active FlowCraft login token cookie (not the Cookie header); use a dedicated non-demo account.

Never share tokens with a model or in screenshots, shell history or GitHub. The adapter uses an existing session rather than offering proper delegated OAuth; that remains required for a remote hosted MCP server.

## Tools

- list_workflows: first 20 owned workflows, safe ID/name/revision metadata
- get_workflow: owned metadata, current revision, definition SHA-256 and node count
- get_execution_status: owner-scoped status and step-status counts (no step inputs, outputs, errors or diagnostics)
- run_workflow: HIDDEN AND DISABLED BY DEFAULT; triggers a **real execution** and may have irreversible external side effects

Results are explicitly projected to safe metadata. The older GET detail endpoints can still transmit full data to this local process; this is output redaction, not backend transport redaction. Treat names as untrusted user content.

## Optional execution mode — not recommended for unattended production

Use a dedicated non-demo test account and require the MCP host to prompt a human before every execution. The operator must explicitly set:

- FLOWCRAFT_MCP_ENABLE_RUNS=1
- FLOWCRAFT_MCP_RUN_WORKFLOW_IDS — comma-separated exact allowlisted 24-character workflow IDs
- FLOWCRAFT_MCP_TRUSTED_ORIGIN — existing frontend HTTPS origin recognized by the backend CSRF policy
- FLOWCRAFT_MCP_JOURNAL_DIR — private absolute local path outside the repository; NEVER clear to retry uncertain writes

Each tool call requires workflowId, expectedRevision, expectedDefinitionHash, a UUID operationId and acknowledgeSideEffects=true. The adapter checks dedicated-account authentication, workflow ownership, revision and hash. It reserves the operation ID using an exclusive local file before issuing one POST. Repeated operation IDs are rejected even after process restart. Uncertain or timed-out POSTs must never be automatically retried.

**This is NOT exactly-once execution.** Different operation IDs, other machines, deleted journal files, or concurrent workflow changes can still cause duplicate or changed-revision execution. The backend execution endpoint currently has no agent-specific idempotency key. Keep production runs off until backend-atomic idempotency and stronger delegated authorization are reviewed.

## Verification

Offline tests:

    node --test integrations/mcp/bridge.test.mjs

CI runs these offline tests alongside the existing client, server and Playwright checks. Neither tests nor this PR configure Railway, create sessions, trigger production runs or deploy MCP.

**Next phase:** controlled staging integration, proper remote Streamable HTTP transport with OAuth/delegated tokens, server-side idempotency and auditable per-user execution permissions. Do not close Issue #23 until a reviewed production-ready integration exists. Obtain separate approval before merging this PR.
