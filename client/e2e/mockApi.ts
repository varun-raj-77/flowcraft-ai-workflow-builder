import type { Page, Route } from '@playwright/test';

interface MockApiOptions {
  authenticated?: boolean;
  workflows?: Array<Record<string, unknown>>;
  workflowState?: Map<string, Record<string, unknown>>;
  revisionState?: Map<string, MockRevision[]>;
  executionState?: Map<string, Array<Record<string, unknown>>>;
}

interface MockRevision {
  id: string;
  workflowId: string;
  revision: number;
  parentRevisionId: string | null;
  source: 'manual' | 'ai_generated' | 'restore';
  definitionHash: string;
  restoredFromRevisionId?: string;
  restoredFromRevision?: number;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  generationMetadata?: Record<string, unknown>;
  createdAt: string;
}

const now = '2026-07-23T12:00:00.000Z';

export function executableWorkflow(id = 'workflow-ready') {
  return {
    _id: id,
    userId: 'user-e2e',
    name: 'Release summary',
    description: 'A deterministic workflow used only by browser tests.',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
      {
        id: 'output',
        type: 'output',
        label: 'Output Summary',
        position: { x: 240, y: 0 },
        config: { logLevel: 'info', message: 'Browser test complete' },
      },
      { id: 'end', type: 'end', label: 'End', position: { x: 480, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'start-output', source: 'start', target: 'output' },
      { id: 'output-end', source: 'output', target: 'end' },
    ],
    isGeneratedByAI: false,
    currentRevision: 1,
    currentRevisionId: `${id}-revision-1`,
    definitionHash: 'a'.repeat(64),
    createdAt: now,
    updatedAt: now,
  };
}

