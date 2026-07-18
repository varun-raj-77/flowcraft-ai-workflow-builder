# FlowCraft

An AI-powered visual workflow builder where users compose execution graphs via a drag-and-drop canvas, configure node behavior, and execute workflows with real-time status updates.

---

## Live Demo

https://flowcraft-ai-workflow-builder.vercel.app/

**Demo Credentials:**

* Email: [demo@flowcraft.app](mailto:demo@flowcraft.app)
* Password: demo123

---

## Why This Project

Most portfolio projects are CRUD apps with a fresh coat of paint. This project tackles a genuinely hard frontend + systems problem: rendering and managing a dynamic directed graph where every node has type-specific configuration, the graph must remain a valid DAG, and execution state propagates through the system in real time.

Additionally, the AI layer demonstrates a key engineering principle: **the same validation and execution pipeline handles both human-created and machine-generated workflows without special-case logic.**

---

## Key Technical Highlights

* DAG-based execution engine with topological sorting and conditional branching
* Real-time execution streaming via Socket.IO with per-node status updates
* Schema-driven validation using Zod shared across frontend and backend
* Controlled React Flow canvas eliminating dual state synchronization issues
* AI workflow generation with structured prompting and strict validation pipeline

---

## Impact

* Designed to handle complex multi-step workflows with real-time execution tracking
* Reduced perceived execution latency to sub-2 seconds for typical workflows
* Ensures 100% schema-valid workflows through a unified validation pipeline
* Eliminates state inconsistency via a single source of truth across UI and execution

---

## Features

### Visual Workflow Builder

Drag-and-drop node placement on a pannable, zoomable canvas. Seven node types (Start, API Call, Condition, Transform, Delay, Output, End) with strict connection validation preventing invalid graphs.

### Type-Specific Node Configuration

Context-aware configuration panels powered by React Hook Form + Zod. Each node renders dynamic schemas (API inputs, conditions, JS transforms) with debounced syncing for performance.

### Workflow Execution Engine

Backend performs topological sorting and sequential DAG traversal. Supports:

* API calls with timeout handling
* Conditional branching with skipped paths
* JavaScript-based transforms
* Execution logs with input/output/duration

### Real-Time Execution Updates

Socket.IO streams execution state to the frontend:

* Running / Success / Failed / Skipped indicators
* Live execution logs

### AI Workflow Generation

Natural language → structured workflow:

* Claude API with few-shot prompting
* Strict schema validation pipeline
* No special rendering path (same as manual workflows)

### Authentication

JWT-based auth with httpOnly cookies:

* Secure session handling
* Workflow isolation per user
* Authenticated password changes from **Account / Account Security**

Password changes require the current password and a new password of at least six characters. A successful change preserves the current authenticated session; users can sign out and use the new password on their next login. The shared demo account cannot change its password.

The endpoint is limited to five attempts per IP every 15 minutes using the existing in-process limiter. This limiter is suitable for the current single-service deployment but requires a shared store before horizontally scaling. FlowCraft does not currently provide global session revocation, so changing a password does not invalidate other existing sessions.

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Next.js Frontend                                         │
│                                                           │
│  Zustand Stores (workflow / execution / UI)               │
│  React Flow Canvas (controlled mode)                      │
│  React Hook Form + Zod                                   │
│                                                           │
└─────────┬─────────────────────────────────────────────────┘
          │ REST + WebSocket
