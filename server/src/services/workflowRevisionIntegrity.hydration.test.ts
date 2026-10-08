import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AppError } from '../middleware/errorHandler.middleware';
import { Workflow } from '../models/Workflow.model';
import { WorkflowRevision } from '../models/WorkflowRevision.model';
import {
  calculateDefinitionHash,
  normalizeAndValidateWorkflowGraph,
  normalizeWorkflowGenerationMetadata,
  type WorkflowDefinition,
  type WorkflowGenerationMetadata,
} from './workflowDefinition';
import { verifyWorkflowRevisionIntegrity } from './workflowRevisionIntegrity';

const nodes: WorkflowDefinition['nodes'] = [
  {
    id: 'start',
    type: 'start',
    label: 'Start',
    position: { x: 0, y: 0 },
    config: {},
  },
  {
    id: 'end',
    type: 'end',
    label: 'End',
    position: { x: 240, y: 0 },
    config: {},
  },
];

const edges: WorkflowDefinition['edges'] = [
  { id: 'start-end', source: 'start', target: 'end' },
];

const generationMetadata: WorkflowGenerationMetadata = {
  originalPrompt: 'Build a deterministic AI workflow',
  generatedAt: '2026-08-29T14:15:16.000Z',
  provider: 'anthropic',
  model: 'claude-test',
  capabilityCoverage: {
    requestedCapabilities: ['start', 'end'],
    implementedCapabilities: ['start', 'end'],
    missingCapabilities: [],
    unsupportedCapabilities: [],
    coverage: 1,
    isComplete: true,
  },
};

function expectIntegrityError(operation: () => unknown): void {
  try {
    operation();
    throw new Error('Expected integrity verification to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      statusCode: 422,
      code: 'WORKFLOW_REVISION_INTEGRITY_ERROR',
    });
  }
}

function schemaPersistenceRoundTrip(
  definition: WorkflowDefinition,
  definitionHash = calculateDefinitionHash(definition),
) {
  const writeDocument = new WorkflowRevision({
    workflowId: new Types.ObjectId(),
    userId: 'hydration-test-user',
    revision: 1,
    parentRevisionId: null,
    source: definition.generationMetadata ? 'ai_generated' : 'manual',
    nodes: definition.nodes,
    edges: definition.edges,
    generationMetadata: definition.generationMetadata,
    definitionHash,
  });

  expect(writeDocument.validateSync()).toBeUndefined();
  const persisted = writeDocument.toObject({ depopulate: true, versionKey: false });
  const readDocument = WorkflowRevision.hydrate(persisted);
  return { definitionHash, persisted, readDocument };
}

