# Post-M20 security follow-up — runtime config and production smoke

This is **not** a claim that FlowCraft's Railway production backend or credentials
have been verified. No infrastructure settings, existing sessions, or secrets are
modified by this change. Review the operational prerequisites before merging.

## 1. JWT signing secret — fail closed in production

The server previously used a known local-development fallback value if
`JWT_SECRET` was missing. Production now fails startup if the value is absent,
blank, too short (fewer than 32 non-whitespace characters), or equal to that
development fallback. Local development and tests retain the old fallback
without changing their session behavior.

**Before deploying a new Railway backend artifact:** confirm `JWT_SECRET`
is already set to a unique cryptographically random value of at least 32
characters in the correct production environment. Verify the *presence and
policy* without showing the secret in screenshots, logs, GitHub, or this chat.
A 32-character length check alone does **not** guarantee entropy.

**Rotation:** changing `JWT_SECRET` will invalidate existing JWT sessions.
Coordinate an appropriate maintenance window; issue new sessions on re-login.
Review JWT usage in all instances sharing this secret before making a change.
Don't rotate the database credential or JWT secret automatically from CI.

If the current production key is absent or weak, do not merge/deploy blindly:
fix the environment first, then review and authorize a fresh build of the
intended backend commit. This PR intentionally cannot inspect Railway secrets.

## 2. Legacy smoke — manual-only with explicit mutation approval

The existing `.github/workflows/production-smoke.yml` used to run when its
workflow file changed in a pull request, despite creating, changing, executing
and deleting production demo workflows and sending live AI provider requests.
That PR trigger is removed; this workflow has **workflow_dispatch only**.

To intentionally run that legacy smoke, supply the exact confirmation string
`I_APPROVE_PRODUCTION_SMOKE_MUTATIONS` in the manual dispatch form. Both the
workflow and the Node runner enforce it, including for direct CLI invocation
(`FLOWCRAFT_LIVE_SMOKE_CONFIRMATION`). Missing or incorrect approval refuses
the run before any network call. It continues to use the shared demo account,
so avoid running it on a customer-owned environment.

For **public, read-only** smoke, keep using the distinct manual
`.github/workflows/read-only-production-smoke.yml` workflow. Do not trigger
either production smoke workflow automatically from CI or a PR.

## 3. Verification and limitations

- Server-side unit tests exercise development fallback, rejected production
  secrets and properly supplied production configuration.
- Node tests exercise missing/invalid/exact live-smoke approvals without
  making network requests. Standard CI runs these tests, plus the complete
  existing test, typecheck, lint, build and Playwright suites.
- An authenticated end-to-end production journey remains unverified until
  Railway's deployment commit and access are independently established.
- Credentials exposed in previous screenshots must be revoked or rotated
  through provider account controls. This change does not rotate them.

Release guard: review exact PR head, GitHub checks, and Vercel preview. Obtain
**separate merge approval**, then verify post-merge GitHub and Vercel.
Do not manually redeploy Railway, modify live credentials or run stateful
production smoke without separate approval.
