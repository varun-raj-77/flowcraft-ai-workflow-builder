Live link : https://flowcraft-ai-workflow-builder.vercel.app

# Demo Credentials
Email: demo@flowcraft.app
Password: demo123

# FlowCraft

An AI-powered visual workflow builder. Users drag nodes onto a canvas, connect them into execution graphs, configure each step, and run the workflow — watching nodes light up in real time as the engine processes them. A natural language prompt can generate a complete workflow structure that renders instantly on the canvas.

Built as a solo project to demonstrate full-stack ownership: complex frontend state management, visual canvas interactions, a DAG-based execution engine, real-time WebSocket updates, and LLM integration — all behind clean architecture with strong TypeScript throughout.

---

## Why This Project

Most portfolio projects are CRUD apps with a fresh coat of paint. This one solves a genuinely hard frontend problem: rendering an interactive directed graph where every node has type-specific configuration, the graph must be validated as a DAG, and execution state flows through the system in real time. The AI generation layer adds a second dimension — demonstrating that the same data pipeline handles both human input and machine-generated output without any special-casing.

---

## Features

**Visual Workflow Builder** — Drag-and-drop node placement on a pannable, zoomable canvas. Seven node types (Start, API Call, Condition, Transform, Delay, Output, End) with distinct visual identities and handle configurations. Connections snap between compatible ports with validation that prevents self-loops, duplicate edges, and invalid handle combinations.

**Type-Specific Node Configuration** — Clicking a node opens a contextual config panel with React Hook Form + Zod validation. Each node type renders different fields: URL/method/headers for API Call, boolean expressions for Condition, JavaScript code editor for Transform. Changes debounce-sync to the store so the canvas stays responsive during rapid editing.

**Workflow Execution Engine** — Backend topologically sorts the DAG and walks nodes sequentially. API Call nodes make real HTTP requests with timeout enforcement. Condition nodes evaluate expressions and mark the not-taken branch as skipped. Transform nodes run user-provided JavaScript. Every step is logged with input, output, duration, and error details.

**Real-Time Execution Updates** — Socket.IO pushes per-node status events as the engine processes them. The canvas shows status indicators on each node: spinning (running), checkmark (success), X (failed), dash (skipped). The execution log panel streams entries as they arrive.

**AI Workflow Generation** — Users describe a workflow in plain English. The backend sends a structured prompt to Claude with the node schema and few-shot examples. The LLM response is validated through the exact same Zod + DAG pipeline used for manual creation — no special rendering path. The generated workflow appears on the canvas like any manually built one.

**Authentication** — JWT with httpOnly cookies. Workflows are scoped to the authenticated user. Register, login, logout, and session persistence across page reloads.

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Next.js Frontend                                         │
│                                                           │
│  ┌─────────────┐  ┌────────────┐  ┌───────────────────┐  │
│  │ workflowStore│  │ React Flow │  │ React Hook Form   │  │
│  │ (Zustand)   │◄─┤ (canvas)   │  │ + Zod (config)    │  │
│  │             │  │ controlled │  │                   │  │
│  │ executionSt.│  │ mode       │  │ useNodeConfigForm │  │
│  │ uiStore     │  └────────────┘  └───────────────────┘  │
│  │ authStore   │                                          │
│  └──────┬──────┘                                          │
│         │              lib/api.ts                         │
│         │              lib/socket.ts                      │
└─────────┼─────────────────────────────────────────────────┘
          │  REST API + Socket.IO
