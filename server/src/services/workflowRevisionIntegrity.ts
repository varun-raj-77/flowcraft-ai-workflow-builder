import { AppError } from '../middleware/errorHandler.middleware';
import type { IWorkflowRevisionDocument } from '../models/WorkflowRevision.model';
import {
  calculateDefinitionHash,
  normalizeAndValidateWorkflowGraph,
  normalizeWorkflowGenerationMetadata,
  type WorkflowDefinition,
} from './workflowDefinition';

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
    throw new AppError(
      422,
      'WORKFLOW_REVISION_INTEGRITY_ERROR',
      'Workflow revision definition hash does not match its content',
    );
  }
  return definition;
}
