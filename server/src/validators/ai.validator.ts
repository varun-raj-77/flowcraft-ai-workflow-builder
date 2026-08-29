import { z } from 'zod';

export const generateWorkflowSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required').max(2000, 'Prompt is too long (max 2000 characters)'),
});

export const regenerateWorkflowSchema = generateWorkflowSchema.extend({
  expectedRevision: z.number().int().min(1),
});

export type GenerateWorkflowInput = z.infer<typeof generateWorkflowSchema>;
export type RegenerateWorkflowInput = z.infer<typeof regenerateWorkflowSchema>;
