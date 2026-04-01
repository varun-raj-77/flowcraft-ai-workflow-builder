# FlowCraft API — Endpoint Reference

Base URL: `http://localhost:3001/api`

All responses follow the shape:
- Success: `{ data: ... }`
- Error: `{ error: { code: string, message: string, details?: [...] } }`

---

## POST /api/workflows

Creates a new workflow.

### Request

```json
{
  "name": "Fetch and Process User Data",
  "description": "Calls user API, validates response, transforms payload",
  "nodes": [
    {
      "id": "node_0",
      "type": "start",
      "label": "Start",
      "position": { "x": -100, "y": 200 },
      "config": {}
    },
    {
      "id": "node_1",
      "type": "api_call",
      "label": "Fetch Users",
      "position": { "x": 150, "y": 200 },
      "config": {
        "url": "https://jsonplaceholder.typicode.com/users",
        "method": "GET",
        "headers": { "Accept": "application/json" },
        "timeout": 5000
      }
    },
    {
      "id": "node_2",
      "type": "condition",
      "label": "Check Status",
      "position": { "x": 430, "y": 200 },
      "config": {
        "expression": "{{node_1.status}} === 200"
      }
    },
    {
      "id": "node_3",
      "type": "output",
      "label": "Log Result",
      "position": { "x": 720, "y": 200 },
      "config": {
        "logLevel": "info",
        "message": "Got {{node_1.data.length}} users"
      }
    },
    {
      "id": "node_4",
      "type": "end",
      "label": "End",
      "position": { "x": 1000, "y": 200 },
      "config": {}
    }
  ],
  "edges": [
    { "id": "edge_0", "source": "node_0", "target": "node_1" },
    { "id": "edge_1", "source": "node_1", "target": "node_2" },
    { "id": "edge_2", "source": "node_2", "target": "node_3", "sourceHandle": "condition_true", "conditionBranch": "true", "label": "Yes" },
    { "id": "edge_3", "source": "node_3", "target": "node_4" }
  ],
  "isGeneratedByAI": false
}
```

### Response (201)

```json
{
  "data": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "userId": "user_001",
    "name": "Fetch and Process User Data",
    "description": "Calls user API, validates response, transforms payload",
    "nodes": [ ... ],
    "edges": [ ... ],
    "isGeneratedByAI": false,
    "createdAt": "2025-06-01T10:00:00.000Z",
    "updatedAt": "2025-06-01T10:00:00.000Z"
  }
}
```

### Minimal request (empty workflow)

```json
{
  "name": "My New Workflow"
}
```

Response: Workflow with empty nodes/edges arrays.

---

## GET /api/workflows

Lists all workflows for the authenticated user.
Excludes nodes/edges for performance — use GET /:id to load the full graph.

### Response (200)

```json
{
  "data": [
    {
      "_id": "665f1a2b3c4d5e6f7a8b9c0d",
      "userId": "user_001",
      "name": "Fetch and Process User Data",
      "description": "Calls user API, validates response, transforms payload",
      "isGeneratedByAI": false,
      "createdAt": "2025-06-01T10:00:00.000Z",
      "updatedAt": "2025-06-03T14:30:00.000Z"
    },
    {
      "_id": "665f2b3c4d5e6f7a8b9c0e1f",
      "userId": "user_001",
      "name": "Delayed Notification Pipeline",
      "description": "Fetch data, wait, then send notification",
      "isGeneratedByAI": true,
      "createdAt": "2025-06-02T08:00:00.000Z",
      "updatedAt": "2025-06-02T08:00:00.000Z"
    }
  ]
}
```

---

## GET /api/workflows/:id

Returns a single workflow with full nodes and edges.

### Response (200)

Full workflow document (same shape as POST response).

### Error (404)

```json
{
  "error": {
    "code": "WORKFLOW_NOT_FOUND",
    "message": "Workflow not found"
  }
}
```

---

## PUT /api/workflows/:id

Updates a workflow. All fields are optional — only include what changed.

### Full graph update (typical save from the editor)

```json
{
  "name": "Updated Workflow Name",
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

### Name-only update

```json
{
  "name": "Renamed Workflow"
}
```

### Response (200)

Updated workflow document.

---

## DELETE /api/workflows/:id

Deletes a workflow.

### Response (204)

No body.

### Error (404)

```json
{
  "error": {
    "code": "WORKFLOW_NOT_FOUND",
    "message": "Workflow not found"
  }
}
```

---

## Validation Errors

All validation errors return 400 with this shape:

### Missing required field

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body validation failed",
    "details": [
      { "field": "name", "message": "Required" }
    ]
  }
}
```

### Cycle detected

```json
{
  "error": {
    "code": "CYCLE_DETECTED",
    "message": "Workflow contains a cycle. Edges must form a DAG."
  }
}
```

### Invalid node config for type

```json
{
  "error": {
    "code": "INVALID_NODE_CONFIG",
    "message": "Invalid config for api_call: url: Required"
  }
}
```

### Edge references nonexistent node

```json
{
  "error": {
    "code": "INVALID_EDGE_REFERENCES",
    "message": "Edge references nonexistent source node: node_99"
  }
}
```
