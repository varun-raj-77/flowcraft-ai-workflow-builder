import { AppError } from '../middleware/errorHandler.middleware';
import type { IWorkflowRevisionDocument } from '../models/WorkflowRevision.model';
import {
  calculateDefinitionHash,
  normalizeAndValidateWorkflowGraph,
  normalizeWorkflowGenerationMetadata,
  type WorkflowDefinition,
} from './workflowDefinition';

/**
 * Before revision persistence disabled minimization, Mongoose could omit
 * an empty API headers object inside a Mixed node array. Reconstruct only
 * that known empty object, then require the original SHA-256 hash to match.
 * Any other definition change is still rejected.
 */
function restoreLegacyEmptyApiHeaders(definition: WorkflowDefinition): WorkflowDefinition | null {
  let recovered = false;
  const nodes = definition.nodes.map((node) => {
    if (node.type !== 'api_call' || Object.prototype.hasOwnProperty.call(node.config, 'headers')) {
      return node;
    }
    recovered = true;
    return { ...node, config: { ...node.config, headers: {} } };
  });
  return recovered ? { ...definition, nodes } : null;
}

/** Rebuild and verify the canonical definition represented by an immutable revision. */
export function verifyWorkflowRevisionIntegrity(
  revision: Pick<IWorkflowRevisionDocument, 'nodes' | 'edges' | 'generationMetadata' | 'definitionHash'>,
): WorkflowDefinition {
  let graph: ReturnType<typeof normalizeAndValidateWorkflowGraph>;
  try {
    graph = normalizeAndValidateWorkflowGraph(revision.nodes, revision.edges);
  } catch {
    throw new AppError(
      422,
      'WORKFLOW_REVISION_INTEGRITY_ERROR',
      'Workflow revision content failed structural validation',
    );
  }

  let definition: WorkflowDefinition;
  let calculatedHash: string;
  try {
    const generationMetadata = normalizeWorkflowGenerationMetadata(revision.generationMetadata);
    definition = {
      ...graph,
      ...(generationMetadata ? { generationMetadata } : {}),
    };
    calculatedHash = calculateDefinitionHash(definition);
  } catch {
    throw new AppError(
      422,
      'WORKFLOW_REVISION_INTEGRITY_ERROR',
      'Workflow revision metadata failed logical normalization',
    );
  }

  if (calculatedHash !== revision.definitionHash) {
    const recoveredDefinition = restoreLegacyEmptyApiHeaders(definition);
    if (recoveredDefinition && calculateDefinitionHash(recoveredDefinition) === revision.definitionHash) {
      return recoveredDefinition;
    }
    throw new AppError(
      422,
      'WORKFLOW_REVISION_INTEGRITY_ERROR',
      'Workflow revision definition hash does not match its content',
    );
  }
  return definition;
}
