# M20 — Release alignment and CI resilience

## Purpose

M16–M19 hardened execution history, but M18 illustrated an operational risk:
GitHub `main` and Vercel were on a new commit while Railway kept serving an
older successful backend deployment. A READY Vercel deployment or green GitHub
CI alone is **not** proof the full-stack release is complete.

M20 provides a deterministic **offline, read-only release gate**, regression
tests for drift and incomplete evidence, and more diagnosable browser CI setup.
It does not attempt Railway deployments, service configuration changes, or
live production workflow execution.

## Read-only release audit

Run on your own machine or in a controlled review environment with a
**manually collected** snapshot of the *same* intended commit. Capture only the
eight minimal facts below from GitHub Actions, the live Vercel alias and
Railway's production backend deployment history:

```json
{
  "expectedSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "github": {
    "mainSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "ciSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "ciConclusion": "success"
  },
  "vercel": {
    "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "state": "READY",
    "target": "production"
  },
  "railway": {
    "commitSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "status": "SUCCESS"
  }
}
```

Save as a local file, then run:

```sh
node .github/scripts/release-readiness.mjs ./release-snapshot.json
```

This example deliberately reports **BLOCKED** because Railway serves an old
commit. Substitute actual observed values; **do not** paste environment
variables, headers, cookies, build logs, access tokens or provider response
bodies into the snapshot. Avoid committing real release snapshots. The
auditor prints only normalized SHA and check statuses, never raw inputs.

- `READY` / exit 0: all exact SHAs and successful states are verified in the
  supplied snapshot (not independently attested by the script).
- `BLOCKED` / exit 1: an explicit mismatch or failed status exists.
- `UNVERIFIED` / exit 1: a required value was not supplied or is null.
- Invalid snapshot / exit 2: missing or malformed expected SHA/provider shape.

**Important:** this utility is not a networked status monitor and doesn't
establish that a supplied snapshot is recent, authentic, or corresponds to an
actual healthy user journey. Verify provider records directly before approving
a release. Do not automatically trigger deployments on a failed audit.

## Browser CI hardening

GitHub CI invokes the auditor's unit tests offline. The Playwright job still
runs 16 critical user journeys, but separates OS library installation from
Chromium download, with bounded per-step and job timeouts. This helps identify
an external package/download stall without suppressing browser failures.
All browser failures continue to fail CI. Neither CI job contacts the
production FlowCraft backend.

## Final milestone release checklist

1. Confirm exact PR head, clean mergeability, review scope, CI and Vercel
   preview for the **same commit**, and obtain separate explicit merge approval.
2. Merge under an expected-head guard; verify GitHub `main`, post-merge CI
   and live Vercel alias on the new merge commit.
3. Inspect Railway production backend's **actual** commit SHA and final
   deployment status. A previous `SUCCESS` or correct source branch alone
   is insufficient. Reconcile M18's deployment drift before declaring the
   full-stack rollout complete.
4. Where an incident may have exposed credentials, independently rotate
   affected secrets and review usage before considering the environment
   security-verified. Never publish secrets in screenshots or audit files.
5. Preserve existing live services on outage; do not use old-deployment
   `Redeploy` as a substitute for building the intended GitHub SHA.
6. Keep live workflow, DB-mutating, or side-effectful smoke tests disabled
   unless expressly authorized. Read-only checks must not be represented as
   proof that all execution side effects are safe.

**M20 release policy:** this PR is a reviewable branch, not an authorization
to merge it or manually redeploy any production service. The Railway incident
remains a separate operational task.
