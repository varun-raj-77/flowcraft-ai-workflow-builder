import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_SMOKE_CONFIRMATION, requireLiveSmokeConsent } from './live-smoke-consent.mjs';

describe('legacy production smoke opt-in', () => {
  it('rejects absent, empty, PR-triggered and incorrect confirmations before any network activity', () => {
    for (const env of [
      {}, { FLOWCRAFT_LIVE_SMOKE_CONFIRMATION: '' },
      { GITHUB_EVENT_NAME: 'pull_request' },
      { FLOWCRAFT_LIVE_SMOKE_CONFIRMATION: 'true' },
      { FLOWCRAFT_LIVE_SMOKE_CONFIRMATION: LIVE_SMOKE_CONFIRMATION + ' ' },
    ]) {
      assert.throws(() => requireLiveSmokeConsent(env), /explicit manual confirmation/);
    }
  });

  it('accepts only the exact documented manual confirmation', () => {
    assert.doesNotThrow(() => requireLiveSmokeConsent({
      FLOWCRAFT_LIVE_SMOKE_CONFIRMATION: LIVE_SMOKE_CONFIRMATION,
    }));
  });
});
