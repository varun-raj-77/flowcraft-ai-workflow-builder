import type { WorkflowRevisionSource } from '../models/WorkflowRevision.model';

export interface AiLineageRevision {
  id: string;
  revision: number;
  source: WorkflowRevisionSource;
  parentRevisionId: string | null;
  restoredFromRevisionId?: string;
  generationMetadata?: {
    originalPrompt?: string;
    provider?: string;
    model?: string;
  };
}

export type WorkflowAiPromptContext =
  | {
    status: 'available';
    prompt: string;
    promptRevision: number;
    currentRevision: number;
    relationship: 'direct' | 'inherited' | 'restored';
    provider?: string;
    model?: string;
  }
  | { status: 'none'; currentRevision: number }
  | { status: 'unavailable'; currentRevision: number; message: string };

const MAX_LINEAGE_DEPTH = 100;

function trustedOptionalText(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Resolves the lineage of one immutable current definition.
 * Restore ancestry is a branch switch: it never falls back into the restore event's parent branch.
 */
export async function resolveWorkflowAiPromptLineage(
  current: AiLineageRevision,
  loadRevisionById: (revisionId: string) => Promise<AiLineageRevision | null>,
): Promise<WorkflowAiPromptContext> {
  const currentRevision = current.revision;
  const visited = new Set<string>();
  let candidate: AiLineageRevision | null = current;
  let crossedRestore = false;

  for (let depth = 0; candidate && depth < MAX_LINEAGE_DEPTH; depth += 1) {
    if (visited.has(candidate.id)) {
      return {
        status: 'unavailable',
        currentRevision,
        message: 'AI prompt lineage contains a cycle and cannot be trusted.',
      };
    }
    visited.add(candidate.id);

    if (candidate.source === 'ai_generated') {
      const prompt = candidate.generationMetadata?.originalPrompt;
      if (typeof prompt !== 'string' || !prompt.trim()) {
        return {
          status: 'unavailable',
          currentRevision,
          message: 'The AI-generated revision has no trustworthy saved prompt.',
        };
      }
      const provider = trustedOptionalText(candidate.generationMetadata?.provider);
      const model = trustedOptionalText(candidate.generationMetadata?.model);
      return {
        status: 'available',
        prompt,
        promptRevision: candidate.revision,
        currentRevision,
        relationship: candidate.id === current.id
          ? 'direct'
          : crossedRestore ? 'restored' : 'inherited',
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
      };
    }

    if (candidate.source === 'restore') {
      if (!candidate.restoredFromRevisionId) {
        return {
          status: 'unavailable',
          currentRevision,
          message: 'The restore revision has incomplete lineage provenance.',
        };
      }
      crossedRestore = true;
      candidate = await loadRevisionById(candidate.restoredFromRevisionId);
      if (!candidate) {
        return {
          status: 'unavailable',
          currentRevision,
          message: 'The restored workflow lineage is unavailable.',
        };
      }
      continue;
    }

    if (!candidate.parentRevisionId) {
      return { status: 'none', currentRevision };
    }
    candidate = await loadRevisionById(candidate.parentRevisionId);
    if (!candidate) {
      return {
        status: 'unavailable',
        currentRevision,
        message: 'The workflow revision lineage is incomplete.',
      };
    }
  }

  return {
    status: 'unavailable',
    currentRevision,
    message: 'AI prompt lineage exceeded the safe traversal limit.',
  };
}
