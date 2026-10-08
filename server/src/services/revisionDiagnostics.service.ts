import { Workflow } from '../models/Workflow.model';
import { WorkflowRevision } from '../models/WorkflowRevision.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { diagnoseRevisionIntegrity, diagnoseLegacyRootFingerprint } from './workflowRevisionDiagnostics';

/** Diagnostic reads the owner's current revision without requiring it to pass hash verification. */
export async function getOwnedRevisionIntegrityDiagnostics(workflowId: string, userId: string) {
  const workflow = await Workflow.findOne({ _id: workflowId, userId });
  if (!workflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  if (!workflow.currentRevisionId || !workflow.currentRevision) {
    throw new AppError(409, 'WORKFLOW_MIGRATION_REQUIRED', 'Workflow revision pointer is not available');
  }
  const revision = await WorkflowRevision.findOne({
    _id: workflow.currentRevisionId,
    workflowId: workflow._id,
    userId,
    revision: workflow.currentRevision,
  });
  if (!revision) throw new AppError(409, 'WORKFLOW_REVISION_MISSING', 'Current workflow revision not found');
  return {
    ...diagnoseRevisionIntegrity(revision),
    legacyRoot: diagnoseLegacyRootFingerprint(revision, workflow),
  };
}
