import type { Workflow, ExecutionRun } from '@/types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

// ── Error type ──────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Core fetch wrapper ──────────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include', // Sends cookies for auth (Phase 9)
  });

  // 204 No Content (e.g. DELETE)
  if (res.status === 204) {
    return undefined as T;
  }

  const json = await res.json();

  if (!res.ok) {
    const error = json.error || {};
    throw new ApiError(
      res.status,
      error.code || 'UNKNOWN_ERROR',
      error.message || 'An unexpected error occurred',
    );
  }

  return json.data as T;
}

// ── Workflow endpoints ──────────────────────────────────────

/** List all workflows (no nodes/edges — lightweight for dashboard). */
export async function listWorkflows(): Promise<Workflow[]> {
  return request<Workflow[]>('/workflows');
}

/** Get a single workflow with full graph data. */
export async function getWorkflow(id: string): Promise<Workflow> {
  return request<Workflow>(`/workflows/${id}`);
}

/** Create a new workflow. Returns the created document. */
export async function createWorkflow(data: {
  name: string;
  description?: string;
  nodes?: Workflow['nodes'];
  edges?: Workflow['edges'];
  isGeneratedByAI?: boolean;
}): Promise<Workflow> {
  return request<Workflow>('/workflows', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** Update an existing workflow. All fields optional. */
export async function updateWorkflow(
  id: string,
  data: {
    name?: string;
    description?: string;
    nodes?: Workflow['nodes'];
    edges?: Workflow['edges'];
  },
): Promise<Workflow> {
  return request<Workflow>(`/workflows/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** Delete a workflow. */
export async function deleteWorkflow(id: string): Promise<void> {
  return request<void>(`/workflows/${id}`, {
    method: 'DELETE',
  });
}

// ── Execution endpoints ─────────────────────────────────────

/** Trigger a workflow execution. Returns the completed run. */
export async function runWorkflow(workflowId: string): Promise<ExecutionRun> {
  return request<ExecutionRun>(`/executions/${workflowId}/run`, {
    method: 'POST',
  });
}

/** Get a specific execution run by ID. */
export async function getExecution(runId: string): Promise<ExecutionRun> {
  return request<ExecutionRun>(`/executions/run/${runId}`);
}

/** List execution history for a workflow. */
export async function listExecutions(workflowId: string): Promise<ExecutionRun[]> {
  return request<ExecutionRun[]>(`/executions/workflow/${workflowId}`);
}

// ── AI endpoints ────────────────────────────────────────────

/** Generate a workflow from a natural language prompt. Returns the workflow structure (not persisted). */
export async function generateWorkflow(prompt: string): Promise<{
  name: string;
  description?: string;
  nodes: Workflow['nodes'];
  edges: Workflow['edges'];
}> {
  return request(`/ai/generate`, {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
}

// ── Auth endpoints ──────────────────────────────────────────

interface AuthUser {
  _id: string;
  email: string;
  displayName: string;
}

export async function register(data: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AuthUser> {
  return request<AuthUser>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function login(data: {
  email: string;
  password: string;
}): Promise<AuthUser> {
  return request<AuthUser>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' });
}

export async function getMe(): Promise<AuthUser> {
  return request<AuthUser>('/auth/me');
}
