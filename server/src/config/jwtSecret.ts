/**
 * Only local development may use the historical default signing secret.
 * Production must never silently sign cookies with a predictable key.
 *
 * This validates configuration, not secret entropy. Operators must generate
 * cryptographically random values and protect them outside the repository.
 */
export const DEVELOPMENT_JWT_SECRET = 'dev-secret-change-in-production';

export function resolveJwtSecret(nodeEnv: string, configured: string | undefined): string {
  if (nodeEnv !== 'production') return configured || DEVELOPMENT_JWT_SECRET;

  if (!configured || configured.trim().length < 32
    || configured === DEVELOPMENT_JWT_SECRET) {
    // Do not disclose the configured value in logs or exceptions.
    throw new Error('JWT_SECRET must be explicitly configured with a strong, unique secret (at least 32 characters) in production.');
  }

  return configured;
}
