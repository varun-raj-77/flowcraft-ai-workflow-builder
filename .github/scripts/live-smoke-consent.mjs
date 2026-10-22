/**
 * Fail-closed opt-in for the legacy, state-changing production smoke runner.
 * This guard must run before any network request, even when invoked locally.
 */
export const LIVE_SMOKE_CONFIRMATION = 'I_APPROVE_PRODUCTION_SMOKE_MUTATIONS';

export function requireLiveSmokeConsent(env = {}) {
  if (env.FLOWCRAFT_LIVE_SMOKE_CONFIRMATION !== LIVE_SMOKE_CONFIRMATION) {
    throw new Error('Live production smoke is disabled without explicit manual confirmation.');
  }
}
