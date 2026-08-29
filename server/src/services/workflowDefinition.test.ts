import { describe, expect, it } from 'vitest';
import { calculateDefinitionHash, normalizeAndValidateWorkflowGraph } from './workflowDefinition';

const startNode = {
  id: 'start',
  type: 'start' as const,
  label: 'Start',
  position: { x: 0, y: 0 },
  config: {},
};

const apiNode = {
  id: 'api',
  type: 'api_call' as const,
  label: 'Fetch',
  position: { x: 200, y: 0 },
  config: {
    url: 'https://v1.example.test/data',
    method: 'GET' as const,
    headers: { Authorization: 'Bearer token', Accept: 'application/json' },
  },
};

describe('workflow definition hashing', () => {
  it('produces the same SHA-256 hash for equivalent definitions regardless of object, node, and edge order', () => {
    const first = calculateDefinitionHash({
      nodes: [startNode, apiNode],
      edges: [
        { id: 'edge-b', source: 'start', target: 'api', label: 'next' },
        { id: 'edge-a', source: 'api', target: 'start', label: 'ignored-for-order-test' },
      ],
    });
    const second = calculateDefinitionHash({
      edges: [
        { label: 'ignored-for-order-test', target: 'start', source: 'api', id: 'edge-a' },
        { target: 'api', source: 'start', id: 'edge-b', label: 'next' },
      ],
      nodes: [
        {
          position: { y: 0, x: 200 },
          label: 'Fetch',
          id: 'api',
          type: 'api_call',
          config: {
            method: 'GET',
            headers: { Accept: 'application/json', Authorization: 'Bearer token' },
            url: 'https://v1.example.test/data',
          },
        },
        startNode,
      ],
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it('changes the hash when persisted executable configuration changes', () => {
    const first = calculateDefinitionHash({ nodes: [apiNode], edges: [] });
    const second = calculateDefinitionHash({
      nodes: [{ ...apiNode, config: { ...apiNode.config, url: 'https://v2.example.test/data' } }],
      edges: [],
    });

    expect(second).not.toBe(first);
  });

  it('normalizes persisted generation timestamps across string and Date representations', () => {
    const metadata = { originalPrompt: 'Generate it', generatedAt: '2026-01-01T00:00:00Z' };
    const stringHash = calculateDefinitionHash({ nodes: [startNode], edges: [], generationMetadata: metadata });
    const dateHash = calculateDefinitionHash({
      nodes: [startNode],
      edges: [],
      generationMetadata: { ...metadata, generatedAt: new Date(metadata.generatedAt) },
    });

    expect(dateHash).toBe(stringHash);
  });

  it('validates and hashes a 75-node graph without order-sensitive output', () => {
    const nodes = Array.from({ length: 75 }, (_, index) => ({
      id: `node-${index}`,
      type: 'delay' as const,
      label: `Step ${index}`,
      position: { x: index * 20, y: 0 },
      config: { delayMs: 1 },
    }));
    const edges = Array.from({ length: 74 }, (_, index) => ({
      id: `edge-${index}`,
      source: `node-${index}`,
      target: `node-${index + 1}`,
    }));

    const normalized = normalizeAndValidateWorkflowGraph(nodes, edges);
    const forward = calculateDefinitionHash(normalized);
    const reversed = calculateDefinitionHash({ nodes: [...nodes].reverse(), edges: [...edges].reverse() });

    expect(normalized.nodes).toHaveLength(75);
    expect(normalized.edges).toHaveLength(74);
    expect(forward).toMatch(/^[a-f0-9]{64}$/);
    expect(reversed).toBe(forward);
  });
});
