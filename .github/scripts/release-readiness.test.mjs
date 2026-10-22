import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auditReleaseSnapshot } from './release-readiness.mjs';

const sha = 'a'.repeat(40);
const previous = 'b'.repeat(40);
const aligned = () => ({
  expectedSha: sha,
  github: { mainSha: sha, ciSha: sha, ciConclusion: 'success' },
  vercel: { commitSha: sha, state: 'READY', target: 'production' },
  railway: { commitSha: sha, status: 'SUCCESS' },
});

describe('M20 read-only release alignment audit', () => {
  it('accepts only a fully aligned, successful, exact-commit snapshot', () => {
    const result = auditReleaseSnapshot(aligned());
    assert.equal(result.verdict, 'READY');
    assert.equal(result.checks.length, 8);
    assert.ok(result.checks.every((check) => check.status === 'passed'));
  });

  it('blocks the real M18-style situation: Vercel on new code while Railway is on an old commit', () => {
    const snapshot = aligned();
    snapshot.railway.commitSha = previous;
    const result = auditReleaseSnapshot(snapshot);
    assert.equal(result.verdict, 'BLOCKED');
    assert.deepEqual(result.checks.find((check) => check.id === 'railway-commit'),
      { id: 'railway-commit', status: 'blocked' });
  });

  it('does not misreport an unverified backend as a successful release', () => {
    const snapshot = aligned();
    delete snapshot.railway;
    const result = auditReleaseSnapshot(snapshot);
    assert.equal(result.verdict, 'UNVERIFIED');
    assert.equal(result.checks.find((check) => check.id === 'railway-state').status, 'unknown');
  });

  it('rejects failed CI, preview-only Vercel, and non-ready deployments', () => {
    const cases = [
      { github: { ...aligned().github, ciConclusion: 'failure' } },
      { github: { ...aligned().github, ciSha: previous } },
      { vercel: { ...aligned().vercel, target: 'preview' } },
      { vercel: { ...aligned().vercel, state: 'BUILDING' } },
      { railway: { ...aligned().railway, status: 'BUILDING' } },
    ];
    for (const change of cases) {
      assert.equal(auditReleaseSnapshot({ ...aligned(), ...change }).verdict, 'BLOCKED');
    }
  });

  it('rejects invalid release SHAs and malformed provider records', () => {
    for (const candidate of [null, undefined, {}, { expectedSha: 'abc' },
      { ...aligned(), github: 'incorrect' }, { ...aligned(), vercel: [] },
      { ...aligned(), railway: null, github: [] }]) {
      assert.throws(() => auditReleaseSnapshot(candidate), TypeError);
    }
  });

  it('does not echo or preserve arbitrary provider fields that could contain secrets', () => {
    const snapshot = aligned();
    snapshot.github.secretToken = 'CANARY-secret-key';
    snapshot.railway.environmentVariables = { ANTHROPIC_API_KEY: 'CANARY-api-key' };
    const report = auditReleaseSnapshot(snapshot);
    assert.equal(report.verdict, 'READY');
    assert.ok(!JSON.stringify(report).includes('CANARY'));
    assert.deepEqual(Object.keys(report), ['expectedSha', 'verdict', 'checks']);
  });
});
