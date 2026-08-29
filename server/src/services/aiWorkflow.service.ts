import * as aiService from './ai.service';
import * as workflowService from './workflow.service';
import { AppError } from '../middleware/errorHandler.middleware';

export async function regenerateWorkflow(
  workflowId: string,
  userId: string,
  input: { prompt: string; expectedRevision: number },
) {
  // Check ownership and the starting revision before spending a provider request.
  await workflowService.assertWorkflowRevisionForAiGeneration(
    workflowId,
    userId,
    input.expectedRevision,
  );
  const generated = await aiService.generateWorkflow(input.prompt);
  if (!generated.generationMetadata.capabilityCoverage.isComplete) {
    throw new AppError(
      422,
      'AI_CAPABILITY_INCOMPLETE',
      'AI could not implement every requested workflow capability. Revise the prompt and try again.',
    );
  }
  // The transactional write rechecks expectedRevision after the provider returns.
  return workflowService.createAiGeneratedWorkflowRevision(
    workflowId,
    userId,
    input.expectedRevision,
    generated,
  );
}