function summary(workflow: Record<string, unknown>) {
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const { edges: _edges, nodes: _nodes, ...rest } = workflow;
  return {
    ...rest,
    nodeCount: nodes.length,
    lastExecutionStatus: null,
  };
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function revisionFromWorkflow(workflow: Record<string, unknown>): MockRevision {
  const workflowId = String(workflow._id);
  const revision = Number(workflow.currentRevision ?? 1);
  return {
    id: String(workflow.currentRevisionId ?? `${workflowId}-revision-${revision}`),
    workflowId,
    revision,
    parentRevisionId: revision === 1 ? null : `${workflowId}-revision-${revision - 1}`,
    source: workflow.isGeneratedByAI ? 'ai_generated' : 'manual',
    definitionHash: String(workflow.definitionHash ?? 'a'.repeat(64)),
    nodes: structuredClone((workflow.nodes ?? []) as Array<Record<string, unknown>>),
    edges: structuredClone((workflow.edges ?? []) as Array<Record<string, unknown>>),
    generationMetadata: workflow.generationMetadata
      ? structuredClone(workflow.generationMetadata as Record<string, unknown>)
      : undefined,
    createdAt: String(workflow.updatedAt ?? now),
  };
}

function mockAiPromptContext(workflow: Record<string, unknown>, history: MockRevision[]) {
  const currentRevision = Number(workflow.currentRevision);
  let candidate = history.find((revision) => revision.id === workflow.currentRevisionId);
  const visited = new Set<string>();
  let crossedRestore = false;
  for (let depth = 0; candidate && depth < 100; depth += 1) {
    if (visited.has(candidate.id)) {
      return { status: 'unavailable', currentRevision, message: 'AI prompt lineage contains a cycle and cannot be trusted.' };
    }
    visited.add(candidate.id);
    if (candidate.source === 'ai_generated') {
      const prompt = candidate.generationMetadata?.originalPrompt;
      if (typeof prompt !== 'string' || !prompt.trim()) {
        return { status: 'unavailable', currentRevision, message: 'The AI-generated revision has no trustworthy saved prompt.' };
      }
      const provider = candidate.generationMetadata?.provider;
      const model = candidate.generationMetadata?.model;
      return {
        status: 'available',
        prompt,
        promptRevision: candidate.revision,
        currentRevision,
        relationship: candidate.id === workflow.currentRevisionId ? 'direct' : crossedRestore ? 'restored' : 'inherited',
        ...(typeof provider === 'string' && provider.trim() ? { provider } : {}),
        ...(typeof model === 'string' && model.trim() ? { model } : {}),
      };
    }
    const nextId = candidate.source === 'restore' ? candidate.restoredFromRevisionId : candidate.parentRevisionId;
    if (candidate.source === 'restore') crossedRestore = true;
    if (!nextId) return { status: 'none', currentRevision };
    candidate = history.find((revision) => revision.id === nextId);
    if (!candidate) return { status: 'unavailable', currentRevision, message: 'The workflow revision lineage is incomplete.' };
  }
  return candidate
    ? { status: 'unavailable', currentRevision, message: 'AI prompt lineage exceeded the safe traversal limit.' }
    : { status: 'none', currentRevision };
}

function edgeSemanticKey(edge: Record<string, unknown>): string {
  return JSON.stringify([
    edge.source,
    edge.target,
    edge.sourceHandle ?? null,
    edge.targetHandle ?? null,
    edge.conditionBranch ?? null,
  ]);
}

function mockRevisionComparison(workflowId: string, from: MockRevision, to: MockRevision) {
  const fromNodes = new Map(from.nodes.map((node) => [String(node.id), node]));
  const toNodes = new Map(to.nodes.map((node) => [String(node.id), node]));
  const nodeIds = [...new Set([...fromNodes.keys(), ...toNodes.keys()])].sort();
  const addedNodes: Array<Record<string, unknown>> = [];
  const removedNodes: Array<Record<string, unknown>> = [];
  const modifiedNodes: Array<Record<string, unknown>> = [];
  for (const nodeId of nodeIds) {
    const before = fromNodes.get(nodeId);
    const after = toNodes.get(nodeId);
    if (!before && after) addedNodes.push({ nodeId, node: after });
    else if (before && !after) removedNodes.push({ nodeId, node: before });
    else if (before && after) {
      const changes: Array<Record<string, unknown>> = [];
      for (const [path, category, beforeValue, afterValue] of [
        ['type', 'runtime', before.type, after.type],
        ['label', 'presentation', before.label, after.label],
        ['description', 'presentation', before.description, after.description],
        ['position.x', 'layout', (before.position as { x?: unknown })?.x, (after.position as { x?: unknown })?.x],
        ['position.y', 'layout', (before.position as { y?: unknown })?.y, (after.position as { y?: unknown })?.y],
        ['config', 'runtime', before.config, after.config],
      ]) {
        if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
          changes.push({
            path, category,
            beforePresent: beforeValue !== undefined,
            afterPresent: afterValue !== undefined,
            ...(beforeValue !== undefined ? { before: beforeValue } : {}),
            ...(afterValue !== undefined ? { after: afterValue } : {}),
          });
        }
      }
      if (changes.length) modifiedNodes.push({ nodeId, before, after, changes, changesTruncated: false });
    }
  }

  const fromEdges = new Map(from.edges.map((edge) => [edgeSemanticKey(edge), edge]));
  const toEdges = new Map(to.edges.map((edge) => [edgeSemanticKey(edge), edge]));
  const edgeKeys = [...new Set([...fromEdges.keys(), ...toEdges.keys()])].sort();
  const addedEdges: Array<Record<string, unknown>> = [];
  const removedEdges: Array<Record<string, unknown>> = [];
  const modifiedEdges: Array<Record<string, unknown>> = [];
  for (const semanticKey of edgeKeys) {
    const before = fromEdges.get(semanticKey);
    const after = toEdges.get(semanticKey);
    const edgeKey = `${semanticKey}#1`;
    if (!before && after) addedEdges.push({ edgeKey, edge: after });
    else if (before && !after) removedEdges.push({ edgeKey, edge: before });
    else if (before && after && before.label !== after.label) {
      modifiedEdges.push({
        edgeKey, before, after, changesTruncated: false,
        changes: [{
          path: 'label', category: 'presentation',
          beforePresent: before.label !== undefined, afterPresent: after.label !== undefined,
          ...(before.label !== undefined ? { before: before.label } : {}),
          ...(after.label !== undefined ? { after: after.label } : {}),
        }],
      });
    }
  }
  const nodeSummary = { added: addedNodes.length, removed: removedNodes.length, modified: modifiedNodes.length };
  const edgeSummary = { added: addedEdges.length, removed: removedEdges.length, modified: modifiedEdges.length };
  const totalChanges = Object.values(nodeSummary).reduce((total, count) => total + count, 0)
    + Object.values(edgeSummary).reduce((total, count) => total + count, 0);
  return {
    workflowId,
    from: { id: from.id, revision: from.revision, source: from.source, definitionHash: from.definitionHash, createdAt: from.createdAt },
    to: { id: to.id, revision: to.revision, source: to.source, definitionHash: to.definitionHash, createdAt: to.createdAt },
    hasChanges: totalChanges > 0,
    summary: { totalChanges, nodes: nodeSummary, edges: edgeSummary },
    nodes: { added: addedNodes, removed: removedNodes, modified: modifiedNodes },
    edges: { added: addedEdges, removed: removedEdges, modified: modifiedEdges },
    graph: { nodes: structuredClone(to.nodes), edges: structuredClone(to.edges) },
  };
}

