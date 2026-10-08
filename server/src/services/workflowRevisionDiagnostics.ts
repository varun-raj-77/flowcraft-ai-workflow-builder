import { createHash } from 'crypto';
import type { IWorkflowRevisionDocument } from '../models/WorkflowRevision.model';
import {
  calculateDefinitionHash,
  normalizeAndValidateWorkflowGraph,
  normalizeWorkflowGenerationMetadata,
  type WorkflowDefinition,
} from './workflowDefinition';

type RevisionData = Pick<IWorkflowRevisionDocument,
  'nodes' | 'edges' | 'generationMetadata' | 'definitionHash' | 'source' | 'revision'>;

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((out, key) => {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) out[key] = canonicalize(child);
      return out;
    }, {});
  }
  return value;
}

// The pre-August-29 verifier spread the Mongoose subdocument directly.
// Only compute this as a forensic fingerprint; never accept it automatically.
function legacySpreadHash(definition: WorkflowDefinition): string {
  const byId = (a: Record<string, unknown>, b: Record<string, unknown>): number => {
    const id = String(a.id ?? '').localeCompare(String(b.id ?? ''));
    return id || JSON.stringify(canonicalize(a)).localeCompare(JSON.stringify(canonicalize(b)));
  };
  const nodes = definition.nodes.map((n) => canonicalize(n) as Record<string, unknown>).sort(byId);
  const edges = definition.edges.map((e) => canonicalize(e) as Record<string, unknown>).sort(byId);
  const metadata = definition.generationMetadata
    ? {
        ...definition.generationMetadata,
        generatedAt: new Date(definition.generationMetadata.generatedAt).toISOString(),
      }
    : undefined;
  return createHash('sha256').update(JSON.stringify(canonicalize({
    nodes,
    edges,
    ...(metadata ? { generationMetadata: metadata } : {}),
  }))).digest('hex');
}

function candidateMatches(revision: RevisionData, definition: WorkflowDefinition) {
  const actual = revision.definitionHash;
  const metadata = definition.generationMetadata;
  const graphOnly: WorkflowDefinition = { nodes: definition.nodes, edges: definition.edges };
  const withoutCoverage = metadata
    ? { ...graphOnly, generationMetadata: { ...metadata, capabilityCoverage: undefined } }
    : graphOnly;

  const variants: Record<string, () => string> = {
    currentCanonical: () => calculateDefinitionHash(definition),
    graphOnly: () => calculateDefinitionHash(graphOnly),
    metadataWithoutCoverage: () => calculateDefinitionHash(withoutCoverage),
    preHotfixSpread: () => legacySpreadHash({
      ...graphOnly,
      ...(revision.generationMetadata
        ? { generationMetadata: revision.generationMetadata }
        : {}),
    } as WorkflowDefinition),
  };

  const matches: Record<string, boolean> = {};
  for (const [key, compute] of Object.entries(variants)) {
    try { matches[key] = compute() === actual; }
    catch { matches[key] = false; }
  }
  return matches;
}

/**
 * Owner-scoped, read-only diagnostic: returns no graph, prompt, hash,
 * credentials, or secrets. A matching alternative is diagnostic evidence,
 * not authorization to rewrite an immutable revision.
 */
export function diagnoseRevisionIntegrity(revision: RevisionData) {
  let graph: ReturnType<typeof normalizeAndValidateWorkflowGraph>;
  try {
    graph = normalizeAndValidateWorkflowGraph(revision.nodes, revision.edges);
  } catch {
    return {
      revision: revision.revision,
      source: revision.source,
      graphValid: false,
      metadataPresent: Boolean(revision.generationMetadata),
      matches: {},
      status: 'structural_validation_failed' as const,
    };
  }

  let definition: WorkflowDefinition;
  try {
    const metadata = normalizeWorkflowGenerationMetadata(revision.generationMetadata);
    definition = { ...graph, ...(metadata ? { generationMetadata: metadata } : {}) };
  } catch {
    return {
      revision: revision.revision,
      source: revision.source,
      graphValid: true,
      metadataPresent: Boolean(revision.generationMetadata),
      matches: {},
      status: 'metadata_normalization_failed' as const,
    };
  }

  const matches = candidateMatches(revision, definition);
  return {
    revision: revision.revision,
    source: revision.source,
    graphValid: true,
    metadataPresent: Boolean(revision.generationMetadata),
    metadataCoveragePresent: Boolean(definition.generationMetadata?.capabilityCoverage),
    matches,
    status: matches.currentCanonical ? 'valid' as const : 'hash_mismatch' as const,
  };
}
