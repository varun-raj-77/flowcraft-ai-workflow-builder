#!/usr/bin/env node
/**
 * Offline M20 release gate. No network calls, credentials or deployment actions.
 *
 * Input JSON is a manually collected snapshot, not proof of a live deployment.
 * Never copy provider raw objects here: only the allowlisted SHA/state fields.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;

function checkSha(value, expected) {
  if (value === undefined || value === null) return 'unknown';
  if (typeof value !== 'string' || !SHA.test(value)) return 'blocked';
  return value === expected ? 'passed' : 'blocked';
}

function checkState(value, allowed) {
  if (value === undefined || value === null) return 'unknown';
  return typeof value === 'string' && allowed.includes(value) ? 'passed' : 'blocked';
}

/** A deterministic, fail-closed read-only audit; callers cannot change live systems. */
export function auditReleaseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || typeof snapshot.expectedSha !== 'string' || !SHA.test(snapshot.expectedSha)) {
    throw new TypeError('A valid 40-character expectedSha is required.');
  }

  const { expectedSha } = snapshot;
  // Only evaluate documented fields; never echo provider payloads or secrets.
  const github = snapshot.github ?? {};
  const vercel = snapshot.vercel ?? {};
  const railway = snapshot.railway ?? {};
  for (const provider of [github, vercel, railway]) {
    if (typeof provider !== 'object' || provider === null || Array.isArray(provider)) {
      throw new TypeError('Provider snapshots must be objects.');
    }
  }

  const checks = [
    { id: 'github-main', status: checkSha(github.mainSha, expectedSha) },
    { id: 'github-ci-commit', status: checkSha(github.ciSha, expectedSha) },
    { id: 'github-ci', status: checkState(github.ciConclusion, ['success']) },
    { id: 'vercel-commit', status: checkSha(vercel.commitSha, expectedSha) },
    { id: 'vercel-state', status: checkState(vercel.state, ['READY']) },
    { id: 'vercel-target', status: checkState(vercel.target, ['production']) },
    { id: 'railway-commit', status: checkSha(railway.commitSha, expectedSha) },
    { id: 'railway-state', status: checkState(railway.status, ['SUCCESS']) },
  ];

  const verdict = checks.some((check) => check.status === 'blocked')
    ? 'BLOCKED'
    : checks.some((check) => check.status === 'unknown')
      ? 'UNVERIFIED'
      : 'READY';

  return { expectedSha, verdict, checks };
}

function main(argv) {
  if (argv.length !== 1 || ['--help', '-h'].includes(argv[0])) {
    process.stdout.write('Usage: node .github/scripts/release-readiness.mjs <local-snapshot.json>\n');
    return argv.length === 1 ? 0 : 2;
  }

  try {
    const source = readFileSync(argv[0]);
    if (source.length > 32_768) throw new Error('Snapshot exceeds 32 KiB.');
    const result = auditReleaseSnapshot(JSON.parse(source.toString('utf8')));
    // Never print raw JSON snapshot; it may contain extra secret keys.
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.verdict === 'READY' ? 0 : 1;
  } catch {
    process.stderr.write('Invalid release snapshot. Provide minimal SHA/state fields only.\n');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