┌─────────┼─────────────────────────────────────────────────┐
│  Express Backend                                          │
│         │                                                 │
│  routes → controllers → services → models                 │
│                                                           │
│  ┌────────────────┐  ┌────────────┐  ┌────────────────┐  │
│  │ Execution      │  │ AI Service │  │ Auth           │  │
│  │ Engine         │  │ (Claude    │  │ (JWT +         │  │
│  │                │  │  API)      │  │  httpOnly      │  │
│  │ Topo sort →    │  │            │  │  cookies)      │  │
│  │ Walk nodes →   │  │ Prompt →   │  │                │  │
│  │ Emit events    │  │ Validate → │  │ Middleware →   │  │
│  │                │  │ Return     │  │ req.userId     │  │
│  └────────────────┘  └────────────┘  └────────────────┘  │
│                                                           │
│  MongoDB: Workflow (embedded nodes/edges)                  │
│           ExecutionRun (separate collection)               │
│           User                                            │
└───────────────────────────────────────────────────────────┘
```

### State Management Design

Three Zustand stores with strict domain boundaries:

| Store | Owns | Persisted? |
|-------|------|------------|
| `workflowStore` | Nodes, edges, workflow metadata | Yes (API) |
| `executionStore` | Current run, step logs, running status | No (transient) |
| `uiStore` | Selected node, panel visibility, modal state | No (ephemeral) |

Stores communicate horizontally — features subscribe to whichever stores they need but never import from each other. The `workflowStore` holds React Flow's native `Node[]` and `Edge[]` types directly, with domain data inside the `data` field. Conversion to/from our persistence types happens only at the API boundary via `toFlowNode`/`fromFlowNode` — never on render frames.

### Frontend Feature Module Structure

```
features/
├── workflow-canvas/     Canvas, custom nodes, drag-and-drop, toolbar
├── node-config/         Config panel, per-type forms, Zod schemas
├── execution-viewer/    Log panel, status overlays, Socket.IO hook
├── ai-generator/        Prompt modal, API integration
└── workflow-manager/    Dashboard cards, CRUD operations
```

Each module owns its components, hooks, and local logic. No feature imports from another feature — they communicate through stores.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 14 (App Router) | File-based routing, SSR capability, TypeScript-first |
| Canvas | React Flow | Mature graph library, controlled mode, handles pan/zoom/edges |
| State | Zustand | Lightweight, out-of-component access for WebSocket handlers, slices pattern |
| Forms | React Hook Form + Zod | Schema-driven validation shared between frontend and backend |
| Styling | Tailwind CSS | Utility-first, no class name conflicts, rapid iteration |
| Backend | Express + TypeScript | Familiar, lightweight, strong ecosystem |
| Database | MongoDB (Mongoose) | Workflow documents with embedded nodes/edges map naturally to JSON |
| Real-time | Socket.IO | Room abstraction per execution, auto-reconnection |
| Auth | JWT + httpOnly cookies | Simple, secure against XSS, no client-side token management |
| AI | Anthropic Claude API | Structured JSON output, follows schema instructions well |

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB running locally (or a MongoDB Atlas connection string)
- Anthropic API key (optional — only needed for AI generation)

### Installation

```bash
git clone https://github.com/yourusername/flowcraft.git
cd flowcraft
```

**Backend:**
```bash
cd server
cp .env.example .env        # Configure your environment variables
npm install
npm run dev                  # Starts on http://localhost:3001
```

**Frontend:**
```bash
cd client
npm install
npm run dev                  # Starts on http://localhost:3000
```

Open http://localhost:3000, register an account, and start building workflows.

### Environment Variables

Create `server/.env` from the example:

```env
PORT=3001
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/flowcraft
CLIENT_URL=http://localhost:3000
JWT_SECRET=your-secret-here          # Any random string, change in production
ANTHROPIC_API_KEY=sk-ant-...         # Optional, enables AI generation
```

---

## Screenshots

> Replace these placeholders with actual screenshots before publishing.

**Dashboard** — Workflow list with type chips, AI badge, relative timestamps

`[screenshot: dashboard.png]`

**Workflow Editor** — Canvas with connected nodes, config panel open, node palette sidebar

`[screenshot: editor.png]`

**Execution** — Nodes with real-time status indicators, log panel showing step results

`[screenshot: execution.png]`

**AI Generation** — Modal with prompt input, example chips, generated workflow on canvas

`[screenshot: ai-generation.png]`

---

## Design Decisions & Tradeoffs

**React Flow in controlled mode vs. uncontrolled.** Controlled mode means the store owns nodes/edges and React Flow reads them as props. This adds wiring complexity but eliminates dual sources of truth — every part of the app (config panel, execution overlays, serialization) reads from one place. Uncontrolled mode would be simpler initially but creates state sync bugs as features layer on.

**Embedded nodes/edges vs. separate collections.** A workflow is always loaded and saved as a complete unit. Separate collections would mean three queries on every canvas load and transactional consistency across collections. Embedding keeps it atomic. The tradeoff: you can't query individual nodes across workflows, but we never need to.

**ExecutionRun as a separate collection.** Runs are append-only and can grow indefinitely. Embedding them in the workflow document would eventually hit MongoDB's 16MB limit and bloat every workflow load. Separation also means execution history doesn't increase save latency.

**In-process execution vs. job queue.** V1 executes workflows synchronously in the Express process. A job queue (Bull/Redis) would enable concurrent execution and crash recovery, but adds operational complexity that doesn't improve the portfolio demonstration. The engine is isolated behind a clean interface so extraction is straightforward.

**`new Function()` for transforms and conditions.** Not production-safe (code injection risk), but acceptable for a portfolio project. Documented explicitly in the code. The production fix would be `isolated-vm` or a Wasm sandbox. The architecture doesn't change — only the executor implementation.

**Debounced form sync instead of onSubmit.** Config forms don't have a "submit" button — changes take effect as the user types. React Hook Form owns local state for typing responsiveness, then debounce-writes valid data to the store every 300ms. This prevents 24 store updates when typing a URL while keeping the canvas smooth.

**AI output through the same validation pipeline.** The LLM's JSON response goes through `createWorkflowSchema.safeParse()`, `validateUniqueNodeIds()`, `validateEdgeReferences()`, `isValidDAG()`, and per-node `validateNodeConfig()` — the exact same functions used when a user clicks Save. This means one source of truth for "what is a valid workflow" regardless of whether a human or AI created it.

---

## Future Improvements

These are explicitly deferred from V1, not forgotten:

- **Undo/redo** — Command pattern over workflowStore mutations
- **Parallel branch execution** — Execute independent DAG branches concurrently
- **Workflow versioning** — Snapshot on each save, diff viewer
- **Scheduled execution** — Cron triggers via a job scheduler
- **Custom node types** — User-defined node schemas with plugin API
- **Transform sandboxing** — Replace `new Function()` with isolated-vm
- **SSE fallback** — For environments where WebSocket is blocked
- **Collaborative editing** — CRDT-based real-time multi-user canvas

---

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Sign in |
| POST | `/api/auth/logout` | Yes | Sign out |
| GET | `/api/auth/me` | Yes | Current user |
| GET | `/api/workflows` | Yes | List workflows |
| POST | `/api/workflows` | Yes | Create workflow |
| GET | `/api/workflows/:id` | Yes | Get workflow with graph |
| PUT | `/api/workflows/:id` | Yes | Update workflow |
| DELETE | `/api/workflows/:id` | Yes | Delete workflow |
| POST | `/api/executions/:id/run` | Yes | Execute workflow |
| GET | `/api/executions/run/:id` | Yes | Get execution result |
| GET | `/api/executions/workflow/:id` | Yes | List execution history |
| POST | `/api/ai/generate` | Yes | Generate workflow from prompt |
