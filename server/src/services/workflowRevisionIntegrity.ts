import { AppError } from '../middleware/errorHandler.middleware';
import type { IWorkflowRevisionDocument } from '../models/WorkflowRevision.model';
import {
  calculateDefinitionHash,
  normalizeAndValidateWorkflowGraph,
  type WorkflowDefinition,
  type WorkflowGenerationMetadata,
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

  const definition: WorkflowDefinition = {
    ...graph,
    ...(revision.generationMetadata
      ? { generationMetadata: revision.generationMetadata as unknown as WorkflowGenerationMetadata }
      : {}),
  };
  if (calculateDefinitionHash(definition) !== revision.definitionHash) {
    throw new AppError(
      422,
      'WORKFLOW_REVISION_INTEGRITY_ERROR',
      'Workflow revision definition hash does not match its content',
    );
  }
  return definition;
}