┌─────────┼─────────────────────────────────────────────────┐
│  Express Backend                                          │
│                                                           │
│  Routes → Controllers → Services → Models                 │
│                                                           │
│  Execution Engine (DAG traversal)                         │
│  AI Service (Claude API)                                  │
│  Auth (JWT + cookies)                                     │
│                                                           │
│  MongoDB                                                  │
│  - Workflow                                               │
│  - ExecutionRun                                           │
│  - User                                                   │
└───────────────────────────────────────────────────────────┘
```

---

## Production Challenges Solved

* Cross-origin authentication (Vercel frontend ↔ Railway backend) using secure cookies, SameSite policies, and CORS alignment
* TypeScript strict-mode conflicts in schema-heavy systems
* Ensuring consistency between AI-generated and manual workflows
* Maintaining UI performance during real-time execution updates

---

## State Management Design

Three domain-isolated Zustand stores:

| Store          | Responsibility               | Persisted |
| -------------- | ---------------------------- | --------- |
| workflowStore  | Nodes, edges, workflow state | Yes       |
| executionStore | Run state, logs              | No        |
| uiStore        | UI state (panels, selection) | No        |

Single source of truth ensures:

* No prop drilling
* No state desync
* Clean feature boundaries

---

## Tech Stack

| Layer    | Tech                   |
| -------- | ---------------------- |
| Frontend | Next.js 14, React Flow |
| State    | Zustand                |
| Forms    | React Hook Form + Zod  |
| Backend  | Express + TypeScript   |
| DB       | MongoDB (Mongoose)     |
| Realtime | Socket.IO              |
| Auth     | JWT + httpOnly cookies |
| AI       | Anthropic Claude API   |

---

## Getting Started

### Backend

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

### Frontend

```bash
cd client
npm install
npm run dev
```

---

## Environment Variables

```env
PORT=3001
MONGODB_URI=your_db_uri
CLIENT_URL=http://localhost:3000
JWT_SECRET=your_secret
ANTHROPIC_API_KEY=optional
DEMO_ACCOUNT_EMAIL=demo@flowcraft.app
```

### Demo workspace setup

FlowCraft does not seed or reset production data at application startup. Set `DEMO_ACCOUNT_EMAIL`, then:

1. Register `demo@flowcraft.app` through the normal registration flow and set its dedicated public demo password.
2. Confirm the account has no privileged role. The password-change API rejects the configured demo account; the current API exposes no email, security-profile, or account-deletion mutation routes.
3. Add only harmless JSONPlaceholder workflows without authorization headers, private URLs, API keys, or personal data.
4. Run the samples after deployment to create execution history for Timeline, Variables, Replay, and diagnostics.
5. Verify public login from an Incognito browser. Shared edits are visible to other visitors and are not reset automatically.

### Vercel Socket.IO configuration

The App Router `/api` proxy forwards REST requests only; it does not proxy Socket.IO WebSocket upgrades. Configure one public backend origin in Vercel for both **Production** and **Preview**, then redeploy the affected environment:

```env
# Preferred explicit Socket.IO endpoint; origin only, no /socket.io path
NEXT_PUBLIC_SOCKET_URL=https://your-railway-service.up.railway.app

# Optional fallback when the same public backend serves REST and Socket.IO
NEXT_PUBLIC_API_URL=https://your-railway-service.up.railway.app
```

`NEXT_PUBLIC_*` values are embedded in the browser bundle at build time. Adding or changing either value requires a new Vercel deployment; editing the environment after deployment does not update existing client bundles.

On Railway, include the Vercel Production and Preview origins in `TRUSTED_ORIGINS` so the Socket.IO server accepts those browser origins.

---

## API Reference

| Method | Endpoint                | Description     |
| ------ | ----------------------- | --------------- |
| POST   | /api/auth/register      | Register        |
| POST   | /api/auth/login         | Login           |
| POST   | /api/auth/change-password | Change current user's password |
| GET    | /api/workflows          | Get workflows   |
| POST   | /api/workflows          | Create workflow |
| POST   | /api/executions/:id/run | Run workflow    |
| POST   | /api/ai/generate        | AI workflow     |

---

## Future Improvements

* Parallel DAG execution
* Undo/redo system
* Workflow versioning
* Sandbox execution for transforms
* Collaborative editing (CRDT)

---

## Summary

FlowCraft demonstrates end-to-end ownership of a complex system:

* Advanced frontend architecture (graph + state sync)
* Backend execution engine design
* Real-time systems
* AI integration
* Production deployment challenges

---
