import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { WorkflowRevision } from '../models/WorkflowRevision.model';
import { calculateDefinitionHash, type WorkflowDefinition } from './workflowDefinition';
import { diagnoseRevisionIntegrity, diagnoseLegacyRootFingerprint } from './workflowRevisionDiagnostics';

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'end', type: 'end', label: 'End', position: { x: 200, y: 0 }, config: {} },
  ],
  edges: [{ id: 'edge', source: 'start', target: 'end' }],
  generationMetadata: {
    originalPrompt: 'Simple workflow',
    generatedAt: '2026-08-29T00:00:00.000Z',
    provider: 'anthropic',
  },
};

function savedRevision(graph: WorkflowDefinition, hash: string) {
  const revision = new WorkflowRevision({
    workflowId: new Types.ObjectId(),
    userId: 'test-owner',
    source: 'ai_generated',
    revision: 1,
    parentRevisionId: null,
    nodes: graph.nodes,
    edges: graph.edges,
    generationMetadata: graph.generationMetadata,
    definitionHash: hash,
  });
  return WorkflowRevision.hydrate(revision.toObject());
}

describe('safe revision fingerprint diagnostics', () => {
  it('verifies valid historical metadata without leaking graph or prompt', () => {
    const revision = savedRevision(definition, calculateDefinitionHash(definition));
    const result = diagnoseRevisionIntegrity(revision);
    expect(result.status).toBe('valid');
    expect(result.matches.currentCanonical).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Simple workflow');
    expect(JSON.stringify(result)).not.toContain('start');
    expect(JSON.stringify(result)).not.toContain('definitions');
  });

  it('identifies graph-only historical hashes without accepting them as valid', () => {
    const hash = calculateDefinitionHash({ nodes: definition.nodes, edges: definition.edges });
    const result = diagnoseRevisionIntegrity(savedRevision(definition, hash));
    expect(result.status).toBe('hash_mismatch');
    expect(result.matches.graphOnly).toBe(true);
    expect(result.matches.currentCanonical).toBe(false);
  });

  it('does not bless a modified workflow as valid', () => {
    const changed = {
      ...definition,
      nodes: definition.nodes.map((n) => n.id === 'end' ? { ...n, label: 'Modified' } : n),
    };
    const result = diagnoseRevisionIntegrity(savedRevision(changed, calculateDefinitionHash(definition)));
    expect(result.status).toBe('hash_mismatch');
    expect(result.matches.currentCanonical).toBe(false);
  });

  it('reports invalid node structures without exposing the graph', () => {
    const bad = {
      ...definition,
      nodes: [...definition.nodes, definition.nodes[0]],
    };
    const result = diagnoseRevisionIntegrity(savedRevision(bad, calculateDefinitionHash(definition)));
    expect(result.status).toBe('structural_validation_failed');
    expect(JSON.stringify(result)).not.toContain('Simple workflow');
  });
  it('checks retained legacy root without revising the stored hash', () => {
    const currentHash = calculateDefinitionHash(definition);
    const revision = savedRevision(definition, currentHash);
    const preservedRoot = {
      nodes: definition.nodes,
      edges: definition.edges,
      generationMetadata: definition.generationMetadata,
    };
    const result = diagnoseLegacyRootFingerprint(revision, preservedRoot);
    expect(result).toMatchObject({
      legacyRootPresent: true,
      rootGraphMatchesRevision: true,
      rootMetadataCurrentHashMatches: true,
      rootMetadataPreHotfixHashMatches: true,
    });
    expect(revision.definitionHash).toBe(currentHash);
  });

  it('reports missing legacy data without inventing recovery evidence', () => {
    const revision = savedRevision(definition, calculateDefinitionHash(definition));
    expect(diagnoseLegacyRootFingerprint(revision, {})).toEqual({ legacyRootPresent: false });
  });

});
