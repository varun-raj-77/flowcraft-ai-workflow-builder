import { type Types } from 'mongoose';
import { Workflow, type IWorkflowDocument } from '../models/Workflow.model';
import { WorkflowRevision, type IWorkflowRevisionDocument } from '../models/WorkflowRevision.model';
import { verifyWorkflowRevisionIntegrity } from './workflowRevisionIntegrity';

const DEFAULT_BATCH_SIZE = 100;

export interface RevisionIntegrityIssue {
  workflowId: string;
  code: string;
  revision?: number;
}

export interface RevisionVerificationSummary {
  scanned: number;
  valid: number;
  legacy: number;
  integrityErrors: number;
  issues: RevisionIntegrityIssue[];
}

export async function forEachWorkflowBounded(
  operation: (workflow: IWorkflowDocument) => Promise<void>,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<void> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('Workflow maintenance batch size must be between 1 and 1000');
  }

  let afterId: Types.ObjectId | undefined;
  let hasMore = true;
  while (hasMore) {
    const filter = afterId ? { _id: { $gt: afterId } } : {};
    const batch = await Workflow.find(filter).sort({ _id: 1 }).limit(batchSize);
    if (batch.length === 0) return;
    for (const workflow of batch) await operation(workflow);
    afterId = batch[batch.length - 1]._id;
    hasMore = batch.length === batchSize;
  }
}

export async function inspectWorkflowRevisionState(
  workflow: IWorkflowDocument,
): Promise<RevisionIntegrityIssue[]> {
  const workflowId = workflow._id.toString();
  const hasRevisionId = Boolean(workflow.currentRevisionId);
  const hasRevisionNumber = workflow.currentRevision !== undefined && workflow.currentRevision !== null;
  if (!hasRevisionId && !hasRevisionNumber) return [];
  if (hasRevisionId !== hasRevisionNumber) {
    return [{ workflowId, code: 'PARTIAL_CURRENT_REVISION_POINTER' }];
  }

  const revisions = await WorkflowRevision.find({
    workflowId: workflow._id,
    userId: workflow.userId,
  }).sort({ revision: 1 });
  const issues: RevisionIntegrityIssue[] = [];
  const byId = new Map<string, IWorkflowRevisionDocument>();
  const byNumber = new Map<number, IWorkflowRevisionDocument>();

  for (const revision of revisions) {
    const revisionId = revision._id.toString();
    if (byId.has(revisionId) || byNumber.has(revision.revision)) {
      issues.push({ workflowId, code: 'DUPLICATE_REVISION_IDENTITY', revision: revision.revision });
      continue;
    }
    byId.set(revisionId, revision);
    byNumber.set(revision.revision, revision);
    try {
      verifyWorkflowRevisionIntegrity(revision);
    } catch {
      issues.push({ workflowId, code: 'REVISION_DEFINITION_INTEGRITY_ERROR', revision: revision.revision });
    }
  }

  const current = workflow.currentRevisionId
    ? byId.get(workflow.currentRevisionId.toString())
    : undefined;
  if (!current) {
    issues.push({ workflowId, code: 'CURRENT_REVISION_MISSING' });
  } else if (current.revision !== workflow.currentRevision) {
    issues.push({ workflowId, code: 'CURRENT_REVISION_NUMBER_MISMATCH', revision: current.revision });
  }

  for (const revision of revisions) {
    const parent = revision.parentRevisionId
      ? byId.get(revision.parentRevisionId.toString())
      : undefined;
    if (revision.revision === 1) {
      if (revision.parentRevisionId) {
        issues.push({ workflowId, code: 'ROOT_REVISION_HAS_PARENT', revision: revision.revision });
      }
    } else if (!parent || parent.revision !== revision.revision - 1) {
      issues.push({ workflowId, code: 'REVISION_PARENT_INVALID', revision: revision.revision });
    }

    if (revision.source === 'restore') {
      const restoredFrom = revision.restoredFromRevisionId
        ? byId.get(revision.restoredFromRevisionId.toString())
        : undefined;
      if (!restoredFrom || restoredFrom.revision >= revision.revision) {
        issues.push({ workflowId, code: 'RESTORE_RELATIONSHIP_INVALID', revision: revision.revision });
      }
    } else if (revision.restoredFromRevisionId) {
      issues.push({ workflowId, code: 'NON_RESTORE_HAS_RESTORE_TARGET', revision: revision.revision });
    }

  }
  return issues;
}

export async function verifyWorkflowRevisions(
  options: { batchSize?: number } = {},
): Promise<RevisionVerificationSummary> {
  const summary: RevisionVerificationSummary = {
    scanned: 0,
    valid: 0,
    legacy: 0,
    integrityErrors: 0,
    issues: [],
  };

  await forEachWorkflowBounded(async (workflow) => {
    summary.scanned += 1;
    if (!workflow.currentRevisionId && !workflow.currentRevision) {
      summary.legacy += 1;
      return;
    }
    const issues = await inspectWorkflowRevisionState(workflow);
    if (issues.length === 0) summary.valid += 1;
    else {
      summary.integrityErrors += issues.length;
      summary.issues.push(...issues);
    }
  }, options.batchSize);
  return summary;
}
