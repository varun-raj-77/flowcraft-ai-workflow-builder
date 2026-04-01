import { z } from 'zod';

// ── Per-type config schemas ─────────────────────────────────

export const apiCallConfigSchema = z.object({
  url: z
    .string()
    .min(1, 'URL is required')
    .url('Must be a valid URL'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().optional(),
  timeout: z
    .number()
    .int()
    .min(100, 'Minimum 100ms')
    .max(30000, 'Maximum 30s')
    .optional(),
});

export const conditionConfigSchema = z.object({
  expression: z
    .string()
    .min(1, 'Expression is required'),
  trueTargetNodeId: z.string().optional(),
  falseTargetNodeId: z.string().optional(),
});

export const transformConfigSchema = z.object({
  transformCode: z
    .string()
    .min(1, 'Transform code is required'),
  description: z.string().optional(),
});

export const delayConfigSchema = z.object({
  delayMs: z
    .number()
    .int()
    .min(0, 'Must be 0 or greater')
    .max(300000, 'Maximum 5 minutes'),
});

export const outputConfigSchema = z.object({
  logLevel: z.enum(['info', 'warn', 'error']),
  message: z
    .string()
    .min(1, 'Message is required'),
});

// Start and End have no config to validate
export const startConfigSchema = z.object({});
export const endConfigSchema = z.object({});

// ── Type exports (inferred from schemas) ────────────────────

export type ApiCallConfigValues = z.infer<typeof apiCallConfigSchema>;
export type ConditionConfigValues = z.infer<typeof conditionConfigSchema>;
export type TransformConfigValues = z.infer<typeof transformConfigSchema>;
export type DelayConfigValues = z.infer<typeof delayConfigSchema>;
export type OutputConfigValues = z.infer<typeof outputConfigSchema>;
