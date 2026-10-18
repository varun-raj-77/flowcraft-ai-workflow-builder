# FlowCraft M12 — Execution history and debugging UX

## What changes

M12 builds on the existing four-tab Execution Inspector, historical replay, pinned revision provenance, and safe M10 retries. It **does not** add any new execution or side-effectful APIs.

- **Status-filtered history:** filter the latest 20 already-fetched runs by completed, failed, running, or cancelled, with accurate empty states and a clear 20-run limit. Selection still opens the historical timeline without replacing the active execution.
- **Deliberate run comparison:** pick an explicit baseline and another run. Compare terminal status, valid duration delta, successful/skipped step counts; align node status and durations **only when both runs have the exact same nonlegacy immutable revision ID, revision number, and definition hash**. Different/legacy revisions show totals and a clear comparability warning. Never compare payloads, errors, node labels, URLs, or sensitive configuration.
- **Actionable but uncertainty-aware diagnosis:** identify M9 interruptions, API/transform/condition step failures and other failures from fixed vocabulary and existing status metadata. Surface a direct **Inspect failed step** action; do not claim that a suggested cause was proven, nor silently retry work.
- **Cross-workflow stale async protection:** reject delayed history responses if the user has changed workflows; clear compare selection and filters on workflow changes.
- **Bound comparison to 100 steps** to prevent large view computations; show truncation warning. No new backend writes, mutations, telemetry, credentials, or deployment plumbing.

## Safety and limitations

1. Comparisons are **read-only**, client-side, and limited to the newest **20** runs returned by the existing history API. No new history pagination in this milestone. A user should not interpret filter-empty as proof that no older run has that status.
2. Node-by-node comparison is gated on immutable revision identity, not node ID equality alone.
3. Comparison includes metadata only; success/duration counts reflect recorded run states. In-flight runs report no reliable terminal duration delta.
4. Failure diagnosis is general orientation, not automatic root-cause determination. The existing step detail view remains available for troubleshooting with its redaction protections.
5. M9/M10 interruption and retry semantics, authorization, immutable provenance, and user confirmation remain unchanged.

## Verification

- Frontend unit tests for type-specific diagnoses, no secret leakage, revision mismatches, legacy records, cross-workflow refusal, bounded comparison, invalid/in-progress durations, filters, and inspector interactions.
- Full frontend/backend unit tests, lint, typecheck, production builds, Playwright critical journeys, and **offline-only** M7 safety harness via regular CI.
- **No manual production smoke, merge, deployment, live execution or side-effectful tests without the owner's explicit separate approval.**