describe('workflow revision integrity across real Mongoose hydration', () => {
  it('A. verifies a manual revision without generation metadata', () => {
    const definition = { nodes, edges };
    const { readDocument } = schemaPersistenceRoundTrip(definition);

    expect(verifyWorkflowRevisionIntegrity(readDocument)).toEqual(definition);
  });

  it('B. verifies an AI revision after schema persistence and Mongoose hydration', () => {
    const definition = { nodes, edges, generationMetadata };
    const creationHash = calculateDefinitionHash(definition);
    const { readDocument } = schemaPersistenceRoundTrip(definition, creationHash);

    expect(readDocument.generationMetadata?.constructor.name).toBe('SingleNested');
    const verifierGraph = normalizeAndValidateWorkflowGraph(readDocument.nodes, readDocument.edges);
    const hydratedLogicalHash = calculateDefinitionHash({
      ...verifierGraph,
      generationMetadata: readDocument.generationMetadata!,
    });
    const verifiedDefinition = verifyWorkflowRevisionIntegrity(readDocument);
    const verifierHash = calculateDefinitionHash(verifiedDefinition);

    expect(hydratedLogicalHash).toBe(creationHash);
    expect(verifierHash).toBe(creationHash);
  });

  it('B2. stores empty API header objects without minimizing them away', () => {
    const apiNodes: WorkflowDefinition['nodes'] = [
      nodes[0],
      {
        id: 'fetch', type: 'api_call', label: 'Fetch public API',
        position: { x: 120, y: 0 },
        config: { url: 'https://example.test/users', method: 'GET', headers: {} },
      },
      nodes[1],
    ];
    const definition: WorkflowDefinition = {
      nodes: apiNodes,
      edges: [
        { id: 'start-fetch', source: 'start', target: 'fetch' },
        { id: 'fetch-end', source: 'fetch', target: 'end' },
      ],
      generationMetadata,
    };
    const { persisted, readDocument, definitionHash } = schemaPersistenceRoundTrip(definition);
    expect(persisted.nodes[1].config).toHaveProperty('headers', {});
    const verified = verifyWorkflowRevisionIntegrity(readDocument);
    expect(calculateDefinitionHash(verified)).toBe(definitionHash);
  });

  it('B3. accepts an older missing empty API headers field only with the original hash', () => {
    const apiNodes: WorkflowDefinition['nodes'] = [
      nodes[0],
      {
        id: 'fetch', type: 'api_call', label: 'Fetch public API',
        position: { x: 120, y: 0 },
        config: { url: 'https://example.test/users', method: 'GET', headers: {} },
      },
      nodes[1],
    ];
    const original: WorkflowDefinition = {
      nodes: apiNodes,
      edges: [
        { id: 'start-fetch', source: 'start', target: 'fetch' },
        { id: 'fetch-end', source: 'fetch', target: 'end' },
      ],
      generationMetadata,
    };
    const missingHeaders: WorkflowDefinition = {
      ...original,
      nodes: apiNodes.map((node) => node.id === 'fetch'
        ? { ...node, config: { url: 'https://example.test/users', method: 'GET' } }
        : node),
    };
    const { readDocument } = schemaPersistenceRoundTrip(missingHeaders, calculateDefinitionHash(original));
    const before = readDocument.toObject();
    const verified = verifyWorkflowRevisionIntegrity(readDocument);
    expect(verified.nodes[1].config).toHaveProperty('headers', {});
    expect(calculateDefinitionHash(verified)).toBe(readDocument.definitionHash);
    expect(readDocument.toObject()).toEqual(before);
    expect(readDocument.modifiedPaths()).toEqual([]);

    const tampered: WorkflowDefinition = {
      ...missingHeaders,
      nodes: missingHeaders.nodes.map((node) => node.id === 'fetch'
        ? { ...node, config: { url: 'https://example.test/tampered', method: 'GET' } }
        : node),
    };
    const bad = schemaPersistenceRoundTrip(tampered, calculateDefinitionHash(original));
    expectIntegrityError(() => verifyWorkflowRevisionIntegrity(bad.readDocument));
  });

  it('C. preserves capability coverage through schema persistence and verifies it', () => {
    const definition = { nodes, edges, generationMetadata };
    const { readDocument } = schemaPersistenceRoundTrip(definition);

    const verified = verifyWorkflowRevisionIntegrity(readDocument);
    expect(verified.generationMetadata?.capabilityCoverage).toEqual(
      generationMetadata.capabilityCoverage,
    );
  });

  it('C2. verifies older AI revisions without capability coverage after Mongoose hydration', () => {
    const olderMetadata: WorkflowGenerationMetadata = {
      originalPrompt: 'Count users from a public API',
      generatedAt: '2026-07-23T12:00:00.000Z',
      provider: 'anthropic',
    };
    const definition = { nodes, edges, generationMetadata: olderMetadata };
    const { readDocument, definitionHash } = schemaPersistenceRoundTrip(definition);

    const verified = verifyWorkflowRevisionIntegrity(readDocument);
    expect(verified).toEqual({
      ...definition,
      generationMetadata: { ...olderMetadata, generatedAt: new Date(olderMetadata.generatedAt) },
    });
    expect(calculateDefinitionHash(verified)).toBe(definitionHash);
  });

  it('C3. normalizes only synthetic empty coverage and still hashes actual coverage changes', () => {
    const originalMetadata: WorkflowGenerationMetadata = {
      originalPrompt: 'Count users',
      generatedAt: '2026-07-23T12:00:00.000Z',
    };
    const implicitDefaults = {
      ...originalMetadata,
      capabilityCoverage: {
        requestedCapabilities: [], implementedCapabilities: [],
        missingCapabilities: [], unsupportedCapabilities: [],
      },
    };
    expect(normalizeWorkflowGenerationMetadata(implicitDefaults)).toEqual(originalMetadata);

    const completeCoverage = {
      ...originalMetadata,
      capabilityCoverage: {
        requestedCapabilities: [], implementedCapabilities: [],
        missingCapabilities: [], unsupportedCapabilities: [],
        coverage: 1, isComplete: true,
      },
    };
    expect(calculateDefinitionHash({ nodes, edges, generationMetadata: completeCoverage }))
      .not.toBe(calculateDefinitionHash({ nodes, edges, generationMetadata: originalMetadata }));
  });

  it('D. canonicalizes generatedAt Date and string representations deterministically', () => {
    const stringDefinition = { nodes, edges, generationMetadata };
    const dateDefinition = {
      nodes,
      edges,
      generationMetadata: {
        ...generationMetadata,
        generatedAt: new Date(generationMetadata.generatedAt),
      },
    };

    const stringHash = calculateDefinitionHash(stringDefinition);
    const dateHash = calculateDefinitionHash(dateDefinition);
    const { readDocument } = schemaPersistenceRoundTrip(stringDefinition);
    const verifierGraph = normalizeAndValidateWorkflowGraph(readDocument.nodes, readDocument.edges);
    const hydratedHash = calculateDefinitionHash({
      ...verifierGraph,
      generationMetadata: readDocument.generationMetadata!,
    });

    expect(dateHash).toBe(stringHash);
    expect(hydratedHash).toBe(stringHash);
  });

  it('E. rejects actually tampered generation metadata', () => {
    const original = { nodes, edges, generationMetadata };
    const tampered = {
      ...original,
      generationMetadata: { ...generationMetadata, originalPrompt: 'Tampered prompt' },
    };
    const { readDocument } = schemaPersistenceRoundTrip(
      tampered,
      calculateDefinitionHash(original),
    );

    expectIntegrityError(() => verifyWorkflowRevisionIntegrity(readDocument));
  });

  it('F. rejects an actually tampered graph', () => {
    const original = { nodes, edges, generationMetadata };
    const tampered = {
      ...original,
      nodes: nodes.map((node) => node.id === 'end' ? { ...node, label: 'Tampered End' } : node),
    };
    const { readDocument } = schemaPersistenceRoundTrip(
      tampered,
      calculateDefinitionHash(original),
    );

    expectIntegrityError(() => verifyWorkflowRevisionIntegrity(readDocument));
  });

  it('G. verifies a migration-shaped AI revision after reloading it through Mongoose', () => {
    const legacyWorkflow = Workflow.hydrate({
      _id: new Types.ObjectId(),
      userId: 'legacy-ai-user',
      name: 'Legacy AI workflow',
      nodes,
      edges,
      isGeneratedByAI: true,
      generationMetadata,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const graph = normalizeAndValidateWorkflowGraph(legacyWorkflow.nodes, legacyWorkflow.edges);
    const migratedDefinition: WorkflowDefinition = {
      ...graph,
      generationMetadata: normalizeWorkflowGenerationMetadata(legacyWorkflow.generationMetadata),
    };
    const creationHash = calculateDefinitionHash(migratedDefinition);
    const { readDocument } = schemaPersistenceRoundTrip(migratedDefinition, creationHash);

    expect(readDocument.generationMetadata?.constructor.name).toBe('SingleNested');
    expect(verifyWorkflowRevisionIntegrity(readDocument)).toEqual(migratedDefinition);
    expect(readDocument.definitionHash).toBe(creationHash);
  });

  it('H. validates correctly stored legacy-style hashes without revising the document or hash', () => {
    const legacyWorkflow = Workflow.hydrate({
      _id: new Types.ObjectId(),
      userId: 'legacy-ai-user',
      name: 'Legacy AI workflow',
      nodes,
      edges,
      isGeneratedByAI: true,
      generationMetadata,
    });
    const oldCreationMetadata = (
      legacyWorkflow.generationMetadata as unknown as { toObject(): unknown }
    ).toObject();
    const oldCreationHash = calculateDefinitionHash({
      nodes,
      edges,
      generationMetadata: oldCreationMetadata as WorkflowGenerationMetadata,
    });
    const { readDocument } = schemaPersistenceRoundTrip(
      { nodes, edges, generationMetadata },
      oldCreationHash,
    );
    const persistedBeforeVerification = readDocument.toObject();

    const verified = verifyWorkflowRevisionIntegrity(readDocument);

    expect(calculateDefinitionHash(verified)).toBe(oldCreationHash);
    expect(readDocument.definitionHash).toBe(oldCreationHash);
    expect(readDocument.toObject()).toEqual(persistedBeforeVerification);
    expect(readDocument.modifiedPaths()).toEqual([]);
  });
});
