import type { CapabilityCoverage, GenerationMetadata } from '@/types';

type GenerationMetadataInput = unknown;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function normalizeCapabilityCoverage(value: unknown): CapabilityCoverage | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const coverage = value as Partial<CapabilityCoverage>;
  if (
    !isStringArray(coverage.requestedCapabilities)
    || !isStringArray(coverage.implementedCapabilities)
    || !isStringArray(coverage.missingCapabilities)
    || !isStringArray(coverage.unsupportedCapabilities)
    || typeof coverage.coverage !== 'number'
    || coverage.coverage < 0
    || coverage.coverage > 1
    || typeof coverage.isComplete !== 'boolean'
  ) {
    return undefined;
  }

  return {
    requestedCapabilities: coverage.requestedCapabilities,
    implementedCapabilities: coverage.implementedCapabilities,
    missingCapabilities: coverage.missingCapabilities,
    unsupportedCapabilities: coverage.unsupportedCapabilities,
    coverage: coverage.coverage,
    isComplete: coverage.isComplete,
  };
}

/**
 * Returns metadata only when it satisfies the server's workflow DTO. Invalid
 * metadata is omitted rather than serializing a partial AI provenance object.
 */
export function normalizeGenerationMetadata(metadata: GenerationMetadataInput): GenerationMetadata | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;

  const candidate = metadata as Partial<GenerationMetadata>;
  const originalPrompt = typeof candidate.originalPrompt === 'string' ? candidate.originalPrompt.trim() : '';
  const generatedAt = typeof candidate.generatedAt === 'string' ? candidate.generatedAt : '';
  if (!originalPrompt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(generatedAt) || Number.isNaN(Date.parse(generatedAt))) return undefined;

  if (candidate.capabilityCoverage !== undefined) {
    const capabilityCoverage = normalizeCapabilityCoverage(candidate.capabilityCoverage);
    if (!capabilityCoverage) return undefined;
    return {
      originalPrompt,
      generatedAt,
      ...(typeof candidate.provider === 'string' && candidate.provider.trim() ? { provider: candidate.provider } : {}),
      ...(typeof candidate.model === 'string' && candidate.model.trim() ? { model: candidate.model } : {}),
      capabilityCoverage,
    };
  }

  return {
    originalPrompt,
    generatedAt,
    ...(typeof candidate.provider === 'string' && candidate.provider.trim() ? { provider: candidate.provider } : {}),
    ...(typeof candidate.model === 'string' && candidate.model.trim() ? { model: candidate.model } : {}),
  };
}

/** Adds generation metadata only when it is valid for persistence. */
export function withNormalizedGenerationMetadata<T extends object>(
  payload: T,
  metadata: GenerationMetadataInput,
): T & { generationMetadata?: GenerationMetadata } {
  const generationMetadata = normalizeGenerationMetadata(metadata);
  return generationMetadata ? { ...payload, generationMetadata } : payload;
}

/** A generated graph can replace editor state only after a complete response. */
export function hasCompleteGenerationMetadata(metadata: GenerationMetadataInput): metadata is GenerationMetadata {
  return normalizeGenerationMetadata(metadata)?.capabilityCoverage?.isComplete === true;
}
