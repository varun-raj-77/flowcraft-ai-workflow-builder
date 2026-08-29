# FlowCraft API — Endpoint Reference

Default local base URL: `http://localhost:3001/api`

Except for `GET /health`, registration, and login, routes require the JWT stored in the secure `token` cookie. Browser requests must include credentials. Every unsafe request (`POST`, `PUT`, `PATCH`, or `DELETE`) also requires an `Origin` present in `TRUSTED_ORIGINS`; otherwise the API returns `403 UNTRUSTED_ORIGIN`.

Success responses use `{ "data": ... }`, except `GET /health` and successful `DELETE` responses. Errors use:

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Human-readable message",
    "details": [{ "field": "fieldName", "message": "Validation message" }]
  }
}
```

`details` is present only for request validation errors. API responses are private and non-cacheable.

## Route index

| Method | Route | Status | Purpose |
|---|---|---:|---|
| `GET` | `/health` | 200 | Service health; no authentication |
| `POST` | `/auth/register` | 201 | Register and set the session cookie |
| `POST` | `/auth/login` | 200 | Authenticate and set the session cookie |
| `POST` | `/auth/logout` | 200 | Clear the session cookie |
| `GET` | `/auth/me` | 200 | Read the authenticated user |
| `POST` | `/auth/socket-ticket` | 200 | Mint a one-time, 60-second Socket.IO ticket |
| `POST` | `/auth/change-password` | 200 | Change the authenticated user's password |
| `POST` | `/workflows` | 201 | Create a root and immutable revision 1 |
| `GET` | `/workflows` | 200 | List owned workflow summaries |
| `GET` | `/workflows/:id` | 200 | Hydrate the owned current revision |
| `GET` | `/workflows/:id/revisions` | 200 | List bounded immutable history |
| `GET` | `/workflows/:id/revisions/:revision` | 200 | Read one exact immutable revision |
| `GET` | `/workflows/:id/revisions/:fromRevision/compare/:toRevision` | 200 | Compare two exact revisions directionally |
| `GET` | `/workflows/:id/ai-prompt-context` | 200 | Resolve prompt context from definition lineage |
| `POST` | `/workflows/:id/revisions/:revision/restore` | 201 | Restore as a new semantic revision |
| `PUT` | `/workflows/:id` | 200 | Save with optimistic concurrency |
| `DELETE` | `/workflows/:id` | 204 | Delete root, revisions, and execution runs |
| `POST` | `/ai/generate` | 200 | Generate and validate an unpersisted candidate |
| `POST` | `/ai/workflows/:workflowId/regenerate` | 201 | Generate and atomically persist an AI revision |
| `POST` | `/executions/:workflowId/run` | 201 | Pin the current revision and start execution |
| `GET` | `/executions/run/:runId` | 200 | Read one owned execution |
| `GET` | `/executions/run/:runId/provenance` | 200 | Resolve exact definition provenance |
| `GET` | `/executions/workflow/:workflowId` | 200 | List the 20 newest owned runs |

Route ordering deliberately places revision, lineage, and provenance routes before generic `/:id` and `/run/:runId` handlers.

## Authentication

### POST /api/auth/register

```json
{
  "email": "person@example.com",
  "password": "at-least-6-characters",
  "displayName": "Person"
}
```

`displayName` is 2–50 characters. The response is the created user and sets the session cookie.

### POST /api/auth/login

```json
{ "email": "person@example.com", "password": "password" }
```

### POST /api/auth/logout

No body. Returns `{ "data": { "message": "Logged out" } }` and clears the cookie.

### GET /api/auth/me

Returns the authenticated user plus `isDemoAccount`.

### POST /api/auth/socket-ticket

No body. Returns `{ "data": { "ticket": "one-time-ticket" } }`. The ticket, rather than the JWT cookie, authenticates the direct Socket.IO handshake and can be consumed once within 60 seconds.

### POST /api/auth/change-password

```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password"
}
```

The body is strict; extra fields are rejected. Demo-account password changes are forbidden.

## Workflow definition contract

Every manual and AI graph uses the same node, edge, and DAG validation. Supported node types are `start`, `api_call`, `condition`, `transform`, `delay`, `output`, and `end`.

```json
{
  "name": "Fetch and Process User Data",
  "description": "Calls an API and publishes a result",
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "label": "Start",
      "position": { "x": 0, "y": 0 },
      "config": {}
    },
    {
      "id": "fetch",
      "type": "api_call",
      "label": "Fetch Users",
      "position": { "x": 240, "y": 0 },
      "config": {
        "url": "https://jsonplaceholder.typicode.com/users",
        "method": "GET",
        "headers": { "Accept": "application/json" },
        "timeout": 5000
      }
    }
  ],
  "edges": [
    { "id": "start-fetch", "source": "start", "target": "fetch" }
  ],
  "isGeneratedByAI": false
}
```

Node IDs must be unique; edges must reference existing nodes; the graph must be acyclic; node config must match its type; and conditional branch handles must be valid. Empty node and edge arrays are accepted for a newly created draft.

An AI definition can include:

```json
{
  "isGeneratedByAI": true,
  "generationMetadata": {
    "originalPrompt": "Fetch active users and publish a summary",
    "generatedAt": "2026-08-29T12:00:00.000Z",
    "provider": "anthropic",
    "model": "configured-model",
    "capabilityCoverage": {
      "requestedCapabilities": ["api_call", "output"],
      "implementedCapabilities": ["api_call", "output"],
      "missingCapabilities": [],
      "unsupportedCapabilities": [],
      "coverage": 1,
      "isComplete": true
    }
  }
}
```

## Workflow writes

### POST /api/workflows

Creates the workflow root and immutable revision 1 in one MongoDB transaction. The response is a hydrated workflow with `currentRevision`, `currentRevisionId`, `definitionHash`, `nodes`, and `edges`.

### PUT /api/workflows/:id

`expectedRevision` is required. `name`, `description`, `nodes`, `edges`, and `generationMetadata` are optional.

```json
{
  "expectedRevision": 3,
  "name": "Updated workflow",
  "nodes": [],
  "edges": []
}
```

A changed definition creates the next immutable `manual` revision and advances the root pointer atomically. An identical definition reuses the current revision. A stale expected revision returns `409 WORKFLOW_REVISION_CONFLICT`.

### POST /api/workflows/:id/revisions/:revision/restore

```json
{ "expectedRevision": 3 }
```

Restoring v1 while v3 is current creates v4 with `source: "restore"`, v3 as `parentRevisionId`, and v1 as `restoredFromRevisionId`. The current pointer never moves backward. Restoring the current revision returns `400 CANNOT_RESTORE_CURRENT_REVISION`.

### DELETE /api/workflows/:id

Deletes the owned workflow root, its immutable revisions, and its execution runs in one transaction. Success has no body.

## Workflow reads and history

### GET /api/workflows

Returns owned workflow summaries newest-updated first and omits graph bodies. A successful account with no workflows receives an empty array; API failures are not replaced by sample data.

### GET /api/workflows/:id

Returns root metadata hydrated with the exact owned current revision. A legacy root without revision pointers returns `409 WORKFLOW_MIGRATION_REQUIRED`; a broken pointer returns `409 WORKFLOW_REVISION_MISSING`; an integrity failure returns `422 WORKFLOW_REVISION_INTEGRITY_ERROR`.

### GET /api/workflows/:id/revisions

Query parameters:

- `limit`: 1–50, default 20.
- `beforeRevision`: optional exclusive revision-number cursor.

The response is newest-first and omits graph bodies:

```json
{
  "data": {
    "revisions": [
      {
        "id": "revision-id",
        "revision": 4,
        "parentRevisionId": "revision-3-id",
        "source": "restore",
        "definitionHash": "64-character-sha256",
        "restoredFromRevisionId": "revision-1-id",
        "restoredFromRevision": 1,
        "createdAt": "2026-08-29T12:00:00.000Z",
        "nodeCount": 5,
        "edgeCount": 4
      }
    ],
    "nextBeforeRevision": null
  }
}
```

### GET /api/workflows/:id/revisions/:revision

Returns `id`, `workflowId`, revision and lineage fields, canonical hash, nodes, edges, optional generation metadata, and creation time. The stored hash is verified before the body is returned.

### GET /api/workflows/:id/revisions/:fromRevision/compare/:toRevision

Returns a directional semantic diff with `from`, `to`, `hasChanges`, bounded summary counts, added/removed/modified nodes and edges, field-level categories (`runtime`, `presentation`, `layout`), and a read-only graph for the `to` side. Sensitive values are redacted. Both revisions must belong to the workflow and authenticated user and must pass integrity verification.

### GET /api/workflows/:id/ai-prompt-context

Resolves prompt context from the current definition's immutable ancestry:

```json
{
  "data": {
    "status": "available",
    "prompt": "Saved generation prompt",
    "promptRevision": 2,
    "currentRevision": 4,
    "relationship": "restored",
    "provider": "anthropic",
    "model": "configured-model"
  }
}
```

`status` can be `available`, `none`, or `unavailable`. Available relationships are `direct`, `inherited`, and `restored`. Missing links, cycles, missing prompt evidence, and traversal beyond 100 revisions return `unavailable` rather than guessing.

## AI generation

### POST /api/ai/generate

```json
{ "prompt": "Fetch active users and publish a summary" }
```

The prompt is 1–2000 characters. This endpoint returns a validated candidate but does not persist it. The candidate still must pass the workflow write contract when saved.

### POST /api/ai/workflows/:workflowId/regenerate

```json
{
  "prompt": "Fetch active users and publish a summary",
  "expectedRevision": 3
}
```

Ownership and the starting revision are checked before the provider call and checked again inside the write transaction. A complete, valid provider result creates a new `ai_generated` revision and returns the hydrated workflow. Incomplete capability coverage returns `422 AI_CAPABILITY_INCOMPLETE`; untrustworthy prompt metadata returns `422 AI_GENERATION_METADATA_INVALID`; a concurrent writer returns `409 WORKFLOW_REVISION_CONFLICT`.

## Executions and provenance

### POST /api/executions/:workflowId/run

No body. In one transaction, the server resolves and validates the owned current revision, verifies its canonical hash, guards the root pointer, and creates an execution record pinned by `workflowRevisionId`, `workflowRevision`, and `definitionHash`. It returns the pending run with status 201, then processes the pinned definition asynchronously and emits authorized Socket.IO events.

Empty graphs return `400 EMPTY_WORKFLOW`. Legacy roots and broken pointers fail closed; the engine never falls back to root graph fields.

### GET /api/executions/run/:runId

Returns one owned execution record, including status, timing, ordered step logs, and any pinned revision fields.

### GET /api/executions/workflow/:workflowId

Returns the 20 newest runs matching both the workflow and authenticated user.

### GET /api/executions/run/:runId/provenance

Returns one of four evidence states:

- `pinned`: the exact revision exists and its hash verifies; `canView` is true and `canCompare` is true when it is not current.
- `legacy`: the pre-revision run truthfully has no exact definition evidence.
- `unavailable`: the workflow or pinned revision no longer exists.
- `integrity_error`: provenance fields are partial, hashes disagree, or revision integrity fails.

The response also includes the run and workflow IDs, available revision/hash fields, `currentRevision`, `isCurrent`, `canView`, `canCompare`, and an explanatory message when applicable. It never substitutes the current graph for missing historical evidence.

## Common errors

| Status | Code | Meaning |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | Request body, path, or query validation failed |
| 400 | `INVALID_JSON` | Malformed JSON body |
| 400 | `INVALID_ID` | Invalid MongoDB resource ID |
| 400 | `CYCLE_DETECTED` / `INVALID_EDGE_REFERENCES` / `INVALID_NODE_CONFIG` | Invalid graph |
| 401 | `MISSING_TOKEN` / `TOKEN_EXPIRED` / `INVALID_TOKEN` | Authentication failed |
| 403 | `UNTRUSTED_ORIGIN` | Unsafe request origin is absent or untrusted |
| 404 | `WORKFLOW_NOT_FOUND` | Workflow is missing or not owned |
| 404 | `WORKFLOW_REVISION_NOT_FOUND` | Exact revision is missing from the owned workflow |
| 404 | `EXECUTION_NOT_FOUND` | Execution is missing or not owned |
| 409 | `WORKFLOW_REVISION_CONFLICT` | Optimistic concurrency check failed |
| 409 | `WORKFLOW_MIGRATION_REQUIRED` | Legacy root has not been migrated |
| 409 | `WORKFLOW_REVISION_MISSING` | Root pointer cannot resolve its exact revision |
| 422 | `WORKFLOW_REVISION_INTEGRITY_ERROR` | Canonical evidence does not match stored revision |
| 429 | `RATE_LIMITED` | Route-specific request limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected error; internal details are not exposed |

Authorization is deliberately non-enumerating: cross-user workflow, revision, AI-context, run, and provenance requests resolve as not found. Same-user revision IDs are always constrained by workflow ID, preventing cross-workflow revision mixing.