export async function installMockApi(page: Page, options: MockApiOptions = {}) {
  let authenticated = options.authenticated ?? true;
  const workflows = options.workflowState ?? new Map<string, Record<string, unknown>>(
    (options.workflows ?? []).map((workflow) => [String(workflow._id), workflow]),
  );
  const revisions = options.revisionState ?? new Map<string, MockRevision[]>();
  const executions = options.executionState ?? new Map<string, Array<Record<string, unknown>>>();
  for (const workflow of workflows.values()) {
    const workflowId = String(workflow._id);
    if (!revisions.has(workflowId)) revisions.set(workflowId, [revisionFromWorkflow(workflow)]);
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();

    if (path === '/auth/me' && method === 'GET') {
      if (!authenticated) {
        await json(route, 401, { error: { code: 'MISSING_TOKEN', message: 'Authentication required' } });
        return;
      }
      await json(route, 200, {
        data: {
          _id: 'user-e2e',
          email: 'engineer@example.com',
          displayName: 'FlowCraft Engineer',
          isDemoAccount: false,
        },
      });
      return;
    }

    if (path === '/auth/login' && method === 'POST') {
      const credentials = request.postDataJSON() as { email?: string; password?: string };
      if (credentials.email !== 'engineer@example.com' || credentials.password !== 'correct-password') {
        await json(route, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
        return;
      }
      authenticated = true;
      await json(route, 200, {
        data: { _id: 'user-e2e', email: credentials.email, displayName: 'FlowCraft Engineer' },
      });
      return;
    }

    if (path === '/auth/socket-ticket' && method === 'POST') {
      await json(route, 200, { data: { ticket: 'opaque-e2e-ticket' } });
      return;
    }

    if (path === '/workflows' && method === 'GET') {
      await json(route, 200, { data: [...workflows.values()].map(summary) });
      return;
    }

    if (path === '/workflows' && method === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      const id = `workflow-${workflows.size + 1}`;
      const workflow = {
        ...payload,
        _id: id,
        userId: 'user-e2e',
        nodes: payload.nodes ?? [],
        edges: payload.edges ?? [],
        isGeneratedByAI: payload.isGeneratedByAI ?? false,
        currentRevision: 1,
        currentRevisionId: `${id}-revision-1`,
        definitionHash: 'a'.repeat(64),
        createdAt: now,
        updatedAt: now,
      };
      workflows.set(id, workflow);
      revisions.set(id, [revisionFromWorkflow(workflow)]);
      await json(route, 201, { data: workflow });
      return;
    }

    const historyMatch = path.match(/^\/workflows\/([^/]+)\/revisions$/);
    if (historyMatch && method === 'GET') {
      const id = historyMatch[1];
      if (!workflows.has(id)) {
        await json(route, 404, { error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found' } });
        return;
      }
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const beforeRevision = url.searchParams.has('beforeRevision')
        ? Number(url.searchParams.get('beforeRevision'))
        : Number.POSITIVE_INFINITY;
      const available = [...(revisions.get(id) ?? [])]
        .filter((revision) => revision.revision < beforeRevision)
        .sort((left, right) => right.revision - left.revision);
      const page = available.slice(0, limit);
      await json(route, 200, {
        data: {
          revisions: page.map((revision) => ({
            id: revision.id,
            revision: revision.revision,
            parentRevisionId: revision.parentRevisionId,
            source: revision.source,
            definitionHash: revision.definitionHash,
            restoredFromRevisionId: revision.restoredFromRevisionId,
            restoredFromRevision: revision.restoredFromRevision,
            createdAt: revision.createdAt,
            nodeCount: revision.nodes.length,
            edgeCount: revision.edges.length,
          })),
          nextBeforeRevision: available.length > limit && page.length
            ? page[page.length - 1].revision
            : null,
        },
      });
      return;
    }

    const promptContextMatch = path.match(/^\/workflows\/([^/]+)\/ai-prompt-context$/);
    if (promptContextMatch && method === 'GET') {
      const id = promptContextMatch[1];
      const workflow = workflows.get(id);
      if (!workflow) {
        await json(route, 404, { error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found' } });
        return;
      }
      await json(route, 200, { data: mockAiPromptContext(workflow, revisions.get(id) ?? []) });
      return;
    }

    const comparisonMatch = path.match(/^\/workflows\/([^/]+)\/revisions\/(\d+)\/compare\/(\d+)$/);
    if (comparisonMatch && method === 'GET') {
      const [, id, fromValue, toValue] = comparisonMatch;
      if (!workflows.has(id)) {
        await json(route, 404, { error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found' } });
        return;
      }
      const history = revisions.get(id) ?? [];
      const fromRevision = history.find((candidate) => candidate.revision === Number(fromValue));
      const toRevision = history.find((candidate) => candidate.revision === Number(toValue));
      if (!fromRevision || !toRevision) {
        await json(route, 404, { error: { code: 'WORKFLOW_REVISION_NOT_FOUND', message: 'Workflow revision not found' } });
        return;
      }
      await json(route, 200, { data: mockRevisionComparison(id, fromRevision, toRevision) });
      return;
    }

    const restoreMatch = path.match(/^\/workflows\/([^/]+)\/revisions\/(\d+)\/restore$/);
    if (restoreMatch && method === 'POST') {
      const [, id, revisionValue] = restoreMatch;
      const current = workflows.get(id);
      if (!current) {
        await json(route, 404, { error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found' } });
        return;
      }
      const expectedRevision = Number((request.postDataJSON() as { expectedRevision: number }).expectedRevision);
      const currentRevision = Number(current.currentRevision);
      if (expectedRevision !== currentRevision) {
        await json(route, 409, { error: { code: 'WORKFLOW_REVISION_CONFLICT', message: 'Workflow revision conflict' } });
        return;
      }
      const targetRevisionNumber = Number(revisionValue);
      if (targetRevisionNumber === currentRevision) {
        await json(route, 400, { error: { code: 'CANNOT_RESTORE_CURRENT_REVISION', message: 'The current revision cannot be restored' } });
        return;
      }
      const history = revisions.get(id) ?? [];
      const target = history.find((revision) => revision.revision === targetRevisionNumber);
      if (!target) {
        await json(route, 404, { error: { code: 'WORKFLOW_REVISION_NOT_FOUND', message: 'Workflow revision not found' } });
        return;
      }
      const nextRevision = currentRevision + 1;
      const restoredRevision: MockRevision = {
        ...structuredClone(target),
        id: `${id}-revision-${nextRevision}`,
        revision: nextRevision,
        parentRevisionId: String(current.currentRevisionId),
        source: 'restore',
        restoredFromRevisionId: target.id,
        restoredFromRevision: target.revision,
        createdAt: now,
      };
      history.push(restoredRevision);
      revisions.set(id, history);
      const restoredWorkflow = {
        ...current,
        nodes: structuredClone(target.nodes),
        edges: structuredClone(target.edges),
        generationMetadata: target.generationMetadata ? structuredClone(target.generationMetadata) : undefined,
        currentRevision: nextRevision,
        currentRevisionId: restoredRevision.id,
        definitionHash: restoredRevision.definitionHash,
        updatedAt: now,
      };
      workflows.set(id, restoredWorkflow);
      await json(route, 201, { data: restoredWorkflow });
      return;
    }

    const exactRevisionMatch = path.match(/^\/workflows\/([^/]+)\/revisions\/(\d+)$/);
    if (exactRevisionMatch && method === 'GET') {
      const [, id, revisionValue] = exactRevisionMatch;
      if (!workflows.has(id)) {
        await json(route, 404, { error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found' } });
        return;
      }
      const revision = (revisions.get(id) ?? []).find((candidate) => candidate.revision === Number(revisionValue));
      await json(
        route,
        revision ? 200 : 404,
        revision
          ? { data: revision }
          : { error: { code: 'WORKFLOW_REVISION_NOT_FOUND', message: 'Workflow revision not found' } },
      );
      return;
    }

    const workflowMatch = path.match(/^\/workflows\/([^/]+)$/);
    if (workflowMatch) {
      const id = workflowMatch[1];
      if (method === 'GET') {
        const workflow = workflows.get(id);
        await json(
          route,
          workflow ? 200 : 404,
          workflow ? { data: workflow } : { error: { code: 'NOT_FOUND', message: 'Workflow not found' } },
        );
        return;
      }
      if (method === 'PUT') {
        const current = workflows.get(id);
        if (!current) {
          await json(route, 404, { error: { code: 'NOT_FOUND', message: 'Workflow not found' } });
          return;
        }
        const payload = request.postDataJSON() as Record<string, unknown>;
        if (payload.expectedRevision !== current.currentRevision) {
          await json(route, 409, {
            error: {
              code: 'WORKFLOW_REVISION_CONFLICT',
              message: `Workflow revision conflict: expected ${String(payload.expectedRevision)}, current ${String(current.currentRevision)}`,
            },
          });
          return;
        }
        const definitionChanged = JSON.stringify(payload.nodes ?? current.nodes) !== JSON.stringify(current.nodes)
          || JSON.stringify(payload.edges ?? current.edges) !== JSON.stringify(current.edges);
        const currentRevision = Number(current.currentRevision);
        const nextRevision = definitionChanged ? currentRevision + 1 : currentRevision;
        const { expectedRevision: _expectedRevision, ...updates } = payload;
        const workflow: Record<string, unknown> = {
          ...current,
          ...updates,
          currentRevision: nextRevision,
          currentRevisionId: definitionChanged ? `${id}-revision-${nextRevision}` : current.currentRevisionId,
          definitionHash: definitionChanged ? String(nextRevision).repeat(64).slice(0, 64) : current.definitionHash,
          updatedAt: now,
        };
        workflows.set(id, workflow);
        if (definitionChanged) {
          const history = revisions.get(id) ?? [];
          history.push({
            id: String(workflow.currentRevisionId),
            workflowId: id,
            revision: nextRevision,
            parentRevisionId: String(current.currentRevisionId),
            source: 'manual',
            definitionHash: String(workflow.definitionHash),
            nodes: structuredClone((workflow.nodes ?? []) as Array<Record<string, unknown>>),
            edges: structuredClone((workflow.edges ?? []) as Array<Record<string, unknown>>),
            generationMetadata: workflow.generationMetadata
              ? structuredClone(workflow.generationMetadata as Record<string, unknown>)
              : undefined,
            createdAt: now,
          });
          revisions.set(id, history);
        }
        await json(route, 200, { data: workflow });
        return;
      }
      if (method === 'DELETE') {
        workflows.delete(id);
        revisions.delete(id);
        await route.fulfill({ status: 204, body: '' });
        return;
      }
    }

    if (path === '/ai/generate' && method === 'POST') {
      const { prompt } = request.postDataJSON() as { prompt: string };
      await json(route, 200, {
        data: {
          name: 'AI Release Digest',
          description: 'Generated against a deterministic browser-test response.',
          nodes: executableWorkflow('generated').nodes,
          edges: executableWorkflow('generated').edges,
          generationMetadata: {
            originalPrompt: prompt,
            generatedAt: now,
            provider: 'mock',
            model: 'mock-flowcraft',
            capabilityCoverage: {
              requestedCapabilities: ['output'],
              implementedCapabilities: ['output'],
              missingCapabilities: [],
              unsupportedCapabilities: [],
              coverage: 1,
              isComplete: true,
            },
          },
        },
      });
      return;
    }

    const provenanceMatch = path.match(/^\/executions\/run\/([^/]+)\/provenance$/);
    if (provenanceMatch && method === 'GET') {
      const runId = provenanceMatch[1];
      const run = [...executions.values()].flat().find((candidate) => candidate._id === runId);
      if (!run) {
        await json(route, 404, { error: { code: 'EXECUTION_NOT_FOUND', message: 'Execution run not found' } });
        return;
      }
      const workflowId = String(run.workflowId);
      if (!run.workflowRevisionId && !run.workflowRevision && !run.definitionHash) {
        await json(route, 200, { data: {
          status: 'legacy', runId, workflowId, isCurrent: false, canView: false, canCompare: false,
          message: 'This legacy run did not capture an exact workflow revision.',
        } });
        return;
      }
      const workflow = workflows.get(workflowId);
      const pinned = (revisions.get(workflowId) ?? []).find((candidate) => (
        candidate.id === run.workflowRevisionId && candidate.revision === run.workflowRevision
      ));
      if (!workflow || !pinned) {
        await json(route, 200, { data: {
          status: 'unavailable', runId, workflowId,
          workflowRevision: run.workflowRevision, workflowRevisionId: run.workflowRevisionId, definitionHash: run.definitionHash,
          currentRevision: workflow?.currentRevision, isCurrent: false, canView: false, canCompare: false,
          message: 'The exact workflow revision used by this execution is unavailable.',
        } });
        return;
      }
      if (pinned.definitionHash !== run.definitionHash) {
        await json(route, 200, { data: {
          status: 'integrity_error', runId, workflowId,
          workflowRevision: run.workflowRevision, workflowRevisionId: run.workflowRevisionId, definitionHash: run.definitionHash,
          currentRevision: workflow.currentRevision, isCurrent: false, canView: false, canCompare: false,
          message: 'The execution hash does not match its pinned workflow revision.',
        } });
        return;
      }
      const isCurrent = workflow.currentRevision === run.workflowRevision;
      await json(route, 200, { data: {
        status: 'pinned', runId, workflowId,
        workflowRevision: run.workflowRevision, workflowRevisionId: run.workflowRevisionId, definitionHash: run.definitionHash,
        currentRevision: workflow.currentRevision, isCurrent, canView: true, canCompare: !isCurrent,
      } });
      return;
    }

    const regenerateMatch = path.match(/^\/ai\/workflows\/([^/]+)\/regenerate$/);
    if (regenerateMatch && method === 'POST') {
      const id = regenerateMatch[1];
      const current = workflows.get(id);
      if (!current) {
        await json(route, 404, { error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found' } });
        return;
      }
      const { prompt, expectedRevision } = request.postDataJSON() as { prompt: string; expectedRevision: number };
      if (expectedRevision !== current.currentRevision) {
        await json(route, 409, { error: { code: 'WORKFLOW_REVISION_CONFLICT', message: 'Workflow revision conflict' } });
        return;
      }
      const nextRevision = Number(current.currentRevision) + 1;
      const generationMetadata = {
        originalPrompt: prompt,
        generatedAt: now,
        provider: 'mock',
        model: 'mock-flowcraft',
        capabilityCoverage: {
          requestedCapabilities: ['output'], implementedCapabilities: ['output'],
          missingCapabilities: [], unsupportedCapabilities: [], coverage: 1, isComplete: true,
        },
      };
      const revision: MockRevision = {
        id: `${id}-revision-${nextRevision}`,
        workflowId: id,
        revision: nextRevision,
        parentRevisionId: String(current.currentRevisionId),
        source: 'ai_generated',
        definitionHash: String(nextRevision).repeat(64).slice(0, 64),
        nodes: structuredClone((current.nodes ?? []) as Array<Record<string, unknown>>),
        edges: structuredClone((current.edges ?? []) as Array<Record<string, unknown>>),
        generationMetadata,
        createdAt: now,
      };
      const history = revisions.get(id) ?? [];
      history.push(revision);
      revisions.set(id, history);
      const regenerated = {
        ...current,
        name: 'AI Release Digest',
        isGeneratedByAI: true,
        generationMetadata,
        currentRevision: nextRevision,
        currentRevisionId: revision.id,
        definitionHash: revision.definitionHash,
        updatedAt: now,
      };
      workflows.set(id, regenerated);
      await json(route, 201, { data: regenerated });
      return;
    }

    const executionHistoryMatch = path.match(/^\/executions\/workflow\/([^/]+)$/);
    if (executionHistoryMatch && method === 'GET') {
      await json(route, 200, { data: executions.get(executionHistoryMatch[1]) ?? [] });
      return;
    }

    const runMatch = path.match(/^\/executions\/([^/]+)\/run$/);
    if (runMatch && method === 'POST') {
      const workflowId = runMatch[1];
      const workflow = workflows.get(workflowId);
      if (!workflow) {
        await json(route, 404, { error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow not found' } });
        return;
      }
      const workflowRuns = executions.get(workflowId) ?? [];
      const execution = {
          _id: `run-e2e-${workflowRuns.length + 1}`,
          workflowId,
          workflowRevisionId: workflow.currentRevisionId,
          workflowRevision: workflow.currentRevision,
          definitionHash: workflow.definitionHash,
          userId: 'user-e2e',
          status: 'completed',
          startedAt: now,
          completedAt: now,
          triggerType: 'manual',
          stepLogs: [
            { nodeId: 'start', nodeType: 'start', nodeLabel: 'Start', status: 'success', durationMs: 1 },
            {
              nodeId: 'output',
              nodeType: 'output',
              nodeLabel: 'Output Summary',
              status: 'success',
              durationMs: 2,
              output: { message: 'Browser test complete' },
            },
            { nodeId: 'end', nodeType: 'end', nodeLabel: 'End', status: 'success', durationMs: 1 },
          ],
          executionOrder: ['start', 'output', 'end'],
          createdAt: now,
          updatedAt: now,
        };
      workflowRuns.unshift(execution);
      executions.set(workflowId, workflowRuns);
      await json(route, 201, { data: execution });
      return;
    }

    await json(route, 404, {
      error: { code: 'UNMOCKED_E2E_REQUEST', message: `${method} ${path} is not mocked` },
    });
  });

  return { workflows, revisions, executions };
}
